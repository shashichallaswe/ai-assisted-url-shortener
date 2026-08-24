# Brownfield scenario: custom aliases

Written **before** any alias code, as required by issue #18. The service already creates, redirects, caches, counts, and takes down 7-character generated codes. Custom aliases are an additive change to that inherited contract.

## 1. Decomposition

The feature is one new optional field on an existing write, not a new resource.

1. **Contract.** `POST /api/v1/urls` accepts optional `customAlias`. Omitting it must keep today's generated-code behaviour. A colliding alias is `409`. Charset, length, and reserved words are `400`.
2. **Identifier namespace.** Generated codes and aliases occupy the same `urls.code` column and the same unique index. One public identifier space, one lookup, one cache key.
3. **Lookup widening.** Redirect, metadata, stats, and takedown currently reject anything that is not exactly 7 base62 characters. Aliases are 4–32 of `[0-9A-Za-z_-]`, so that gate has to move from "generated shape" to "public identifier shape" without changing answers for existing 7-character links.
4. **Storage backstop.** `urls_code_length` (`char_length(code) = 7`) must become `between 4 and 32`. Existing 7-character rows remain valid. A charset check is added so a raw SQL insert cannot sneak in spaces or slashes.
5. **Collision.** The database unique constraint stays the only arbitrator. For a caller-chosen alias there is no retry: a unique violation is `409`, never an overwrite and never a substitute code.
6. **Regression.** Existing generated links, cache-aside, and takedown must still pass their current tests.

Out of scope, as named in the issue: alias transfer, renaming, reservation, vanity domains.

## 2. Impacted-module analysis

Answered by searching callers of `isWellFormedCode`, `urls.code`, cache keys, and the create body — not from memory.

### What depends on the 7-character identifier?

| Layer | Callers | Contract today |
| --- | --- | --- |
| Routes | `POST /api/v1/urls`, `GET /api/v1/urls/:code`, `GET /api/v1/urls/:code/stats`, `DELETE /api/v1/urls/:code`, `GET /:code` | Create body `{ originalUrl, expiresAt? }`. Path param treated as a 7-character code. |
| Services | `createUrl`, `deleteUrl`, `resolveRedirect`, `getUrlMetadata`, `getUrlStats` | Lookup returns 404 without I/O when `isReservedCode` or `!isWellFormedCode`. |
| Repository | `insertUrl`, `findUrlByCode`, `markUrlDeleted` | Parameterized `where code = $1`. No length assumption in SQL. |
| Cache | `url:v1:<code>` (live and negative sentinel in the same key) | Payload shape `{ id, destinationUrl, expiresAt, deletedAt }` is independent of code length. |
| Counters | `clicks:total:v1:<code>`, `clicks:day:v1:<code>:<day>` | Keyed by the public identifier. |
| Database | `urls.code text not null unique`, `urls_code_length check (char_length(code) = 7)` | Generated codes only. |
| Docs | `openapi.yaml` min/max 7; `docs/architecture.md` sections 2, 3, 6; `docs/assumptions.md` (aliases deferred) | Published contract. |

### Who would break if we get this wrong?

- **Clients that omit `customAlias`.** Must still receive a 7-character base62 `code`. Additive JSON only.
- **Existing 7-character rows.** Relaxing the check must not rewrite or reject them. Redirect of those rows is the regression.
- **Malformed-code tests.** `resolveRedirect(..., 'nope')` and `GET /nope` currently treat four letters as malformed and skip the database. After this change `nope` is a legal public identifier and **must hit storage** (then 404 if absent). Those tests have to move to a truly illegal value (`no`, charset junk, or 33 characters).
- **Migration test** `rejects a short code that is not seven characters` inserts `'short'` (5 characters). After the check change that insert **succeeds**. The test must reject 3-character or 33-character values instead.
- **OpenAPI** `CreatedUrl.code` and `/{code}` `minLength: 7` / `maxLength: 7` would lie about aliases.
- **Cache.** No payload-version bump: old 7-character entries remain readable. New aliases are new keys. Takedown already `DEL`s by the identifier it is given.

### Stored-state compatibility

- Rows written before this story are 7-character base62. They satisfy `char_length between 4 and 32` and `^[0-9A-Za-z_-]+$`.
- Redis values are unchanged. A mixed fleet of old and new process versions can share Redis: old processes 404 aliases they consider malformed (no cache write); new processes look them up. After deploy, behaviour is uniform.
- Soft-deleted codes remain unique. An alias that matches a deleted code is `409`, not reuse. Same rule as generated codes today.

### Chosen design (and what was rejected)

| Option | Decision |
| --- | --- |
| Same `urls.code` column for generated codes and aliases | **Chosen.** One unique index, one lookup, one cache key. |
| Separate `alias` column plus generated `code` | Rejected. Two lookup paths, two cache keys, and takedown would have to invalidate both. |
| Case-insensitive uniqueness (`citext`) | Rejected. Existing mixed-case generated codes are unique as stored. Changing collation would make `aB3xY7z` collide with a previously legal variant. |
| `SELECT` then `INSERT` for aliases | Rejected. Time-of-check/time-of-use race; two concurrent creates of `docs` would both pass the select and one would still hit unique — unless we handle unique anyway, in which case the select is dead weight. |

## 3. Alias-collision race (chosen handling)

This is a **human sign-off** area (uniqueness).

**Race:** two concurrent `POST /api/v1/urls` with the same `customAlias`.

**Handling:** insert the caller-supplied identifier once. On `SQLSTATE 23505` for `urls_code_key`, return `409` with code `alias_conflict`. Do not retry, do not generate a substitute, do not update the existing row.

```
generated path:  generate → INSERT → unique(urls_code_key) → retry up to 3 → 503
alias path:      validate → INSERT → unique(urls_code_key) → 409
```

Two concurrent identical aliases: one transaction commits `201`, the other sees 23505 and returns `409`. The unique index is the lock.

A collision with a generated 7-character code, with another alias, or with a **soft-deleted** row is the same 409. Soft-delete does not free the identifier.

Idempotency: the request fingerprint includes `customAlias` (or `null`). Same key and same body, including alias, replays `201`. Same key and a different alias is `409` `idempotency_key_mismatch`.

## 4. Execution

Done in this story, after this document existed:

1. Failing tests for `isPublicCode`, create-with-alias, 400/409, reserved, omit-alias regression, alias redirect, alias takedown.
2. Migration `migrations/0002_widen_url_code.sql`.
3. Lookup uses `isPublicCode`; create inserts a caller-supplied alias once and maps `urls_code_key` unique violations to `409 alias_conflict`.
4. OpenAPI, architecture, assumptions, and the reserved-code threat-model note updated.
5. Full suite: 234 tests passing, including every pre-existing test.

## 5. Validation

- Pre-existing create / redirect / delete / stats / rate-limit tests remain green.
- New tests cover: optional alias `201`, charset and length `400`, reserved `400`, collision `409` (including vs a generated code), omit-alias still 7-character base62, SQL-inserted 7-character row still `302`, alias `302` + cache, `DELETE` of an alias invalidates cache and the next `GET` is `404`.
- `npm run typecheck && npm run lint && npm test`.
