---
"@crustjs/core": minor
---

Extension hooks can parse argv for another command and add to bound input. `await ctx.parseCommandArgv(["my-cli", "db", "migrate"], ["--to", "3"])` resolves to the command's canonical `path` and the `args`, `flags`, and `rawArgs` its action would receive (argv, environment fallbacks, defaults, required checks, and Standard Schemas), without running any hook, Context setup, or action, and building only the commands on the path; a new `ParsedCommandArgv` type is exported. `ctx.boundInput` is the payload last passed to `ctx.bindInput()`, so a hook can bind it merged with its own values instead of dropping what another Extension bound.
