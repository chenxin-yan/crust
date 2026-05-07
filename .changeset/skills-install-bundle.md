---
"@crustjs/skills": minor
---

**Add `installSkillBundle()` for hand-authored skill bundles.**

New `installSkillBundle(options)` entrypoint installs a directory containing
`SKILL.md` and supporting files through the same canonical-store + agent
fan-out pipeline used by `generateSkill()`. Bundle authors own the
`SKILL.md` frontmatter — Crust copies the directory verbatim (with root-only
exclusions for `node_modules/`, `.git/`, `.DS_Store`, dotfiles, and any
stale `crust.json`) and writes a fresh `crust.json` for ownership tracking.

```ts
import { installSkillBundle } from "@crustjs/skills";

await installSkillBundle({
  meta: { name: "funnel-builder", description: "Build a sales funnel", version: "1.0.0" },
  sourceDir: "skills/funnel-builder",
  agents: ["claude-code"],
});
```

`sourceDir` accepts an absolute path, a `file:` URL, or a relative path
resolved from the nearest `package.json` walking up from `process.argv[1]`
(matching `@crustjs/create`'s template resolution).

**Additive `kind` field on `crust.json`.** Generated and bundle skills now
record their origin in `crust.json` as `kind: "generated" | "bundle"`.
Legacy `crust.json` files written before this field existed are read as
`"generated"` for backward compatibility — existing generated installs
continue to update cleanly without a migration step.

**New `kindMismatch` detail on `SkillConflictError`.** Attempting to install
a bundle on top of a generated skill (or vice versa) at the same name now
throws `SkillConflictError` with `details.kindMismatch: { existing,
attempted }`. Pass `force: true` to overwrite, or uninstall the existing
skill first.

`generateSkill()` behaviour is unchanged for existing callers.

Resolves part of #110 (the lower-level primitive half; plugin integration
via `skillPlugin({ customSkills })` is tracked separately).
