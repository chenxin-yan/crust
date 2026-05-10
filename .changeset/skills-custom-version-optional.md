---
"@crustjs/skills": minor
---

`CustomSkillConfig.version` is now optional in `skillPlugin`'s
`customSkills`. When omitted, the entry inherits the plugin's top-level
`version` — the typical case when the bundle ships in the same package as
the consuming CLI. Pass an explicit value to opt into independent
versioning (e.g. a bundle vendored from another package at a different
release cadence).

```ts
skillPlugin({
  version: pkg.version,
  customSkills: [
    // Inherits `version: pkg.version` from the plugin.
    { name: "funnel-builder", sourceDir: "skills/funnel-builder" },
    // Explicit override for an independently-versioned bundle.
    {
      name: "vendored-toolkit",
      sourceDir: "skills/vendored-toolkit",
      version: "0.3.0",
    },
  ],
});
```

This aligns `version` with how `scope` and `installMode` already inherit
from the plugin. The existing required-`version` shape keeps working —
all current configs are unchanged.

Setup-time validation now rejects an explicit empty-string `version` so a
typo can't silently fall through to the plugin-level fallback. Omitting
the field entirely is the supported way to inherit.
