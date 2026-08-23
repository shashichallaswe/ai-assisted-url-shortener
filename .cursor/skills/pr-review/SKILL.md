---
name: pr-review
description: Reviews a GitHub pull request end to end, checking the description, acceptance criteria, commit history, tests, and risk before approving or requesting changes. Use when reviewing a PR, preparing a PR for review, or when the user mentions PR review or approving a pull request.
---

# Pull request review

A PR is a proposal to change production. Approving it means you share responsibility for the outcome.

## Gather context first

```bash
gh pr view <number> --json title,body,files,additions,deletions
gh pr diff <number>
gh pr checks <number>
```

Read the linked issue before the diff. Without the requirement, you can only review style.

## Review sequence

### 1. The proposal

- [ ] Description explains what changed and why, understandable without the diff
- [ ] Links its issue with `Closes #<n>`
- [ ] Acceptance criteria listed and genuinely satisfied
- [ ] Testing section says what was verified and how to reproduce
- [ ] Risk and rollback stated
- [ ] AI assistance disclosed: generated, edited, rejected

A PR that cannot explain itself is not ready, regardless of code quality.

### 2. Scope

- [ ] One story, one PR
- [ ] Roughly under 400 changed lines, or a stated reason it could not be split
- [ ] No unrelated refactors, renames, or drive-by changes
- [ ] No new product surface the story did not ask for

### 3. Commit history

- [ ] Commits are small and typed: `test(#n):`, `feat(#n):`, `fix(#n):`, `docs(#n):`
- [ ] History shows the process: failing test, then implementation
- [ ] Each commit is plausibly green on its own
- [ ] No "wip", "fix fix", or a single opaque squashed commit

The history is evidence of engineering discipline. Absent history means the process was reconstructed afterward.

### 4. The code

Apply the `code-review` skill: design, correctness, security, tests, maintainability.

Apply the `security-review` skill if the diff touches auth, URL handling, secrets, rate limits, or logging.

### 5. Checks and gates

- [ ] Typecheck, lint, and tests pass
- [ ] Documentation and `openapi.yaml` match the code
- [ ] `docs/ai-traceability.md` updated

### 6. Sign-off areas

Confirm explicit engineer approval when the change touches URL allow/deny policy, authentication, cache invalidation, uniqueness handling, or the threat model. These are never approved on generated code alone.

## Verdict

A review verdict is a recommendation, not an action. **Reviewing never includes merging**, even after an approving verdict: the merge is performed by a human. State the verdict, then stop.

**Approve** - you would defend this change in an incident review.

**Approve with suggestions** - nothing blocking; the author decides on the rest.

**Request changes** - a correctness, security, scope, or test gap exists. Say precisely what must change and why.

**Comment** - you lack the context to judge; name what you need.

## Writing comments

Anchor to a line, state the consequence, propose a direction:

> **Blocking** - a missing `Authorization` header reaches `.split()` on `undefined` and returns 500 instead of 401. Guard before parsing and return 401.

Acknowledge good work explicitly. Review is not only defect-finding, and noting a strong test or a clean boundary reinforces the standard.

Never approve to be agreeable, and never block on preference. Distinguish "this is wrong" from "I would have done it differently."
