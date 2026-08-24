# Greenfield scenario

How this URL shortener went from an underspecified prompt to a running v1. Claims below are meant to be checked against `git log`, the GitHub board, and `docs/ai-traceability.md`. Nothing here is invented after the fact.

**v1 in this document** means core create/redirect, analytics, and reliability/security as landed on `main` through issue #16 (PR #34). Custom aliases (#18) are out of v1 by design.

## 1. Requirement interpretation

The prompt asked for “core APIs, analytics, and reliability features” on Node and TypeScript. It did not name redirect semantics, who may call the API, or how fine-grained analytics should be. Those gaps were frozen in [docs/assumptions.md](../assumptions.md) (issue #1, PR #21, commit `01cffba` lineage; merged as PR #21) so later stories would not relitigate them.

| Ambiguity | Decision | Recorded in |
| --- | --- | --- |
| Redirect status | **302** + `Cache-Control: private, no-store`. Never 301 | assumptions §2 |
| Who may write | Bearer API key on create/admin; redirect public | assumptions §3 |
| Analytics grain | One `click_events` row per redirect; stats via SQL `GROUP BY` over a bounded window | assumptions §2, architecture §3 |
| Destination safety | Structural `https` policy only; **never fetch or DNS-resolve** | assumptions §3, threat-model |
| Expiration | In v1 | assumptions §3 |
| Custom aliases | Deferred to brownfield (#18) | assumptions §2 row 6 |
| UI | None | assumptions §2 row 5 |

The financial-services framing is why unauthenticated create was rejected: it would be an open-redirect factory. Fetching destinations was rejected because it is SSRF.

## 2. Decomposition

Work was sequenced as four product epics, then this documentation epic.

```
#2 Foundation          #1 assumptions → #7 architecture → #8 bootstrap
        ↓
#3 Core URL APIs      #9 create → #10 redirect
        ↓
#4 Analytics          #11 click capture → #12 stats
        ↓
#5 Reliability        #13 URL/auth harden → #14 rate limits → #15 takedown → #16 health/ready/logs
        ↓
#6 This epic          #17 (this document) → #18 aliases → #19 ambiguous → #20 CI + summary
```

Why that order:

- **Contract before code.** #1 and #7 exist so create did not invent 301 vs 302 in a route file.
- **Create before redirect.** Redirect needs a persisted mapping and a code generator.
- **Redirect before clicks.** You cannot capture what you have not served.
- **Clicks before stats.** Stats are a read over `click_events`, not a second write path.
- **Abuse controls after the public GET exists.** Rate limits and takedown are meaningless without `GET /:code`.
- **Operability last in the product slice.** `/ready` and access logs need the dependencies the earlier stories introduced.

Stories were implemented one at a time, each on `story/<n>-…`, with a PR that a human merged. Agents were not allowed to merge (AGENTS.md §9).

## 3. Execution

What actually landed. Merge commits on `main` are the public record.

| Story | PR | What was built | Representative files |
| --- | --- | --- | --- |
| #1 | [#21](https://github.com/shashichallaswe/ai-assisted-url-shortener/pull/21) | Frozen v1 contract | `docs/assumptions.md` |
| #7 | [#22](https://github.com/shashichallaswe/ai-assisted-url-shortener/pull/22) | Architecture, data model, Redis keys, cache-invalidation rules | `docs/architecture.md` |
| #8 | [#23](https://github.com/shashichallaswe/ai-assisted-url-shortener/pull/23) | Fastify + TS, ESLint, Vitest, Compose (Postgres 16, Redis 7), migrator | `src/app.ts`, `src/db/`, `docker-compose.yml` |
| #9 | [#24](https://github.com/shashichallaswe/ai-assisted-url-shortener/pull/24) | `POST /api/v1/urls`, hashed API keys, URL policy, 7-char CSPRNG codes, idempotency | `src/routes/urls.ts`, `src/services/urls.ts`, `src/security/url-policy.ts` |
| #10 | [#25](https://github.com/shashichallaswe/ai-assisted-url-shortener/pull/25) | `GET /:code` → 302, cache-aside, expiry, reserved paths | `src/services/redirect.ts`, `src/cache/` |
| chore | [#26](https://github.com/shashichallaswe/ai-assisted-url-shortener/pull/26) | Prettier | `.prettierrc.json` |
| #11 | [#27](https://github.com/shashichallaswe/ai-assisted-url-shortener/pull/27) | Click rows after 302, hashed IP, in-process queue, fail-open writes | `src/analytics/click-capture.ts` |
| #12 | [#28](https://github.com/shashichallaswe/ai-assisted-url-shortener/pull/28) | `GET /api/v1/urls/:code/stats`, SQL `GROUP BY`, 1–90 day window | `src/services/stats.ts`, `src/repos/click-events.ts` |
| #13 | [#29](https://github.com/shashichallaswe/ai-assisted-url-shortener/pull/29) | Harden policy/auth: reserved-code skip, `timingSafeEqual`, re-check destination on redirect | `src/security/auth.ts`, `src/lib/codes.ts` |
| #14 | [#30](https://github.com/shashichallaswe/ai-assisted-url-shortener/pull/30) | Redis rate limits, 429 + `Retry-After`, fail-open | `src/security/rate-limit.ts`, `src/cache/redis-rate-limiter.ts` |
| #15 | [#32](https://github.com/shashichallaswe/ai-assisted-url-shortener/pull/32) | `DELETE /api/v1/urls/:code`, soft delete, cache `DEL` before 204 | `src/services/urls.ts` (`deleteUrl`) |
| #16 | [#34](https://github.com/shashichallaswe/ai-assisted-url-shortener/pull/34) | `GET /ready`, `x-request-id`, access logs | `src/routes/health.ts`, `src/observability/` |

Supporting chores (not product stories): Prettier (#26), `lib/errors` grouping (#31), colocated unit tests (#33).

Typical story shape on a branch: failing tests → implementation → docs/OpenAPI → AI traceability row. Example: `6240c0c` test(#12) then `78fc73f` feat(#12).

## 4. AI assistance

Evidence is the table in [docs/ai-traceability.md](../ai-traceability.md). Three representative cases:

**Accepted (generated code kept).** Issue #11 click capture: fire-and-forget after 302, hashed IP, bounded in-process queue. That matches the architecture constraint that analytics must not block the redirect (`f0fe51b` / PR #27).

**Edited.** Issue #12 stats: first draft of the service took a `pg` `Pool` and queried from the service. That was rewritten to injected `findByCode` / `loadStats` so `services/` does not import `pg` (`0f545fa`). Same story: default 30-day window and SQL `GROUP BY` were kept; an unbounded “all time” query was not.

**Rejected.** Destination fetching (preview, reachability, “is this URL live?”) was proposed in early design and refused in #1/#7/#9/#13. Reason: SSRF. Validation stays structural (`https`, no private literals, no credentials). DNS lookup to catch a public hostname that points at a private A record was also rejected; catching that *is* the SSRF. Recorded as an accepted residual in `docs/threat-model.md`.

Other rejections that actually happened: 301 redirects; in-memory aggregation of all click rows; serving stats from Redis counters (they are allowed to drift); fail-closed rate limits when Redis is down; 204 on takedown when cache `DEL` fails.

## 5. Validation

**Automated.** `npm run typecheck && npm run lint && npm test`. After #16 the suite is 207 tests (unit under `src/**/tests/`, HTTP+Postgres under `test/integration/`). Integration tests skip, not fail, if Postgres is down.

What the tests actually prove (not an exhaustive list):

- Create: 201, 401, 400 (scheme/localhost/private IP), 409 idempotency, collision retry (`test/integration/create-url.integration.test.ts`)
- Redirect: 302, `no-store`, 404 for unknown/expired/deleted/malformed (`test/integration/redirect.integration.test.ts`, `src/services/tests/redirect.test.ts`)
- Clicks: persist after 302, skip 404, 302 still returned if insert fails
- Stats: known redirect count, `GROUP BY` in SQL, window bounds
- Rate limits: 429 + `Retry-After`, recovery after the window, Redis fail-open
- Takedown: 204, next GET 404, `cache.del` counted, stats still readable
- `/health` vs `/ready`: liveness stays 200 when a probe fails

**Manual.** Walkthrough used against a local Compose stack: health/ready including `docker compose stop postgres`, create + SQL on `urls`/`api_keys`, 302 + Redis `url:v1:*`, `click_events` rows with `ip_hash` not a dotted IP, stats, DELETE then immediate 404, logs for `x-request-id` and absence of the Bearer token.

**Not proven here.** Load, multi-instance Redis correctness under partition, and production key rotation. Those are limitations, not secrets.

## 6. Risks and trade-offs

At least three that were chosen on purpose:

1. **At-most-once clicks.** The in-process queue can drop events on crash, overflow, or failed insert. Mitigation: 302 always succeeds; Redis counters are approximate; the gap is documented (`docs(#11)` known limitation). Exactly-once would need a broker, which v1 forbids.
2. **Fail-open rate limits when Redis is down.** A 429 because Redis is dead takes the product down with the limiter. Mitigation: log and allow; Postgres remains correct. Residual: a Redis outage is an abuse window.
3. **Takedown fails the HTTP request if cache `DEL` fails twice.** A 204 with a live cache entry would keep serving 302. Mitigation: commit `deleted_at`, then `DEL`, retry once, then 500. TTL still caps damage at one hour if the process dies between commit and `DEL`.
4. **Structural URL policy, no DNS.** Hostnames whose A records are private pass. Mitigation: the server never connects to the destination; only the visitor’s browser does.

## 7. How to replay

```bash
git log --oneline --merges main
# PRs #21–#25, #27–#30, #32, #34 are the product story
git show 01cffba:docs/assumptions.md   # or the blob currently on main
npm test
```

Board: [project view](https://github.com/users/shashichallaswe/projects/1/views/1). Traceability: [docs/ai-traceability.md](../ai-traceability.md).
