---
name: tdd
description: Test-driven development process for this repository, covering the red-green-refactor loop, what to test at which level, and commit checkpoints. Use when implementing any behavior change, writing tests, or when the user mentions TDD, failing tests, or test coverage.
---

# Test-driven development

Behavior does not exist until a test asserts it. Write the test first, watch it fail, then make it pass.

## The loop

Per acceptance criterion, not per story:

1. **Red** - write the smallest failing test for one criterion
2. **Verify red** - run it and confirm it fails *for the intended reason*, not a setup error
3. Commit `test(#<issue>): <what is now asserted>`
4. **Green** - write the minimum code to pass. Resist implementing the next criterion early
5. **Verify** - `npm run typecheck && npm run lint && npm test`
6. Commit `feat(#<issue>): <what now works>`
7. **Refactor** - improve structure while green; commit separately as `refactor(#<issue>): ...`

A test that has never failed is not evidence. If it passed before your change, it is testing the wrong thing.

## Choosing the level

| Level | Use for | Speed |
| --- | --- | --- |
| Unit | Pure logic: code generation, URL policy, validation, formatting | Milliseconds, no I/O |
| Integration | Wiring: routes, database, cache, auth, full request lifecycle | Requires Docker Compose |

Default to unit. Reach for integration when the risk lives in the seams between components rather than inside one.

Integration tests must **skip, not fail**, when infrastructure is unavailable, so a clean checkout stays green.

## What to test

For every endpoint, cover the failure modes the issue names, not just the happy path:

- Success with the expected status code and body shape
- 400 for each distinct validation rejection
- 401 for missing and for invalid credentials
- 404 for missing, expired, and deleted resources
- 409 for conflicts such as duplicate aliases or idempotency mismatch
- 429 when a limit is exceeded

For pure logic, test the boundaries: empty, maximum length, one past the limit, wrong type, and the specific values the code branches on.

## What not to test

- Framework or library behavior; assume Fastify routes and Zod validates
- Private helpers; test them through their public entry point
- Exact log strings, unless the log is the feature

## Determinism

Tests must not depend on wall-clock timing, network access, or execution order.

- Inject or control time rather than sleeping
- Never call a real external URL; this service must never fetch destinations
- Each test creates its own data and does not rely on another test's leftovers

## Anti-patterns

**Writing the test after the code.** It documents what you built instead of challenging it, and it never fails.

**Asserting implementation details.** Assert observable behavior, so a refactor does not break the suite.

**Weakening a test to make the build pass.** If a test fails, either the code is wrong or the test encoded the wrong expectation. Decide which, in writing. Never loosen an assertion to get green.

**One giant test.** Each test should fail for exactly one reason.

## Definition of done

- [ ] Every acceptance criterion has at least one test
- [ ] Each test was observed failing before its implementation existed
- [ ] Negative cases covered
- [ ] Suite passes from a clean checkout
- [ ] No test was weakened to achieve green
