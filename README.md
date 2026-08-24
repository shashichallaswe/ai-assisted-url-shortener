# ai-assisted-url-shortener

Production-minded URL shortener prototype demonstrating AI-assisted engineering execution.

**Status: create + redirect.** The service boots, migrates, creates short links, and redirects `GET /:code` with `302` and `Cache-Control: private, no-store`. Stats and takedown are later stories.

## Prerequisites

- Node.js 22 LTS (`node --version` should print `v22.x`)
- Docker with Compose v2, for PostgreSQL and Redis

## Setup

Run these in order from a clean checkout.

```bash
# 1. Install dependencies
npm install

# 2. Create your local environment file, then set API_KEY to a random
#    16+ character secret if you want local curls to work
cp .env.example .env

# 3. Start PostgreSQL 16 and Redis 7, then wait for both to report healthy
docker compose up -d
docker compose ps

# 4. Apply the database schema (safe to re-run; it applies nothing the second time)
npm run migrate

# 5. Run the quality gates
npm run typecheck && npm run lint && npm test

# 6. Start the service
npm run dev
```

Verify it is up:

```bash
curl -i http://localhost:3000/health
```

Expected: `HTTP/1.1 200 OK` and a body of `{"status":"ok","uptime":<seconds>}`.

Create a short link (requires `API_KEY` in `.env`, hashed into `api_keys` at boot):

```bash
curl -i http://localhost:3000/api/v1/urls \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"originalUrl":"https://example.com/a"}'
```

Expected: `HTTP/1.1 201 Created` with `{ code, shortUrl, originalUrl, expiresAt }`. `shortUrl` is built from `BASE_URL`, not from the request `Host` header.

Follow the short link. Must be `302`, never `301`:

```bash
curl -sS -D - -o /dev/null "$BASE_URL/$CODE"
```

Expected: `HTTP/1.1 302 Found`, `Location: https://example.com/a`, `Cache-Control: private, no-store`.

Read click stats (same Bearer rule as metadata; default window last 30 UTC days):

```bash
curl -sS http://localhost:3000/api/v1/urls/$CODE/stats \
  -H "Authorization: Bearer $API_KEY"
```

To stop the dependencies, `docker compose down`. Add `-v` to discard the database volume as well.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the server with reload on change |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server from `dist/` |
| `npm run migrate` | Apply pending migrations; idempotent |
| `npm run typecheck` | `tsc --noEmit` with strict mode |
| `npm run lint` | ESLint with type-aware rules |
| `npm run format` | Prettier write for TypeScript and JSON |
| `npm test` | Vitest, once |

## Tests and the database

Tests that need PostgreSQL are **skipped, not failed**, when it is not reachable, so `npm test` is green on a machine without Docker. The run prints a line saying so. To exercise them, start Compose first — they connect using `DATABASE_URL`.

## Layout

```
src/
  app.ts             Fastify instance assembly
  server.ts          process entry point
  config/            environment schema and validation
  routes/            HTTP only
  services/          business rules
  repos/             SQL
  security/          auth and destination policy
  db/                pool, migration runner, migration discovery
  observability/     log serializers
  lib/               pure helpers; errors/ holds HTTP, Postgres, and describe helpers
migrations/          numbered SQL, applied in order
test/
  helpers/           shared fixtures
  lib/ security/ …   unit tests, folders match src/
  integration/       HTTP + PostgreSQL (skipped if the database is down)
  db/                migration runner (also needs PostgreSQL)
openapi.yaml         HTTP contract
```

Layering rule: dependencies point one direction only. A route never issues a query, a service never sets a status code, a repository never decides policy.

## Configuration

Every variable the service reads is documented in `.env.example`, and a test fails if that file and `src/config/env.ts` drift apart. `.env` is git-ignored and must never be committed.

Invalid configuration is fatal at startup, by design:

```
$ env -u DATABASE_URL npm start
Invalid environment: DATABASE_URL: Invalid input: expected string, received undefined
```

## Documentation

| Document | Contents |
| --- | --- |
| [docs/assumptions.md](docs/assumptions.md) | Requirements, resolved ambiguities, v1 API surface, non-goals |
| [docs/architecture.md](docs/architecture.md) | Components, request flows, data model, Redis contract, scale-up path |
| [docs/threat-model.md](docs/threat-model.md) | Destination allow/deny rationale and API-key authentication path |
| [AGENTS.md](AGENTS.md) | How work is picked up, reviewed, and merged |
| [docs/ai-traceability.md](docs/ai-traceability.md) | What AI generated, what was edited, what was rejected |
