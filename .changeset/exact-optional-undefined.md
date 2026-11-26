---
"@crustjs/auth": patch
"@crustjs/completion": patch
"@crustjs/config": patch
"@crustjs/core": patch
"@crustjs/create": patch
"@crustjs/crust": patch
"@crustjs/env": patch
"@crustjs/extensions": patch
"@crustjs/man": patch
"@crustjs/mcp": patch
"@crustjs/openapi": patch
"@crustjs/progress": patch
"@crustjs/prompts": patch
"@crustjs/skills": patch
"@crustjs/store": patch
"@crustjs/style": patch
"@crustjs/tui": patch
"@crustjs/utils": patch
---

Optional options and definition keys accept an explicit `undefined` under `exactOptionalPropertyTypes`, so a value that may be absent, such as an optional flag's, can be passed on as it is: `{ env: flags.env }` instead of `...(flags.env ? { env: flags.env } : {})`. This covers the options of exported functions, constructors and builder methods, argument, flag and command definitions with the keys packages add to them, and configuration types. Without the option nothing changes. `updateNotifier()` also accepts a `latestVersion` that may be `undefined` when no `registryUrl` is given.
