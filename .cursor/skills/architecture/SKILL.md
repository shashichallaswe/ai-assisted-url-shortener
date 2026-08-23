---
name: architecture
description: Architectural boundaries, layering rules, and change-impact analysis for this repository. Use when a change spans modules, touches storage or caching, introduces a dependency, or when the user mentions architecture, design, refactoring across layers, or impact analysis.
---

# Architecture

## Layers

Dependencies point one direction only. A lower layer never imports a higher one.

```
routes/       HTTP only: parse, validate, map errors to status codes
services/     business rules; no knowledge of HTTP
repos/        database access; no business rules
cache/        Redis behind an interface
security/     URL policy, auth, rate limiting
observability/ logging and request correlation
lib/          pure helpers, no I/O
```

Rules that follow from this:

- A route never issues a query directly
- A service never reads a request or sets a status code
- A repository never decides policy
- Anything in `lib/` is pure and trivially unit-testable

## Storage split

**PostgreSQL is the source of truth.** Every fact the product depends on must survive a total loss of Redis.

**Redis is an accelerator** for cache-aside lookups, click counters, and rate limits. Treat it as possibly cold, stale, or unavailable.

Consequences to honor:

- Cache entries carry a TTL as a backstop
- Deletion and expiry invalidate the cache explicitly rather than waiting for TTL
- A cache miss is normal and must be correct, never an error
- Losing Redis degrades latency and rate limiting, never correctness

## The hot path is sacred

`GET /:code` must survive the failure of anything non-essential. Analytics writes and counters are best-effort: they log failures and let the redirect succeed. Never add a blocking call to the redirect path without an explicit decision recorded in `docs/architecture.md`.

## Change-impact analysis

Before changing anything shared, answer in writing:

1. **What depends on this?** Search for callers; do not rely on memory
2. **What is the contract?** Signature, error behavior, and performance expectation
3. **Who breaks?** Routes, tests, cached payload shapes, OpenAPI, documentation
4. **Is there stored state?** A changed cache payload shape must handle entries written by the old code
5. **How is it verified?** Which existing test proves old behavior still holds

For a change to an existing feature, list every impacted file before editing any of them.

## Adding a dependency

Justify it against the cost: another supply-chain risk, another upgrade, another thing to explain. Prefer the standard library, then an existing dependency, then a new one.

A new dependency needs a stated reason in the PR, a check that it is maintained, and a `npm audit` run with no high or critical findings.

## Recording decisions

When a change alters a component boundary, a data flow, or a storage rule, update `docs/architecture.md` in the same PR. Record the option chosen, the options rejected, and why. Diagrams describe the system as it is, never as it is hoped to become.

## Scale-up path

Documented deliberately as *not implemented*: read replicas, Redis Cluster, a click event stream, multi-region. Referencing this path shows the design accommodates growth; implementing it in a prototype is scope creep.
