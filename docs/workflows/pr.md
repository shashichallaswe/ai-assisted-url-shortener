# Pull request workflow

A PR is a proposal a reviewer must be able to evaluate quickly and trust. Preparation is your job, not theirs.

## Before opening

- [ ] Branch is `story/<issue>-<slug>` and rebased on current `main`
- [ ] `npm run typecheck && npm run lint && npm test` all pass
- [ ] `code-review` skill run against your own diff
- [ ] `security-review` skill run if the change touches sensitive areas
- [ ] Docs, OpenAPI, and traceability updated
- [ ] Every acceptance criterion on the issue is genuinely satisfied
- [ ] No debugging output, commented-out code, or unrelated changes

## Opening

```bash
python3 scripts/story.py pr <issue>
```

The PR body must contain:

**Summary** - what changed and why, in plain language. The reviewer should understand the point without reading the diff.

**Closes #\<issue\>** - links the PR so merging closes the story.

**Acceptance criteria** - the issue's checkboxes, each checked, each verifiable.

**Testing** - what you tested and how a reviewer reproduces it. Name the tests and give the commands.

**Risk and rollback** - what could break, what is not covered, and how to undo it.

**AI assistance** - what was generated, what you changed, what you rejected and why.

**Sign-off needed** - name explicitly if this touches URL policy, auth, cache invalidation, uniqueness, or the threat model.

## Keeping it reviewable

A reviewable PR is one story, ideally under roughly 400 changed lines. If it is larger, that is usually a decomposition failure: split it, stack it, or explain in the description why it could not be split.

Commit history should read as the story of the work: failing test, implementation, refactor, docs. Do not squash that into a single opaque commit.

## Reviewing

Use the `pr-review` skill. Review in this order, because a design flaw makes line-level comments irrelevant:

1. Does it solve the stated problem?
2. Is the design right?
3. Is it correct, including edge cases?
4. Is it secure?
5. Are the tests real, and would they catch a regression?
6. Is it maintainable?

Classify every comment so the author knows what blocks:

- **Blocking** - must change before merge
- **Suggestion** - should consider, author decides
- **Nit** - style or preference, never blocks

Approving means you accept shared responsibility for the change. If you would not defend it in an incident review, do not approve it.

## Responding to review

Address every comment: fix it, or reply with reasoning. Push follow-up commits rather than rewriting history mid-review, so the reviewer can see what changed.

Disagreement is fine and is resolved with evidence, not seniority.

## Merging

**Merging is a human action. An agent never performs it, on any pull request, for any reason.**

The agent's job ends at "ready for review". Hand off with a short status: what changed, which gates passed, what needs attention, and whether the change touches a sign-off area.

A human then confirms:

- [ ] Approval obtained, including explicit design confirmation for high-impact areas
- [ ] All conversations resolved
- [ ] Checks green
- [ ] Merge without squashing, preserving the commit history
- [ ] Issue closed and the board item moved to **Done**
- [ ] Branch deleted

The harness blocks `gh pr merge`, auto-merge, and merges into `main`. If you find yourself wanting to work around that block, the answer is to ask the reviewer instead.
