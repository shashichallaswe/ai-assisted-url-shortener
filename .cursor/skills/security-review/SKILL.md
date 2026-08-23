---
name: security-review
description: Security review process for this URL shortener, covering open redirect and server-side request forgery risks, credential handling, injection, abuse controls, and data exposure. Use when changing authentication, URL validation, rate limits, logging, or handling user input, and when the user asks for a security review.
---

# Security review

Run this before opening a pull request that touches authentication, URL handling, secrets, rate limiting, or any user-supplied input reaching a query or a log.

## Threats specific to this service

A URL shortener is an open redirect and an abuse amplifier by default. These are the risks that matter most here.

### Open redirect

The service redirects to attacker-chosen destinations by design, so containment comes from validation and takedown.

- [ ] Only absolute `https` URLs accepted
- [ ] `javascript:`, `data:`, `file:`, and other schemes rejected
- [ ] Destination validated at creation and re-checked from stored data on redirect
- [ ] `Cache-Control: private, no-store` on redirects so takedown is immediate
- [ ] 302, never 301

### Server-side request forgery

- [ ] **The service never fetches, resolves, or crawls a destination URL.** No preview, no title lookup, no reachability check
- [ ] Localhost, loopback, link-local, and private IPv4 ranges rejected structurally
- [ ] No user input reaches an outbound request of any kind

### Enumeration

- [ ] Short codes come from a cryptographically secure generator, never sequential identifiers
- [ ] Redirect endpoint is rate limited by client address
- [ ] 404 responses do not distinguish "never existed" from "expired" or "deleted"

### Credentials

- [ ] API keys stored as hashes, never plaintext
- [ ] Comparison is constant-time
- [ ] Keys never appear in logs, error messages, URLs, or committed files
- [ ] `.env` is git-ignored; `.env.example` holds placeholders only
- [ ] Revoked keys are rejected

### Injection

- [ ] All queries are parameterized or built through the query builder; no string concatenation
- [ ] All input parsed and validated with Zod at the boundary
- [ ] Length limits on every string field that reaches storage

### Data exposure

- [ ] IP addresses hashed before storage
- [ ] User agents truncated
- [ ] Errors return generic messages; detail goes to logs only
- [ ] No stack traces, SQL, or internal paths in responses
- [ ] Authorization headers redacted in log output

### Availability

- [ ] Rate limits on both creation and redirect
- [ ] Behavior when Redis is unavailable is decided, documented, and tested
- [ ] No unbounded query; every list is bounded
- [ ] Failure of analytics cannot fail a redirect

## Process

1. Read the diff specifically for the checklist areas it touches
2. For each finding, state the vulnerability, how it is exploited, and the fix
3. Fix findings before the PR; do not file them as follow-ups
4. If the change enters a sign-off area, say so explicitly and wait for approval

## Severity

- **Critical** - exploitable now, exposes data or enables abuse. Blocks the PR
- **High** - exploitable under plausible conditions. Blocks the PR
- **Medium** - defense in depth is missing. Fix now or record the accepted risk in writing
- **Low** - hardening. Note it and move on

## Human sign-off

These require explicit engineer approval and cannot be self-approved on AI output alone:

- URL allow/deny policy
- Authentication and credential handling
- Rate-limit values and the Redis-unavailable failure mode
- The threat model itself

## Never accept from a generator

Security logic is where plausible-looking code is most dangerous. Review these line by line, and reject anything you cannot explain:

- Hand-rolled cryptography or a homemade token scheme
- A permissive URL check such as a substring match on `https`
- A blocklist where an allowlist is possible
- `catch` blocks that swallow authentication failures
- Debug branches that bypass a check
