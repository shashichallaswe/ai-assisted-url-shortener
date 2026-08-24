# Engineering summary

What was built, why it looks this way, and what a reviewer should not have to infer from the diff. This is the close-out note for issue #20.

## 1. Plan and rationale

The prompt asked for core APIs, analytics, and reliability on Node and TypeScript, without specifying redirect semantics, identity, or analytics grain. Those gaps were frozen in [assumptions.md](assumptions.md) before code, then implemented as four product epics plus this wrap-up:

1. **Foundation** — assumptions, architecture, runnable skeleton.
2. **Core APIs** — authenticated create, public `302` redirect.
3. **Analytics** — fail-open click capture, windowed SQL stats.
4. **Reliability** — destination policy, rate limits, takedown, health/ready/logs.
5. **Scenarios** — greenfield write-up (#17), brownfield aliases (#18). The ambiguous-requirement story (#19) was closed unused; this summary is the remaining close-out.

Postgres is the source of truth. Redis is an accelerator that may vanish. That single rule explains fail-open rate limits, cache-aside redirects, and why a failed cache `DEL` on delete is `500` rather than `204`.

## 2. Artifacts

| Artifact | Role |
| --- | --- |
| `src/` | Fastify service: routes → services → repos. Layers do not skip. |
| `migrations/` | `0001` schema, `0002` widened `urls.code` for aliases |
| `openapi.yaml` | HTTP contract |
| `docs/assumptions.md` | Frozen v1 decisions |
| `docs/architecture.md` | Flows, schema, Redis keys, scale-up path (documented, not built) |
| `docs/threat-model.md` | Destination policy, credentials, limits, cache, analytics loss |
| `docs/scenarios/greenfield.md` | How v1 was sequenced |
| `docs/scenarios/brownfield.md` | Alias impact analysis |
| `docs/ai-traceability.md` | Generated / edited / rejected per story |
| `.github/workflows/ci.yml` | typecheck, lint, tests on push and pull request |
| `README.md` | Setup and demo commands verified against a running process |

## 3. Risks and trade-offs

| Choice | Benefit | Cost |
| --- | --- | --- |
| `302` + `Cache-Control: private, no-store` | Takedown and analytics still see later clicks | No CDN offload of the hot path |
| Never fetch or resolve destinations | No SSRF from this process | A hostname whose DNS points at RFC1918 still passes structural checks |
| Redis fail-open on rate limit and cache read | A Redis outage does not take the product down | Abuse and latency degrade until Redis returns |
| Delete commits, then `DEL`; `DEL` failure is `500` | A `204` cannot lie about cache state | A Redis blip can fail an otherwise successful takedown |
| In-process click queue, at-most-once | Redirect never waits on analytics | Process crash, full queue, or a failed `INSERT` drops events |
| Any valid API key may read any code's stats | Simple v1; `created_by` is stored | No per-key ownership yet |
| Aliases share `urls.code` | One unique index, one lookup, one cache key | Soft-deleted names stay reserved |

## 4. Validation

- **Unit:** code generation, URL policy, cache TTL, IP hashing, redirect decision, env parsing, rate-limiter fail-open, log redaction.
- **Integration:** create, redirect, clicks, stats, delete, rate limits, migrations. Skipped (not failed) when Postgres is down.
- **Gates:** `npm run typecheck && npm run lint && npm test`. CI runs the same three on every push and pull request, with Postgres 16 and Redis 7 as services so integration tests actually execute.
- **Not automated:** load, multi-region failover, DNS-to-private-IP destinations, a real browser following `302`.

## 5. Assumptions

See [assumptions.md](assumptions.md). The ones that most constrain the design: `302` never `301`; Bearer on writes; Postgres authoritative; no destination fetch; aliases deferred then added in #18; no UI.

## 6. Limitations

- Single region, single writer, prototype traffic. Read replicas, Redis Cluster, and a click stream are named in architecture and **not implemented**.
- Click capture is at-most-once. Redis click counters are not the stats source of truth and may drift.
- Structural URL policy without DNS: public names that resolve privately are accepted.
- Stats are per-code click totals and a daily series, not unique visitors, geo, or device.
- API keys are a static hashed secret, not a customer IAM system.
- No hosted environment in this repo. "CI green on `main`" is true after this workflow is merged, not before.

## 7. Testing approach

**Unit (no I/O):** `src/**/tests`. Pure rules: alphabet and reservation, destination policy, TTL math, IP hash + daily salt, redirect 404 vs 302 decisions, env schema, request-id parsing, log field redaction.

**Integration (Postgres, sometimes Redis):** `test/integration`. HTTP + schema + unique constraints + cache invalidation. Each test inserts its own rows. If `DATABASE_URL` is unreachable, those files skip.

**Deliberately untested:** production TLS, real DNS, browser caches, chaos of a multi-node Redis, clock jump across a DST boundary (tests inject a clock).

## 8. Talking points

1. **Architecture:** Postgres decides; Redis accelerates; the redirect path does not wait on analytics.
2. **AI rejection:** destination DNS lookup and `SELECT`-then-`INSERT` uniqueness were both generated-looking ideas and both rejected (SSRF and TOCTOU).
3. **Trade-off:** fail-open rate limits. A limiter that 429s the site when Redis dies is worse than a brief period of unlimited traffic.
4. **Change at scale:** take click persistence out of the process into a durable queue, and put a read replica under stats, before adding more analytics dimensions.

## 9. Human sign-off

Required by the issue: this summary and the threat-model note, including cache invalidation and uniqueness already signed on earlier stories. Merging remains a human action.
