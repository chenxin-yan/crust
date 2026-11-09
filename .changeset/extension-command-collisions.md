---
"@crustjs/core": minor
---

An Extension command whose name or alias collides with an app command or another Extension's command is now a `DEFINITION` error (`reason: "command-collision"`) when the app prepares, matching `.add()` and the existing compile-time check. Before, one command silently replaced or shadowed the other. Breaking only for collisions TypeScript can't see, such as a name passed to `skills({ command })` as a `string`. Registering the same `ExtensionId` again still replaces its earlier commands.
