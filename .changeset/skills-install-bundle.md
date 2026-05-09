---
"@crustjs/skills": minor
---

**Add `installSkillBundle()` for hand-authored skill bundles.**

New `installSkillBundle(options)` entrypoint installs a directory containing
`SKILL.md` and supporting files through the same canonical-store + agent
fan-out pipeline used by `generateSkill()`. The bundle's `SKILL.md`
frontmatter is the source of truth for `name` and `description` — both are
required, and Crust reads them without rewriting the file. `version` is a
required option (typically wired to the consuming package's `package.json`
`version`) recorded in `crust.json` for update detection. Files are copied
as UTF-8 text (binary supporting files are not supported). Bundle contents
are copied as authored — there is no implicit name-based filtering of
`node_modules/`, dotfiles, etc.; bundle authors are responsible for
pointing `sourceDir` at a clean directory. `crust.json` at the bundle
root is reserved: if found in the source, the call throws so the conflict
surfaces immediately. Crust then writes a fresh `crust.json` for
ownership tracking. Symlinks that escape the bundle root are rejected.

```ts
import { installSkillBundle } from "@crustjs/skills";
import pkg from "./package.json" with { type: "json" };

await installSkillBundle({
  sourceDir: "skills/funnel-builder",
  agents: ["claude-code"],
  version: pkg.version,
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
