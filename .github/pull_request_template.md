## Summary

<!-- What changed and why, understandable without reading the diff. -->

Closes #

## Acceptance criteria

<!-- Copy the checkboxes from the issue. Each must be genuinely satisfied. -->

## Testing

<!-- What you verified and how a reviewer reproduces it. Name the tests. -->

```bash
npm run typecheck && npm run lint && npm test
```

## Risk and rollback

<!-- What could break, what is not covered, how to undo this. -->

## AI assistance

- Generated:
- Edited:
- Rejected (and why):

## Sign-off

<!-- Required if this touches URL allow/deny policy, authentication, cache
     invalidation, short-code uniqueness, or the threat model. Name it. -->

## Checklist

- [ ] Branch is `story/<issue>-<slug>` and rebased on `main`
- [ ] `npm run typecheck && npm run lint && npm test` pass
- [ ] `code-review` skill run against my own diff
- [ ] `security-review` skill run if this touches sensitive areas
- [ ] Docs, `openapi.yaml`, and `docs/ai-traceability.md` updated
- [ ] Commits are small, typed, and reference the issue
