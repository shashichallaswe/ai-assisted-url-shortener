# Bugfix workflow

For defects in existing behavior. The discipline that separates a fix from a patch is proving the bug exists before you touch the code.

```
- [ ] 1. Reproduce
- [ ] 2. Write the failing test
- [ ] 3. Find the root cause
- [ ] 4. Minimal fix
- [ ] 5. Check for siblings
- [ ] 6. Regression guard
- [ ] 7. PR
```

## 1. Reproduce

Establish the exact conditions: request, data state, and observed versus expected behavior. Record the reproduction in the issue.

If you cannot reproduce it, do not fix it. A change that "should help" is a guess, and guesses cost more than they save.

## 2. Write the failing test

Encode the bug as a test at the tightest level that still fails: unit if the defect is in logic, integration if it emerges from wiring.

Run it. **It must fail for the reason you expect**, not for a setup error. A test that passes before your fix proves nothing about the bug.

Commit: `test(#<issue>): reproduce <defect>`

## 3. Find the root cause

Trace from symptom to cause. Name the actual defect: a wrong boundary, a missing guard, an unhandled state, a bad assumption about an external system.

Resist fixing the first suspicious line. The first suspicious line is usually a symptom of the real cause upstream.

State the root cause in one sentence in the issue before continuing. If you cannot, keep investigating.

## 4. Minimal fix

Change the least code that makes the test pass. Do not bundle refactors, renames, or unrelated improvements. Those are separate commits at minimum, separate PRs preferably.

Run the full suite: `npm run typecheck && npm run lint && npm test`

Commit: `fix(#<issue>): <root cause corrected>`

## 5. Check for siblings

The same mistake usually appears more than once. Search for the pattern elsewhere:

- Same missing guard on a sibling route
- Same boundary error on a related field
- Same assumption in another module

Fix what you find, or file it explicitly. Silence is not triage.

## 6. Regression guard

Ask what would have caught this earlier, and add that:

- Missing edge-case coverage, now added
- A type that permitted an invalid state, now narrowed
- A silent failure path, now logged or surfaced

For a security-relevant defect, run the `security-review` skill before the PR.

## 7. PR

Follow [pr.md](pr.md). The description must state:

- **Symptom** the user experienced
- **Root cause** in one sentence
- **Fix** and why it is the minimal correct one
- **Prevention** added so it cannot silently return

Log the work with `scripts/ai_log.py` if AI assisted. Open the PR and stop; a human merges it.

## Definition of done

- [ ] A test that failed before the fix and passes after
- [ ] Root cause stated, not just the symptom
- [ ] Sibling occurrences checked
- [ ] Full suite green
- [ ] No unrelated changes in the diff
