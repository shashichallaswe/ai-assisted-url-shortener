# AI traceability

Every AI-assisted change is recorded here: what was generated, what the engineer
changed, what was rejected and why, which gates ran, and who signed off.
Maintained by `scripts/ai_log.py`.

| Date | Issue | Commit | Summary | Generated | Edited | Rejected (why) | Gates | Sign-off |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-22 | #1 | 01cffba | Requirements, assumptions, and v1 scope; engineering harness | assumptions.md draft: ambiguity table, API surface, non-goals, environment assumptions | aligned API surface with the contracts already promised in stories #9-#18; added 404 parity for expired/deleted links; added hashed-IP and hashed-API-key assumptions; added base-URL-from-config note | 301 redirects (breaks analytics and takedown); fetching destinations for validation (SSRF); custom aliases in v1 (reserved for the brownfield story); geo/device analytics (not requested, adds PII) | n/a - documentation only, no build yet | pending human review |
