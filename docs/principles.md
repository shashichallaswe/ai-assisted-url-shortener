# Engineering principles

The rules in [AGENTS.md](../AGENTS.md) say what to do. These say why, and they decide arguments the rules do not cover.

## 1. The engineer owns the output

AI accelerates work inside a task; it never owns the result. Every generated line is reviewed before it is committed, and "the model wrote it" is not a defense in review. If you cannot explain a line, it does not ship.

## 2. Tests define done

Behavior does not exist until a test asserts it. Write the failing test first: it forces the interface to be designed from the caller's side and proves the test can fail. A suite that has never failed proves nothing.

## 3. Small, reversible changes

Prefer many small commits over one large one. Each commit should compile, pass, and be revertible on its own. Large changes hide defects and make bisecting useless.

## 4. Make the correct path the easy path

If a rule depends on remembering it, it will be broken. Encode it: a hook, a type, a constraint, a test. Documentation is the weakest form of enforcement and the last resort.

## 5. Explicit beats clever

Prefer boring, readable constructs over frameworks and metaprogramming. Optimize for the engineer debugging this at 2am with no context, not for the author's convenience today.

## 6. Security is a requirement, not a phase

A URL shortener is an open redirect and an abuse vector by default. Validation, authentication, and rate limits are acceptance criteria, not follow-up tickets. Never fetch a destination URL; structural validation only.

## 7. The hot path degrades, it does not fail

A redirect must survive the failure of anything non-essential. Analytics, counters, and caches are best-effort: they log and move on. Only the source of truth may block a response.

## 8. Persist the truth, cache the rest

PostgreSQL is authoritative. Redis is an accelerator that may be cold, stale, or gone. Any state that matters must be recoverable without the cache, and invalidation must be explicit rather than left to expiry.

## 9. Document decisions, not mechanics

Code shows what happens; comments and docs explain why this option beat the alternatives. Record rejected options with their reasoning, because that is what a reviewer cannot reconstruct.

## 10. Change with evidence

Before changing existing code, identify what depends on it. After changing it, prove the old behavior still holds with a regression test. Inherited code is guilty until tested, not until read.

## 11. Ambiguity is resolved in writing, before code

When a requirement is vague, write the interpretation down, list the alternatives rejected, and name the questions you would ask a stakeholder. Then build only what the interpretation claims.

## 12. Honest limitations

State what is not built, not tested, and not safe for production. An accurate limitation is worth more than an optimistic claim, and reviewers trust work that admits its edges.
