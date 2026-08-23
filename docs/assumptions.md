# Requirements, assumptions, and scope

This document freezes the v1 contract for the URL shortener. The assignment prompt asks for "core APIs, analytics, and reliability features" without specifying redirect semantics, authentication, or analytics granularity. Those gaps are resolved here, once, so that no later story has to relitigate them mid-implementation.

Everything below is a decision, not a suggestion. If a story needs to contradict something here, the change lands in this document first.

## 1. Problem statement, restated

Build a service that turns a long destination URL into a short code, redirects visitors from that code to the destination, reports how often each link is used, and stays available and safe under abuse. It is a backend service consumed over HTTP by other software, not by a person in a browser.

The context is financial services. That framing drives two decisions that a generic shortener would not make: writes are authenticated, and the service never fetches a destination URL.

## 2. Ambiguities in the prompt and the interpretation chosen

| # | Ambiguity | Interpretation chosen | Why |
| --- | --- | --- | --- |
| 1 | "Redirect" does not name a status code | **302 Found**, with `Cache-Control: private, no-store` | A 301 is cached indefinitely by browsers. The second click never reaches the service, so analytics silently under-count and a takedown cannot take effect |
| 2 | "Analytics" does not name a grain | One row per click, plus a per-day rollup for reads | Per-click rows keep the raw record for later questions; the rollup keeps the stats endpoint fast without building a warehouse |
| 3 | "Core APIs" does not say who may call them | API key on every write and admin read; the redirect stays public | An unauthenticated create endpoint is an open redirect generator. Indefensible in this context. The redirect must stay public or the product does not work |
| 4 | "Reliability features" is unenumerated | Expiration, rate limiting, health and readiness probes, cache invalidation on delete, and idempotent creates | These are the failure modes a shortener actually has: stale links, abuse, dependency outages, and duplicate submissions |
| 5 | Silent on whether a UI is expected | No user interface | Not requested. The time is better spent on API quality, validation, and tests, which is what the assessment reads |
| 6 | Silent on custom aliases | Deferred to the brownfield scenario (issue #18) | Deliberate. It gives the brownfield exercise a real change against inherited code rather than a contrived one |
| 7 | Silent on whether expiration is v1 | In v1 | Expiration is how a link stops being a liability. That is a reliability requirement, not an enhancement |
| 8 | Silent on scale | Single region, single writer, moderate volume | Sized in section 6. Nothing here forecloses sharding later, but nothing is built for it now |

## 3. Decisions of record

| Topic | Decision | Rationale |
| --- | --- | --- |
| Redirect status | 302, never 301 | 301 is cached by browsers and would silently stop click analytics |
| Authentication | API key via `Authorization: Bearer` on create and admin routes; redirect stays public | A shortener with unauthenticated writes is indefensible for a financial-services context |
| Storage | PostgreSQL as source of truth, Redis as cache-aside and rate limiter | Durability and analytical queries in Postgres; hot-path latency in Redis |
| Analytics grain | Per-click event rows plus daily aggregate | Useful to the business without building a warehouse |
| Expiration | Part of v1 | It is a reliability requirement, not an enhancement |
| Custom aliases | Deferred to the brownfield scenario | Provides a genuine inherited-code change later |
| User interface | None | Not requested; time is better spent on API quality and validation |
| Short code | 7 characters, base62, generated randomly | 62^7 is roughly 3.5 trillion codes. Random rather than sequential so codes are not enumerable |
| Deletion | Soft delete | A hard delete destroys the click history and makes takedown unauditable |
| Destination handling | Stored and validated as a string; never fetched | Fetching a user-supplied URL server-side is server-side request forgery |

## 4. The v1 API surface

Base path for managed resources is `/api/v1`. The redirect deliberately sits at the root so short links stay short.

| Method | Path | Auth | Success | Expected failures |
| --- | --- | --- | --- | --- |
| `POST` | `/api/v1/urls` | Bearer | `201` | `400` invalid body or rejected destination, `401`, `409` idempotency-key reuse with a different body, `429` |
| `GET` | `/:code` | Public | `302` | `404` unknown, expired, deleted, or malformed code; `429` |
| `GET` | `/api/v1/urls/:code` | Bearer | `200` | `401`, `404` |
| `GET` | `/api/v1/urls/:code/stats` | Bearer | `200` | `401`, `404` |
| `DELETE` | `/api/v1/urls/:code` | Bearer | `204` | `401`, `404` |
| `GET` | `/health` | Public | `200` | none; liveness only, never checks dependencies |
| `GET` | `/ready` | Public | `200` | `503` with the failing dependency named |

Contract notes that later stories must honour:

- `POST /api/v1/urls` accepts `{ url, expiresAt? }` and honours an optional `Idempotency-Key` header. The same key with the same body returns the original `201` result; the same key with a different body is a `409`.
- A malformed code (wrong length or outside the base62 charset) returns `404` without touching the database. Bad input should not become database load.
- An expired or soft-deleted link is indistinguishable from a missing one to an anonymous caller. Both are `404`.
- Errors share one JSON shape: `{ error: { code, message, details? } }`. `details` carries field-level validation output and nothing else.
- `429` responses carry `Retry-After`.

## 5. Out of scope for v1

Named explicitly so that "we ran out of time" is never confused with "we chose not to":

- No web or admin user interface
- No user accounts, sign-up, sessions, or multi-tenancy beyond the API key
- No custom domains or vanity hostnames
- No custom aliases in v1 (deferred to issue #18 by design)
- No QR code generation
- No geographic, device, browser, or referrer analytics
- No fetching, crawling, unfurling, previewing, or safe-browsing lookup of destination URLs
- No 301 or other permanently cached redirect
- No editing a destination after creation; create a new link instead
- No bulk import, CSV export, or scheduled reporting
- No password-protected or single-use links
- No analytics warehouse, OLAP store, or streaming pipeline

## 6. Non-functional assumptions

These are prototype targets, chosen to be defensible rather than impressive. They are assumptions, not measured results.

| Property | Assumption |
| --- | --- |
| Redirect latency | Single-digit milliseconds on a cache hit; the redirect path performs no write on the request thread |
| Throughput | Sized for tens of requests per second locally. No horizontal scaling work in v1 |
| Link volume | Up to roughly 10 million links; well inside a single Postgres instance |
| Availability | Single region, single database. No replication, failover, or multi-region story |
| Click recording | Recorded off the redirect's critical path. Losing a click event under load is preferable to failing a redirect |
| Consistency | Postgres is authoritative. Redis may briefly lag, except on delete, where the cache entry is invalidated before the response returns |
| Retention | Click events are retained indefinitely in the prototype. Production would need a retention policy |

## 7. Environment and credential assumptions

- **Runtime**: Node.js 20 LTS with npm. TypeScript compiled as ESM.
- **Dependencies**: PostgreSQL 16 and Redis 7, both supplied by `docker-compose.yml`. The service assumes no managed cloud resources and runs entirely on a laptop.
- **Configuration**: environment variables only, validated at startup. The process exits rather than starting in a half-configured state.
- **Secrets**: `.env` holds real local values and is git-ignored. `.env.example` is committed and contains placeholders only. No credential is ever committed, and the harness hook blocks it at commit time.
- **Demo credentials**: a single static API key for the demo, supplied through the environment. Keys are compared against a stored SHA-256 hash, never against plaintext at rest. This is adequate for a prototype and explicitly not a key-management system; production would need per-client keys, rotation, and revocation.
- **Logging**: structured JSON with a request id. API keys are never logged in any form, and client IP addresses are hashed before storage so click analytics do not become a store of personal data.
- **Time**: all timestamps are stored and returned in UTC as ISO-8601. `expiresAt` is evaluated server-side against the database clock.
- **Base URL**: short links are constructed from a configured base URL rather than inferred from request headers, which are attacker-controlled.

## 8. What this document deliberately does not cover

Architecture, component boundaries, and the data model belong to issue #7. This document says *what* the service does and *why*; that one says *how* it is built.

## 9. Human sign-off

Per AGENTS.md section 9, the following require a reviewer to confirm the decision itself, not just the wording:

- The product scope in section 4 and the non-goals in section 5
- The authentication model in section 3: API key on writes, public redirect
- The choice to record hashed rather than raw IP addresses
