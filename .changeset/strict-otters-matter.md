---
"@crustjs/skills": patch
---

Strengthen generated skill guidance to reduce CLI command hallucinations.

- `SKILL.md` now explicitly requires reading the mapped command doc before giving command-specific answers.
- Generated command docs now include an authority section stating that only documented flags/options/aliases/defaults are supported.
- Rendering and e2e tests were updated to enforce the stricter verification contract.
