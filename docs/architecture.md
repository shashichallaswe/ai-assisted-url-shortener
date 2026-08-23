# Architecture and data model

This document describes the system as it is designed to be built, so that the implementation stories are assembly rather than design. It is the companion to [assumptions.md](assumptions.md), which says *what* the service does and *why*. This one says *how*.

Column names, key names, and status codes here are normative. Where an implementation story disagrees with this document, this document is wrong and gets fixed first.

## 1. Components

Two datastores, one process. No message broker, no third datastore. Everything the product depends on survives a total loss of Redis.

```
                       ┌───────────────────────────────────┐
   client ───────────► │        Fastify (Node 22, TS)      │
                       │                                   │
                       │  routes/         HTTP only        │
                       │  security/       auth, URL policy,│
                       │                  rate limiting    │
                       │  services/       business rules   │
                       │  repos/          SQL              │
                       │  cache/          Redis interface  │
                       │  observability/  logs, request id │
                       │  lib/            pure helpers     │
                       │                                   │
                       │  ┌─────────────────────────────┐  │
                       │  │ click queue (in-process,    │  │
                       │  │ bounded, batched, async)    │  │
                       │  └─────────────────────────────┘  │
                       └────────┬─────────────────┬────────┘
                                │                 │
                 source of truth│                 │accelerator
                                ▼                 ▼
                    ┌───────────────────┐  ┌───────────────────┐
                    │   PostgreSQL 16   │  │      Redis 7      │
                    │                   │  │                   │
                    │  api_keys         │  │  url cache        │
                    │  urls             │  │  click counters   │
                    │  click_events     │  │  rate-limit keys  │
                    │  idempotency_keys │  │                   │
                    └───────────────────┘  └───────────────────┘
```

Dependencies point one direction only, per the `architecture` skill: a route never issues a query, a service never sets a status code, a repository never decides policy, and everything in `lib/` is pure.

## 2. Create flow

`POST /api/v1/urls` — authenticated, `201` on success.

| # | Step | Layer | Failure |
| --- | --- | --- | --- |
| 1 | Parse `Authorization: Bearer <key>`; reject a missing or malformed header | `routes` | `401` |
| 2 | SHA-256 the presented key, look it up by `api_keys.key_hash`; reject if absent or `revoked_at IS NOT NULL` | `security/auth` | `401` |
| 3 | Increment and check `rl:create:<apiKeyId>:<window>` | `security/rateLimit` | `429` + `Retry-After` |
| 4 | Validate body shape `{ originalUrl, expiresAt? }` with Zod | `routes` | `400` with field-level `details` |
| 5 | Apply the URL policy (section 4) | `security/urlPolicy` | `400` |
| 6 | Reject `expiresAt` at or before now | `services/urls` | `400` |
| 7 | If `Idempotency-Key` is present, fingerprint the canonical body (section 6) | `services/urls` | — |
| 8 | Transaction: reserve the idempotency key, generate a code, insert the row | `repos` | `409` on key reuse with a different body |
| 9 | Respond `201` with `{ code, shortUrl, originalUrl, expiresAt }` and a `Location` header | `routes` | — |

Two deliberate choices in this flow:

- **API keys are not cached.** Authentication is one indexed lookup on every write. Caching it would introduce a revocation-invalidation problem on the one path where being slow is acceptable and being wrong is not.
- **Create does not warm the URL cache.** Most links are never clicked, or are clicked much later. The first redirect populates the cache; warming on create would fill Redis with entries nobody reads.

### Short-code generation and collision handling

Codes are 7 characters drawn from a 62-character alphabet using `crypto.randomBytes`, giving roughly 3.5 × 10^12 possibilities. Random rather than sequential, so codes are not enumerable.

The `urls_code_key` unique constraint is the collision guard, not a pre-flight `SELECT`. Checking for existence before inserting is a time-of-check/time-of-use race that silently produces duplicates under concurrency.

```
attempt: generate code -> INSERT -> on SQLSTATE 23505 for urls_code_key, retry
retries: at most 3, then respond 503 and log at error
```

At 10 million stored links the chance of a single insert colliding is about 3 in a million, so three attempts is generous. Exhausting them means the assumption about key-space occupancy is wrong, and the correct response is to say so loudly rather than to loop.

