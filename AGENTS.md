# AGENTS.md

Engineer-led URL shortener built for a Charles Schwab lead-engineer assessment. **AI assists inside one story at a time. The engineer owns correctness, sequencing, and production readiness.**

Read this file before doing anything. It is the contract.

## 1. How to pick work

1. Open the board: https://github.com/users/shashichallaswe/projects/1/views/1
2. Work the single issue in **In progress**. If none, take the highest-priority **Ready** item and move it.
3. Never work two stories at once. Never start a story whose dependencies are open.

Epics (#2-#6) are containers. You implement **stories**, never epics.

## 2. Pick the workflow

| Situation | Follow |
| --- | --- |
| New capability from a story | [docs/workflows/feature.md](docs/workflows/feature.md) |
| Something is broken | [docs/workflows/bugfix.md](docs/workflows/bugfix.md) |
| Ready to propose the change | [docs/workflows/pr.md](docs/workflows/pr.md) |

Engineering non-negotiables live in [docs/principles.md](docs/principles.md).

## 3. Process skills

Invoke these by name; each defines a required process:

| Skill | Use when |
| --- | --- |
| `tdd` | Writing any behavior. Test first, always |
| `api-design` | Adding or changing an HTTP endpoint |
| `architecture` | A change spans modules, storage, or introduces a dependency |
| `security-review` | Touching auth, URL policy, secrets, rate limits, or user input |
| `code-review` | Before opening a PR, review your own diff |
| `pr-review` | Reviewing a PR, yours or otherwise |

## 4. Task protocol

Every unit of agent work states, before code:

- **Intent** - what done looks like
- **Constraints** - invariants that must not break
- **Acceptance criteria** - copied from the issue, as checkboxes
- **Files** - what you expect to touch
- **Out of scope** - what you will deliberately not do

If the issue does not give you these, stop and improve the issue first.

## 5. Commit discipline

One story produces **several small commits**, not one large one. Each commit compiles and has a green suite.

Format: `<type>(#<issue>): <imperative summary>`

Types: `test`, `feat`, `fix`, `refactor`, `docs`, `chore`, `security`

A typical story history:

```
test(#9): add failing spec for short code collision retry
feat(#9): generate unique 7-char base62 codes
test(#9): cover rejection of non-https destinations
feat(#9): enforce URL policy on create
docs(#9): document create endpoint in openapi.yaml
```

Commit when a test goes green, not when the story ends.

## 6. Branch and PR flow

- Branch per story: `story/<issue-number>-<slug>` (`story/9-implement-url-creation`)
- Never commit directly to `main`; the harness blocks it
- Open a PR per story, link it to the issue with `Closes #9`
- Run `pr-review` before requesting human review
- **Never merge a pull request.** Opening it is where your authority ends

Helper: `python3 scripts/story.py start 9` and `python3 scripts/story.py pr 9`

## 7. Quality gates

Run before every commit that changes code:

```bash
npm run typecheck && npm run lint && npm test
```

A story is not done until its acceptance criteria are checked, gates pass, and documentation reflects reality.

## 8. AI traceability

After any AI-assisted change, append a row:

```bash
python3 scripts/ai_log.py --issue 9 --summary "create endpoint" \
  --generated "route + service scaffold" \
  --edited "tightened URL validation" \
  --rejected "in-memory store; loses data on restart" \
  --gates "typecheck,lint,test"
```

This log is graded evidence. An empty log means the process was not followed.

## 9. Human approval

**No pull request is merged without a human. This has no exceptions.**

You may: open the PR, respond to review comments, push follow-up commits, and rerun the gates. You may not: merge, squash-merge, rebase-merge, enable auto-merge, close a PR as an alternative to merging, or push the branch's commits onto `main` by any other route. The harness blocks these; do not look for a way around them.

When a PR is ready, say so and stop. Report what changed, which gates passed, and what you want the reviewer to look at.

These areas additionally require the reviewer to explicitly confirm the design, not just the diff:

- URL allow/deny policy
- Authentication and credential handling
- Cache invalidation logic
- Short-code uniqueness and collision handling
- Threat model and rate-limit values

Say plainly when a change enters one of these areas.

## 10. Hard guardrails

Enforced by hooks in `.cursor/hooks/`, not by good intentions:

- No merging pull requests, and no merging anything into `main`
- No commits on `main`, no force-push to `main`
- No `--no-verify`
- No committing `.env`, keys, or credential-shaped strings
- Destructive commands require confirmation

## 11. Never

- Merge a pull request, or land code on `main` without a human
- Fetch, resolve, or crawl a destination URL (server-side request forgery)
- Use 301 for redirects; it is always 302
- Log raw API keys or raw IP addresses
- Add product features not named in the current story
- Weaken or skip a test to make a build pass
- Orchestrate multiple stories autonomously
