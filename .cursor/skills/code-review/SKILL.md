---
name: code-review
description: Reviews a code diff for correctness, design, security, testing, and maintainability against this repository's standards. Use before opening a pull request to review your own changes, or when the user asks for a code review of local changes.
---

# Code review

Run against your own diff before anyone else sees it. Reviewers should spend their attention on design, not on what you could have caught yourself.

```bash
git diff main...HEAD
```

## Review order

Work top-down. A design flaw makes line-level comments irrelevant.

### 1. Does it solve the stated problem?

- [ ] Every acceptance criterion on the issue is genuinely satisfied, not approximately
- [ ] Nothing outside the story's scope is included
- [ ] Nothing the story required is quietly missing

### 2. Design

- [ ] Layering respected: routes do HTTP, services hold rules, repos do data (see the `architecture` skill)
- [ ] No business logic in a route handler
- [ ] No duplication of an existing helper
- [ ] Abstractions earn their cost; no speculative generality
- [ ] Names say what the thing is; no `data`, `info`, `handle`, `process`

### 3. Correctness

- [ ] Edge cases handled: empty, null, boundary values, maximum length
- [ ] Errors handled deliberately, never swallowed
- [ ] `async` code awaited; no floating promises
- [ ] No race between check and use, particularly around uniqueness
- [ ] Time handled in UTC with explicit comparison

### 4. Security

Run the `security-review` skill if the diff touches auth, URL handling, secrets, limits, or logging. At minimum:

- [ ] Input validated at the boundary
- [ ] Queries parameterized
- [ ] No secret, key, or raw IP in code or logs
- [ ] No destination URL is fetched

### 5. Tests

- [ ] Each acceptance criterion has a test
- [ ] Tests assert behavior, not implementation detail
- [ ] Negative cases covered, not only the happy path
- [ ] No test was weakened or skipped to reach green
- [ ] Tests are deterministic: no sleeps, no network, no ordering dependence

### 6. Maintainability

- [ ] The next engineer can follow it without the author
- [ ] Comments explain *why*, never *what*
- [ ] No dead code, commented-out blocks, or debug output
- [ ] Types are precise; `any` is justified or removed
- [ ] Public functions have meaningful signatures

### 7. Hygiene

- [ ] Commits are small, typed, and reference the issue
- [ ] No unrelated changes riding along
- [ ] `openapi.yaml` and docs updated if behavior changed
- [ ] Traceability row written if AI assisted

## Feedback format

Classify every comment so the author knows what actually blocks:

- **Blocking** - correctness, security, or a design flaw. Must change
- **Suggestion** - a better approach exists; author decides
- **Nit** - style or preference; never blocks

State the problem and its consequence, not just a preference. "This throws when the header is absent, returning 500 instead of 401" is actionable. "I would do this differently" is not.

## Reviewing generated code

Apply extra scrutiny where a generator tends to produce plausible but wrong output:

- Invented APIs or options that do not exist
- Error handling that catches and silently continues
- Tests that assert the implementation rather than the requirement
- Confident-looking security logic that is subtly permissive
- Unnecessary dependencies pulled in for something the standard library does

If you cannot explain why a line is correct, it does not ship.
