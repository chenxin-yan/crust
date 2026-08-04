---
"@crustjs/extensions": minor
---

`versionExtension(value, options?)` accepts a new `format` option controlling output: `"plain"` prints the bare version, or a `(version, context) => string` function customizes the line. Default output is unchanged (`<name> v<version>`).
