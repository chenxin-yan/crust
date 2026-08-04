---
"@crustjs/core": minor
"@crustjs/extensions": minor
"@crustjs/skills": minor
---

`ExtensionConfig.commands` now accepts only `defineCommand()` definitions. Migrate extension-owned `new Crust("name")` builders to `defineCommand("name", (command) => ...)`; `ExtensionCommand` is removed. Definition Context requirements are checked when the application prepares and report `DEFINITION` errors.
