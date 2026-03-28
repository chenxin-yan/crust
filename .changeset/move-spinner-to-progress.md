---
"@crustjs/progress": minor
"@crustjs/prompts": patch
"@crustjs/skills": patch
"create-crust": patch
---

Add a new `@crustjs/progress` package and move the canonical `spinner()` implementation there.

`@crustjs/prompts` now temporarily re-exports `spinner` and related types as deprecated compatibility exports, with removal planned for `v0.1.0`.

Update internal consumers and docs to use `@crustjs/progress` as the new home for spinner-based progress UI.
