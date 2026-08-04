---
"@crustjs/extensions": minor
---

`versionExtension(value, options?)` accepts new options: `short` remaps or disables the short alias (`{ short: "V" }`, `{ short: false }`), and `format` controls output (`"plain"` for the bare version, or a `(version, context) => string` function). Defaults are unchanged (`-v`, `<name> v<version>`).