**This is a human sign-off area.** The reviewer is confirming the entropy, the retry bound, and the decision to let the database arbitrate uniqueness.

## 3. Redirect flow

`GET /:code` — public, `302` on success. This is the hot path and it is sacred: nothing non-essential may block it.

1. **Shape check.** The code must be exactly 7 characters within the base62 charset. Anything else is `404` immediately, with no Redis call and no query. Malformed input must not become database load.
2. **Rate limit.** Increment `rl:redirect:<ipHash>:<window>`. If Redis is unavailable this fails open and logs; a rate limiter that takes the site down with it is worse than no rate limiter.
3. **Cache lookup.** `GET url:v1:<code>`.
   - Entry found → step 5.
   - Negative sentinel found → `404`.
   - Miss → step 4.
4. **Database fallback.** `SELECT id, destination_url, expires_at, deleted_at FROM urls WHERE code = $1`.
   - No row → write the negative sentinel with a 60-second TTL, return `404`.
   - Row → populate the cache with the TTL rule in section 5, continue.
5. **Guards, re-evaluated on every request including cache hits.**
   - `deleted_at IS NOT NULL` → `404`
   - `expires_at IS NOT NULL AND expires_at <= now()` → `404`

   Evaluating these on the cached entry rather than in the `WHERE` clause is what makes expiry correct without an invalidation event, and it keeps one cache payload shape instead of two.
6. **Respond** `302` with `Location: <destination_url>` and `Cache-Control: private, no-store`. Never `301`: a permanently cached redirect means the second click never reaches the service, so analytics under-count and a takedown cannot take effect. No write has occurred at this point.
7. **After the response is flushed**, best-effort and off the request path:
   - `INCR clicks:total:<code>` and `INCR clicks:day:<code>:<YYYY-MM-DD>`
   - push a click record onto the in-process queue described below

   Every failure in this step is logged and swallowed. Nothing here can turn a `302` into a `500`.

### Click capture

Constraint: click persistence is asynchronous and never blocks a redirect. Constraint: no message broker.

Those two together force an in-process queue:

- Bounded at 10,000 pending events. When full it drops the oldest and increments a `clicks_dropped_total` counter, because unbounded growth turns an analytics problem into an outage.
- Flushed on whichever comes first: 100 events or 200 milliseconds, as a single multi-row `INSERT`.
- Drained with a timeout on `SIGTERM`.

**Accepted trade-off:** a hard crash loses whatever is in the buffer, up to 200 milliseconds of clicks. Redis counters absorb most of that loss because they are incremented synchronously in step 7, so totals stay approximately right even when individual event rows are lost. Making click capture fully durable requires the broker that this story's constraints exclude; it is named in the scale-up path instead.

## 4. URL policy

Enforced in `security/urlPolicy`, called from the create flow, never from the redirect flow.

Accepted: a parseable absolute URL, `https:` scheme only, at most 2048 characters.

Rejected with `400`: any other scheme, including `http:`, `javascript:`, `data:`, and `file:`; embedded credentials; `localhost` and any loopback, link-local, or private address literal, in both IPv4 and IPv6 form.

**The destination is never fetched and never DNS-resolved.** That is the whole point: resolving a user-supplied hostname server-side is the server-side request forgery vector we are defending against.

**Known and accepted limitation:** because we do not resolve, a public hostname whose DNS record points at a private address passes the policy. Catching that requires the resolution we refuse to perform, and resolving at validation time would not bind the address used at redirect time anyway. We accept it because the service never issues a request to the destination — only the end user's browser does, from their own network.

## 5. Redis contract

Every key carries a `v1` namespace segment. A change to a payload shape becomes a new namespace rather than a migration, so entries written by older code are never misread.

