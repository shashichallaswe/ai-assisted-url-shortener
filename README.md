# ai-assisted-url-shortener

Production-minded URL shortener prototype. The point of the repo is the engineering record as much as the process: assumptions first, tests before code, one story at a time, humans merge.

**Status: v1 complete.** Create, 302 redirect, click stats, takedown, rate limits, aliases, health/ready. Not a hosted production.

## Prerequisites

- Node.js 22 LTS (`node --version` should print `v22.x`)
- Docker with Compose v2, for PostgreSQL 16 and Redis 7

## Setup

From a clean checkout:

```bash
npm install
cp .env.example .env
# Set API_KEY to at least 16 characters if you want the demo curls below to work.
docker compose up -d
docker compose ps
npm run migrate
npm run typecheck && npm run lint && npm test
npm run dev
```

`npm test` is green without Docker: integration tests **skip**, they do not fail. Start Compose to run them.

## Demo

Requires `API_KEY` in `.env` (16+ characters; hashed into `api_keys` at boot) and `npm run dev`.

Liveness (no dependency checks):

```bash
curl -sS http://localhost:3000/health
```

Expected: `{"status":"ok","uptime":<seconds>}`.

Readiness (Postgres and Redis). After `docker compose stop postgres` this is `503` with `"postgres":"down"`:

```bash
curl -sS -i http://localhost:3000/ready
```

Create:

```bash
curl -sS -i http://localhost:3000/api/v1/urls \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"originalUrl":"https://example.com/a"}'
```

Expected: `HTTP/1.1 201 Created`, JSON `{ code, shortUrl, originalUrl, expiresAt }`. `shortUrl` is built from `BASE_URL`, not from `Host`. Optional `"customAlias":"docs"` uses that string as `code` (4–32 of `[0-9A-Za-z_-]`); a collision is `409`.

Redirect. Must be **302**, never `301`:

```bash
curl -sS -D - -o /dev/null "http://localhost:3000/$CODE"
```

Expected: `HTTP/1.1 302 Found`, `Location: https://example.com/a`, `Cache-Control: private, no-store`.

Stats (any valid API key; default window last 30 UTC days):

```bash
curl -sS http://localhost:3000/api/v1/urls/$CODE/stats \
  -H "Authorization: Bearer $API_KEY"
```

Takedown:

```bash
curl -sS -i -X DELETE http://localhost:3000/api/v1/urls/$CODE \
  -H "Authorization: Bearer $API_KEY"
```

Expected: `204`. The next `GET /$CODE` is `404`.

Stop dependencies with `docker compose down`. Add `-v` to drop the volume.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the server with reload on change |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server from `dist/` |
| `npm run migrate` | Apply pending migrations; idempotent |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint plus Prettier check |
| `npm run format` | Prettier write |
| `npm test` | Vitest, once |

## Layout

```
src/
  app.ts              Fastify assembly
  server.ts           process entry
  config/             environment schema
  routes/             HTTP only
  services/           business rules
  repos/              SQL
  security/           auth, URL policy, rate limits
  cache/              Redis behind interfaces
  analytics/          click queue
  observability/      logs, request id, readiness
  lib/                pure helpers
  **/tests/           unit tests next to the module
migrations/
test/integration/    HTTP + PostgreSQL (skip if the database is down)
openapi.yaml
.github/workflows/ci.yml
```

A route never queries. A service never sets a status code. A repository never decides policy.

## Configuration

Every variable the process reads is in `.env.example`. A test fails if that file and `src/config/env.ts` drift. `.env` is git-ignored.

Invalid configuration is fatal at startup:

```
$ env -u DATABASE_URL npm start
Invalid environment: DATABASE_URL: Invalid input: expected string, received undefined
```

## Documentation

| Document | Contents |
| --- | --- |
| [docs/assumptions.md](docs/assumptions.md) | Requirements, ambiguities, v1 API, non-goals |
| [docs/architecture.md](docs/architecture.md) | Components, flows, schema, Redis, scale-up path |
| [docs/threat-model.md](docs/threat-model.md) | Redirect abuse, credentials, limits, cache, analytics loss |
| [docs/ENGINEERING_SUMMARY.md](docs/ENGINEERING_SUMMARY.md) | Close-out: rationale, trade-offs, tests, limitations |
| [docs/scenarios/greenfield.md](docs/scenarios/greenfield.md) | How v1 was sequenced |
| [docs/scenarios/brownfield.md](docs/scenarios/brownfield.md) | Alias impact analysis |
| [AGENTS.md](AGENTS.md) | How work is picked up and merged |
| [docs/ai-traceability.md](docs/ai-traceability.md) | Generated, edited, rejected per story |

## CI

Push and pull request run typecheck, lint, and tests on Node 22 with Postgres 16 and Redis 7. See `.github/workflows/ci.yml`.
