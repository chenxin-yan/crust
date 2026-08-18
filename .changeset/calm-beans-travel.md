---
"@crustjs/extensions": minor
"@crustjs/skills": minor
---

Remove per-module subpath exports (`@crustjs/extensions/{completion,did-you-mean,help,no-color,update-notifier,version}`, `@crustjs/skills/{agents,bundle,extension,generate}`). Import from the package root instead:

```ts
// Before
import { help } from "@crustjs/extensions/help";
// After
import { help } from "@crustjs/extensions";
```

Internal helpers that were only reachable via subpaths are no longer exported and have no root-export replacement: `isNewerVersion`, `fetchLatestVersion`, and the `UpdateNotifierState` type from `@crustjs/extensions/update-notifier`; `resolveEffectiveScope`, `ALL_AGENTS`, `AGENT_LABELS`, and `resolveAgentPath` from `@crustjs/skills/agents`; `groupAgentsByOutputDir` from `@crustjs/skills/generate`; and `probeFrontmatter`, `loadBundleFiles`, and the `LoadedBundle` type from `@crustjs/skills/bundle`.