| Key | Type | Contents | TTL |
| --- | --- | --- | --- |
| `url:v1:<code>` | string, JSON | `{ id, destinationUrl, expiresAt, deletedAt }` | `min(3600s, seconds until expires_at)` |
| `url:v1:<code>` | string, sentinel | negative-lookup marker for a code that does not exist | 60s |
| `clicks:total:<code>` | string, counter | lifetime click count | 24h; rebuilt from `click_events` on miss |
| `clicks:day:<code>:<YYYY-MM-DD>` | string, counter | clicks on that UTC day | 48h |
| `rl:create:<apiKeyId>:<window>` | string, counter | requests in the current fixed window | window length + 1s |
| `rl:redirect:<ipHash>:<window>` | string, counter | requests in the current fixed window | window length + 1s |

A cache miss is normal and must be correct, never an error. Redis being unavailable degrades latency and disables rate limiting; it does not change any answer the service gives, with the single exception in the next section.

### Cache invalidation

**Deletion** — `DELETE /api/v1/urls/:code`:

1. `UPDATE urls SET deleted_at = now() WHERE code = $1 AND deleted_at IS NULL`, committed.
2. `DEL url:v1:<code>`, after the commit and before the response.
3. If the `DEL` fails, retry once; if it fails again, respond `500`, not `204`.

Step 3 is the deliberate exception to "Redis never affects correctness." A takedown that returns success while the link keeps redirecting is a worse failure than a delete that reports it did not finish and asks the caller to retry. The TTL bounds the damage at one hour if the process dies between steps 2 and 3.

Invalidating after commit rather than before avoids a window where a concurrent redirect repopulates the cache from a not-yet-deleted row.

**Expiration** — no invalidation event exists or is needed, because expiry is a timestamp rather than an action. Two independent guards cover it:

- The cache TTL is capped at the link's remaining lifetime, so an entry can never outlive the link it describes.
- The redirect re-checks `expires_at` against the clock on every request, including cache hits, so even a stale entry yields `404`.

**This is a human sign-off area.** The reviewer is confirming the delete-then-invalidate ordering and the choice to fail a delete when invalidation fails.

## 6. Data model

PostgreSQL 16. Timestamps are `timestamptz` and stored in UTC. Migrations are out of scope for this story; this is the target shape they must produce.

### `api_keys`

Authenticates every write and admin read. Retained indefinitely, including revoked keys, because they are audit evidence for who created which link.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `name` | `text` | not null; human label such as `demo-client` |
| `key_hash` | `bytea` | not null, **unique**; SHA-256 of the raw key |
| `key_prefix` | `text` | not null; first 8 characters of the raw key, safe to log |
| `created_at` | `timestamptz` | not null, default `now()` |
| `revoked_at` | `timestamptz` | null when active |

Indexes: unique on `key_hash`, which is the only lookup path.

The raw key exists exactly once, at issuance. It is never stored, never logged, and cannot be recovered. `key_prefix` is what appears in logs so an operator can answer "which key was that" without the secret.

### `urls`

The mapping itself. Retained indefinitely; soft-deleted rows stay for audit and to keep click history meaningful.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigint` | primary key, generated always as identity |
| `code` | `text` | not null, **unique**; 7 base62 characters |
| `destination_url` | `text` | not null |
| `created_by` | `uuid` | not null, references `api_keys(id)` |
| `created_at` | `timestamptz` | not null, default `now()` |
| `expires_at` | `timestamptz` | null means no expiry |
| `deleted_at` | `timestamptz` | null means live |

Constraints:

- `unique (code)` — the collision guard the generator relies on
- `check (char_length(code) = 7)`
- `check (destination_url like 'https://%')` — a backstop under the service-layer policy, not a replacement for it
- `check (expires_at is null or expires_at > created_at)`

Indexes:

- unique on `code`, serving the redirect
- `(expires_at) where expires_at is not null and deleted_at is null`, a partial index for expiry sweeps and reporting

### `click_events`

One row per redirect served. Retained indefinitely **in the prototype only**; production needs a retention policy, and its absence is a stated gap rather than an oversight.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigint` | primary key, generated always as identity |
| `url_id` | `bigint` | not null, references `urls(id)` |
| `clicked_at` | `timestamptz` | not null, default `now()` |
| `ip_hash` | `bytea` | null; SHA-256 of client IP plus a daily rotating salt |
| `user_agent` | `text` | null; truncated to 512 characters |
| `referrer` | `text` | null; truncated to 512 characters |

