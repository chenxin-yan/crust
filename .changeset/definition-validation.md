---
"@crustjs/core": minor
---

Enforce definition-shape validation once, at compile time where possible.

- Compile-time `FIX_*` brands own statically checkable mistakes: variadic placement, flag defaults outside literal `choices` (`FIX_DEFAULT_CHOICE`), spelling/name/alias collisions, empty flag spellings and command/argument names, reserved `__proto__` spellings, `no-` prefixes, schema exclusivity, parser synchronicity, section audience exclusivity, and dependency closure — consistently across `.flags()`, `.args()`, `.add()`, `.provide()`, `.extend()`, `defineContext`, and `defineExtension`.
- `defineExtension()` flags are authored as a readonly array of named definitions, matching `.flags()` and `defineContext()`; statically known Extension collisions are rejected at compile time — command collisions within one Extension tuple, with authored commands, or with other Extensions (`FIX_COMMAND_COLLISION`), and flag collisions against application flags and earlier Extensions (`FIX_ALIAS_COLLISION`).
- Dynamically assembled definitions (config-built flags, args, commands, Extensions) fail loud with `DEFINITION` errors at the same composition points instead of silently misbehaving. Runtime otherwise validates only what types cannot see: argv values, dynamic strings, recipe behavior, and transitive dependencies above an `.of()` cut.
- Routing hardening: argv tokens matching inherited `Object.prototype` keys (`mycli constructor`, `mycli __proto__`) report `COMMAND_NOT_FOUND` instead of crashing, and typed `run()` positional/flag lookups no longer resolve inherited keys.
