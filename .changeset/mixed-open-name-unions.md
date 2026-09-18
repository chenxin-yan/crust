---
"@crustjs/core": patch
---

Reject statically known invalid members of a name union even when another member is an open template, such as `` "" | `mode-${string}` `` or `` "__proto__" | `mode-${string}` ``. Applies to command names, command aliases, `.as()` renames, argument names, and flag names, short flags, and aliases. Open members remain runtime-checked and still keep attachment records open.
