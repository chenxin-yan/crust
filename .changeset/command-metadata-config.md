---
"@crustjs/core": minor
"@crustjs/crust": patch
"create-crust": patch
"@crustjs/extensions": patch
"@crustjs/skills": patch
---

Move static command metadata into builder signatures: root commands now accept `new Crust(name, { description, usage })`, while reusable commands accept `defineCommand(name, { description, usage, aliases, hidden, requires }, recipe)`.

Remove `.meta()` from `Crust` and `CommandDefinitionBuilder` without a compatibility shim. This keeps names and static metadata together, prevents repeated metadata overrides, and makes aliases available before a definition recipe materializes.
