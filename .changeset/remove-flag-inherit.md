---
"@crustjs/core": minor
"@crustjs/extensions": minor
---

**BREAKING:** Remove `FlagDef.inherit`. Command flags declared with `.flags()` are now always local; Context-owned flags are the only application-level flag propagation mechanism. Recursive Extension flags continue to use `ExtensionFlagDef.recursive`.

The public `FlagSnapshot.inherit` field and the `InheritableFlags` and `ForceInherit` utility types are also removed. A local child flag can no longer override a same-named inherited flag because ordinary flags no longer inherit; Context-owned name collisions remain `DEFINITION` errors.

| Previous usage | Migration |
| --- | --- |
| `inherit: true` feeds behavior shared by a subtree | Move the flag into `defineContext(name, { flags: [...] }, setup)` and attach the instance with `.provide()` before mounting descendants. Handlers should require the derived Context capability. |
| Each command reads the raw flag directly | Define the descriptor once with `defineFlag()` and attach it with `.flags()` to each command that parses it. |

Cross-command dependencies are capability-only: list Context factories in `requires` and consume their derived values through `ctx`. Raw flag requirements are removed.
