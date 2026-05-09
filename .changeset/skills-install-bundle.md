---
"@crustjs/skills": minor
---

**Add `installSkillBundle()` for hand-authored skill bundles.**

New `installSkillBundle(options)` entrypoint installs a directory containing
`SKILL.md` and supporting files through the same canonical-store + agent
fan-out pipeline used by `generateSkill()`. The bundle's `SKILL.md`
frontmatter is the source of truth for `name` and `description` — both are
required, and Crust reads them without rewriting the file. The bundle's
`version` defaults to the consuming package's `package.json` `version`; pass
`version` explicitly to override. Files are copied as UTF-8 text (binary
supporting files are not supported). Root-only exclusions: `node_modules/`,
`.DS_Store`, root dotfiles (`.git/`, `.editorconfig`, etc.), and any stale
`crust.json`. Crust then writes a fresh `crust.json` for ownership tracking.

```ts
import { installSkillBundle } from "@crustjs/skills";

// Common case — name + description from SKILL.md frontmatter,
// version from the consuming package's package.json.
await installSkillBundle({
  sourceDir: "skills/funnel-builder",
  agents: ["claude-code"],
});

// Multi-bundle package: pin the version explicitly.
await installSkillBundle({
  sourceDir: "skills/funnel-builder",
  agents: ["claude-code"],
  version: "2.0.0",
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

**New `kindMismatch` and `manifestMalformed` details on `SkillConflictError`.**
Attempting to install a bundle on top of a generated skill (or vice versa)
at the same name now throws `SkillConflictError` with
`details.kindMismatch: { existing, attempted }`. A directory whose
`crust.json` exists but is unparseable, missing a version, or declares an
unrecognized `kind` surfaces as `details.manifestMalformed: { reason,
rawKind? }`. Pass `force: true` to overwrite, or uninstall the existing
skill first.

`generateSkill()` behaviour is unchanged for existing callers.

Resolves part of #110 (the lower-level primitive half; plugin integration
via `skillPlugin({ customSkills })` is tracked separately).