Indexes: `(url_id, clicked_at desc)`, which serves both the last-click lookup and the per-day `group by` behind the stats endpoint.

Raw IP addresses are never stored or logged. The daily salt rotation means the hash cannot be used to correlate a visitor across days, which keeps the table useful for counting without becoming a store of personal data.

**This is a human sign-off area.** The reviewer is confirming hashed-credential and hashed-IP storage, and the retention gap.

### `idempotency_keys`

Makes `POST /api/v1/urls` safely retryable across network failures. Retained 24 hours, then swept; it is a deduplication window, not a record.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigint` | primary key, generated always as identity |
| `api_key_id` | `uuid` | not null, references `api_keys(id)` |
| `idempotency_key` | `text` | not null; the client-supplied header value |
| `request_fingerprint` | `bytea` | not null; SHA-256 of the canonical request body |
| `url_id` | `bigint` | null until the transaction completes; references `urls(id)` |
| `response_status` | `smallint` | not null |
| `created_at` | `timestamptz` | not null, default `now()` |
| `expires_at` | `timestamptz` | not null, default `now() + interval '24 hours'` |

Constraints and indexes:

- `unique (api_key_id, idempotency_key)` — scoped per key so one client cannot collide with, or probe for, another's keys
- `(expires_at)` for the sweeper

Resolution rules, applied inside the same transaction as the insert into `urls`:

| Situation | Result |
| --- | --- |
| Key unseen | Proceed; record the outcome |
| Key seen, fingerprint matches | Replay the original `201` and its `url_id`. No second link is created |
| Key seen, fingerprint differs | `409` |

Reserving the key by insert, and letting the unique violation report the conflict, is what makes two simultaneous retries safe.

## 7. Failure modes

| Failure | Behaviour | Rationale |
| --- | --- | --- |
| Redis unavailable | Redirects fall back to Postgres; rate limiting fails open; counters are skipped and logged | Latency and abuse control degrade; no answer changes |
| Redis unavailable during a delete | Delete responds `500` | The one case where a stale cache is a correctness failure |
| Postgres unavailable | `/ready` returns `503` naming Postgres; writes and cache-miss redirects fail | Postgres is the source of truth; there is nothing to serve |
| Click queue full | Oldest events dropped, counter incremented | Bounded memory beats complete analytics |
| Code collision three times | `503`, logged at error | Signals a wrong assumption rather than hiding it in a retry loop |
| Process crash | Up to 200 milliseconds of buffered click rows lost; Redis totals survive | Accepted cost of having no broker |

`/health` is liveness only and never touches a dependency. `/ready` checks both Postgres and Redis and names the one that failed.

## 8. Scale-up path — not implemented

Recorded to show the design accommodates growth. **None of this is built, and building any of it in this prototype would be scope creep.**

| Pressure | Change | Why it is deferred |
| --- | --- | --- |
| Stats queries compete with redirects | Route analytics reads to a Postgres read replica | One instance is far from saturated at prototype volume |
| Redis memory or throughput ceiling | Redis Cluster, hash-tagging by code so a link's keys share a slot | Single-node Redis holds the working set comfortably |
| Click volume exceeds what an in-process queue can absorb | Replace the queue with a Kafka or Kinesis stream and a separate consumer | Adds a broker, an operational surface, and a second deployable |
| Per-day aggregation becomes expensive | A materialized `click_daily` rollup table maintained on flush | `group by` over the composite index is fast at this row count |
| Key space occupancy rises | Pre-allocated code blocks per instance instead of random generation | Collision probability is negligible until well past prototype scale |
| Global latency | Edge redirect tier with regional read caches | Single region is the stated assumption |

## 9. Human sign-off

Per AGENTS.md section 9, three areas need the reviewer to confirm the design and not merely the diff:

1. **Short-code uniqueness and collision handling** — section 2: 7 characters of base62, database-arbitrated uniqueness, three retries, then `503`.
2. **Cache invalidation** — section 5: delete commits before invalidating, a failed invalidation fails the request, and expiry relies on a capped TTL plus a re-check on every hit.
3. **Hashed credential and hashed IP storage** — section 6: SHA-256 key hashes with a loggable prefix, daily-salted IP hashes, and the absence of a click retention policy.
