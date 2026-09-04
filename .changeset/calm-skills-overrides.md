---
"@crustjs/skills": minor
---

Rework skill build options (breaking).

- `writeSkills()` takes a single options object; `app` is optional, and omitting it writes only authored `extras`. Writing no skills at all is an error.
- The `skill()` Extension's build hook always renders the generated skill and `extras` from the Command Snapshot; it no longer copies an existing `distDir`, so `crust build` output cannot go stale. `distDir` is read only at runtime.
- `name` and `description` override the generated skill's frontmatter in every build path, `generated: false` ships only `extras`, and an authored extra with the generated skill's name replaces it.
