# Feature workflow

For implementing a story from the board. Copy the checklist into your working notes and keep it updated.

```
- [ ] 1. Claim the story
- [ ] 2. Restate the task protocol
- [ ] 3. Design gate
- [ ] 4. TDD loop (repeat per acceptance criterion)
- [ ] 5. Security gate
- [ ] 6. Self code review
- [ ] 7. Documentation
- [ ] 8. Open PR
```

## 1. Claim the story

```bash
python3 scripts/story.py start <issue>
```

This verifies the issue's dependencies are closed, creates `story/<n>-<slug>` from an up-to-date `main`, and moves the board item to **In progress**.

Stop here if dependencies are open. Sequence exists for a reason.

## 2. Restate the task protocol

Before writing code, write out intent, constraints, acceptance criteria, files, and out-of-scope (see [AGENTS.md](../../AGENTS.md) section 4). Copy the acceptance criteria verbatim from the issue as checkboxes.

If the issue is too vague to do this, fix the issue first. Implementing a vague story produces a vague result.

## 3. Design gate

Skip only when the change is local to one existing module.

| Trigger | Required |
| --- | --- |
| New or changed HTTP endpoint | `api-design` skill |
| Change spans modules, storage, or adds a dependency | `architecture` skill |

Design output is a short written decision, not a document for its own sake. Commit it if it changes `docs/architecture.md`.

## 4. TDD loop

Follow the `tdd` skill. Per acceptance criterion:

1. Write the failing test. **Run it and watch it fail.**
2. Commit: `test(#<issue>): <what is now asserted>`
3. Write the minimum code to pass
4. Run `npm run typecheck && npm run lint && npm test`
5. Commit: `feat(#<issue>): <what now works>`
6. Refactor if needed, keeping green; commit separately as `refactor(#<issue>): ...`

Do not batch several criteria into one commit. The history is evidence of process.

Cover the negative cases the issue names: 400, 401, 404, 409, 429. A story that only tests the happy path is not done.

## 5. Security gate

Run the `security-review` skill when the change touches any of:

- Authentication, credentials, or secrets
- URL validation or redirect targets
- Rate limiting or abuse controls
- Anything reading user-supplied input into a query or log

Findings are fixed before the PR, not filed as follow-ups. If the change enters a **human sign-off** area (AGENTS.md section 9), say so explicitly and wait.

## 6. Self code review

Run the `code-review` skill against your own diff before anyone else sees it:

```bash
git diff main...HEAD
```

Fix what you find. Reviewers should spend attention on design, not on things you could have caught.

## 7. Documentation

Update in the same PR, never "later":

- `openapi.yaml` when an endpoint changed
- `docs/architecture.md` when a component or flow changed
- `README.md` when setup or commands changed
- `docs/ai-traceability.md` via `scripts/ai_log.py`

Commit as `docs(#<issue>): ...`

## 8. Open PR

```bash
python3 scripts/story.py pr <issue>
```

Then follow [pr.md](pr.md). Verify every acceptance criterion checkbox on the issue is genuinely satisfied before requesting review.

**This is where the work stops.** Report status to the reviewer and wait. Do not merge the pull request; that decision belongs to a human.

## Definition of done

- [ ] Every acceptance criterion checked and true
- [ ] Negative cases tested
- [ ] typecheck, lint, tests green
- [ ] Docs and OpenAPI match the code
- [ ] Traceability row written
- [ ] PR open and linked with `Closes #<issue>`
- [ ] Status handed to the reviewer; merge left to a human
