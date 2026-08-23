---
name: api-design
description: HTTP API design standards for this repository, covering resource naming, status codes, validation, error shape, idempotency, and OpenAPI updates. Use when adding or changing an endpoint, designing a request or response body, or when the user mentions API design, REST, or OpenAPI.
---

# API design

Design the contract before the implementation. The contract is harder to change than the code behind it.

## Conventions

- Base path `/api/v1` for managed resources; the public redirect lives at the root as `/:code`
- Plural nouns for collections: `/api/v1/urls`
- The HTTP verb carries the action; never put verbs in paths
- `camelCase` in JSON bodies
- Timestamps are ISO-8601 with an explicit offset

## Status codes

| Code | Use for |
| --- | --- |
| 200 | Successful read |
| 201 | Resource created; include the representation |
| 204 | Successful delete, no body |
| 302 | Redirect. **Never 301** - it is cached by clients and breaks analytics and takedown |
| 400 | Malformed or semantically invalid input |
| 401 | Missing or invalid credentials |
| 404 | Not found, expired, or soft-deleted; do not distinguish these to unauthenticated callers |
| 409 | Conflict: duplicate alias, idempotency key reused with a different body |
| 429 | Rate limit exceeded; include `Retry-After` |
| 500 | Unexpected failure; generic body, full detail in logs only |

## Validation

Validate every input at the boundary with Zod before it reaches a service. Parse into a typed value rather than checking and passing the raw input onward.

Rejections return 400 with field-level detail. Never reflect the raw input back in an error message.

For destination URLs, validation is **structural only**. Never fetch, resolve, or crawl the target; that is server-side request forgery.

## Error shape

One shape everywhere:

```json
{ "error": "Human-readable description", "details": [] }
```

`details` is optional and carries field-level validation failures. Error messages never leak stack traces, SQL, internal paths, or whether a credential merely existed.

## Authentication

- Public: `GET /:code` only
- Everything else requires `Authorization: Bearer <key>`
- Compare against a stored hash using a constant-time comparison
- Missing and invalid credentials both return 401 with the same body

## Idempotency

Any non-idempotent creation accepts an optional `Idempotency-Key` header.

- Same key, same body: return the original result rather than creating a duplicate
- Same key, different body: 409
- Keys are scoped per API key, never global

## Caching

Redirects must not be cached by intermediaries: return `Cache-Control: private, no-store` alongside the 302. Otherwise a takedown or expiry would not take effect for users who already resolved the link.

## Design checklist

- [ ] Resource, verb, and status codes follow the tables above
- [ ] Request and response bodies fully specified before implementation
- [ ] Every failure mode has a defined status and message
- [ ] Auth requirement is explicit
- [ ] Pagination or bounding defined for anything that returns a list
- [ ] Idempotency considered for creates
- [ ] Backward compatibility considered for existing consumers
- [ ] `openapi.yaml` updated in the same pull request

## Breaking changes

Removing a field, renaming one, tightening validation, or changing a status code breaks consumers. Prefer additive change. When a break is unavoidable, state it explicitly in the PR description and note it in the limitations documentation.
