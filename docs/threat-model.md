# Threat model note: destination policy and API-key authentication

This is the story #13 sign-off note. It records why the allow/deny rules and the authentication path look the way they do, not a complete STRIDE board.

A URL shortener is an open redirect by design. The job of these two controls is to keep that redirect from becoming a javascript sink, an internal-network probe, or an unauthenticated write API.

## Assets

- The mapping from short code to destination (integrity and takedown)
- API keys (the only credential)
- Click events (hashed IP, truncated user-agent)
- The public redirect itself (availability)

## Destination policy

**Module:** `src/security/url-policy.ts`, called from create (reject with 400) and again from redirect (reject with 404). Redirect never has a second, looser policy.

| Decision | Why |
| --- | --- |
| `https` only | `http` is downgrade. `javascript:`, `data:`, `file:`, and `ftp:` are not destinations a shortener should send a browser to |
| Absolute URLs only | A relative value would inherit this service's origin |
| No userinfo | `https://user:secret@host/` would put a credential in `Location` |
| Block localhost, loopback, link-local, RFC1918, CGNAT, IPv6 ULA/link-local, IPv4-mapped forms, and dword/shorthand IPv4 | Structural SSRF / open-redirect-to-internal-network. Checked on the hostname as written, including `127.1` and `2130706433` |
| Never fetch, never DNS-resolve | Looking up a caller-supplied hostname is the SSRF. Reachability checks, title fetches, and malware scans are out of scope because they are outbound requests |
| Re-check on redirect | A row inserted by a bug or an older policy must not 302 to `javascript:` |

**Accepted residual:** a public hostname whose DNS A/AAAA record points at a private address passes the policy. Catching that requires DNS, which we refuse. The service still never connects to that address; only the visitor's browser does.

**Not in this story:** malware/phishing reputation, IDN homograph scoring beyond what `URL` already parses.

## Authentication

**Module:** `src/security/auth.ts`.

| Decision | Why |
| --- | --- |
| Bearer token on every mutating and admin read | Unauthenticated create is an open-redirect factory. Redirect stays public or the product does not work |
| Stored as SHA-256, never the raw key | A database dump must not become a working credential |
| `timingSafeEqual` on the returned hash versus the computed digest | The issue requires constant-time comparison against the stored hash. A dummy 32-byte compare runs when no row matches, so the miss path still does a compare |
| Missing, malformed, unknown, and revoked keys all return the same 401 body | Distinguishing them is an oracle |
| Prefix of 8 characters is what may appear in logs | Operators can say "which key" without the secret |

Revocation is `revoked_at IS NOT NULL`. Revoked rows are kept as audit evidence.

## Reserved codes

`health`, `ready`, `api`, `openapi`, and `favicon` are never minted, never accepted as `customAlias`, and never resolved as codes. `openapi` and `favicon` are seven characters of base62, so a naive generator could collide with a real route. Aliases are 4–32 characters, so `health` and `ready` would otherwise be legal identifiers. Create rejects reserved aliases with `400`; redirect 404s them without a database lookup.

## Logging

`Authorization` and `Cookie` are removed from log events, not masked. Request serializers omit the client IP. Each request logs method, path, status, duration, and a request id (`x-request-id` inbound is honoured when well-formed). Raw keys and raw IPs are forbidden in log output by `AGENTS.md`.

**Human sign-off for #16:** confirm that no secret, API key, or raw client address reaches logs.

## Residual risks this story does not close

- Short-code enumeration on the public redirect (rate limiting is issue #14; values below)
- Takedown / cache invalidation (issue #15)
- Per-key ownership of stats (signed off separately under #12)
- DNS-to-private-IP destinations, as above

## Rate limits (issue #14)

Fixed 60-second windows, stored in Redis as `rl:create:v1:<apiKeyId>:<window>` and `rl:redirect:v1:<ipDigest>:<window>`.

| Path | Key | Default | Why |
| --- | --- | --- | --- |
| `POST /api/v1/urls` | API key id | 30 / minute | Enough for a client; bulk minting is the abuse we care about |
| `GET /:code` | SHA-256 of `rl:<pepper>:<ip>`, 32 hex chars | 120 / minute | ~2/s covers a person plus unfurls. 62^7 codes at 2/s is not a feasible enumeration |

Client IP is hashed before it becomes a Redis key. Raw IPs are not stored and are not logged.

**Redis unavailable: fail open.** A 429 that fires because Redis is down takes the product down with the limiter. The limiter logs and allows the request. This is the architecture contract: Redis never changes a correct answer. Create and redirect both fail open.

Counters expire with the window (`EXPIRE` on first `INCR`), so a client recovers without a restart.

**Human sign-off for #14:** these numeric defaults and fail-open. Confirm those, not merely that the tests are green.

## Open redirect

The product is an open redirect with a structural allow-list. Containment is https-only destinations, no `javascript:`/`data:`/`file:`, `302` rather than `301`, and `Cache-Control: private, no-store`. Takedown is a soft delete plus an explicit cache `DEL`. A 301 or a cached 302 would make takedown a suggestion.

## Short-code enumeration

Codes are 7 characters of CSPRNG base62 (~3.5×10¹²). They are not sequential. The public `GET /:code` is rate-limited by hashed IP (120/minute default). 404 bodies do not distinguish missing, expired, and deleted. That slows guessing; it does not make an unauthenticated redirect unguessable. Treat the code as a capability URL.

## Credential handling

API keys are SHA-256 at rest, compared with `timingSafeEqual`, shown in logs only as an 8-character prefix. Missing and invalid keys share one 401. `.env` is git-ignored. Revoked rows remain for audit and fail the same 401.

## Cache staleness

Redirect uses cache-aside (`url:v1:<code>`). A hit still re-checks expiry and deletion in the cached payload; TTL is a backstop, not the takedown mechanism. On delete, the transaction commits first, then `DEL` runs twice; a second failure is `500`, not `204`. Negative cache entries TTL out (60s) so a newly created code is not stuck 404. Losing Redis is a miss, not a wrong answer.

**Accepted residual:** a client that ignored `Cache-Control` can keep a 302. We cannot fix other people's caches; we can refuse to emit `301`.

## Analytics loss

Click rows are written from an in-process queue after the 302 is sent. A crash, a full queue (10k), or a failed `INSERT` drops events. Redis `clicks:total:v1:*` counters may drift and are **not** what `GET .../stats` reads. Stats always aggregate `click_events` in SQL. v1 prefers a redirect that succeeds over a complete ledger.

## Human sign-off

Required by the issue: the allow/deny list and the authentication path. Confirm those two, not merely that the tests are green.
