---
"@crustjs/skills": minor
---

`skillPlugin` now accepts a `customSkills` array for managing hand-authored
skill bundles alongside the auto-generated command-reference skill.

Each entry is reconciled through the same plugin lifecycle as the main
skill — auto-update on version change, surfaced in the interactive `skill`
subcommand multiselect (one prompt per bundle, in array order, after the
main-skill prompt), supports uninstall via the same toggle UX, and respects
`autoUpdate: false` and `--all` non-interactive mode.

```ts
import { Crust } from "@crustjs/core";
import { skillPlugin } from "@crustjs/skills";
import pkg from "./package.json" with { type: "json" };

new Crust("my-cli")
  .meta({ description: "My CLI" })
  .use(
    skillPlugin({
      version: pkg.version,
      customSkills: [
        {
          name: "funnel-builder",
          sourceDir: "skills/funnel-builder",
          version: pkg.version,
        },
      ],
    }),
  )
  .run(() => {});
```

`CustomSkillConfig.sourceDir` accepts a `URL` (`file:` protocol), an
absolute path, or a bare relative string resolved from the nearest
`package.json` walking up from `process.argv[1]` — the same three modes
used by `installSkillBundle()` (TP-003). Each entry's `version` drives
auto-update detection (compared against the recorded `crust.json`
version) and is typically wired to the consuming package's
`package.json` `version`. Per-entry `scope` and `installMode` overrides
are optional; unset values inherit from the plugin's `defaultScope` /
`installMode`.

Setup-time validation enforces:
- Each `name` satisfies `isValidSkillName`.
- No `name` collides with the main skill's name.
- All `name` values are unique within the array.
- Each `version` is a non-empty string.
- Each `sourceDir` is a `string` or `URL`.

Per-entry failures during auto-update or interactive reconciliation are
logged with the bundle name and never abort other entries. Plugin
behavior is byte-identical to today when `customSkills` is omitted or
empty.

Builds on `installSkillBundle()` (introduced in #119); resolves the
plugin-integration half of #110.
