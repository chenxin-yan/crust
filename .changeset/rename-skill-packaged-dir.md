---
"@crustjs/skills": minor
---

Rename the skills Extension's `source` option to `packagedDir` to make its purpose explicit. This is a breaking change with no compatibility alias:

```ts
// Before
skill({ source: new URL("../skills", import.meta.url) });

// After
skill({ packagedDir: new URL("../skills", import.meta.url) });
```
