---
"@crustjs/core": minor
---

A generic command factory such as `function deployTo<const N extends "staging" | "production">(name: N) { return defineCommand(name, …) }` now compiles, also with literal `aliases`, and `run()` keeps its typed results. Before, `defineCommand()` and `.as()` rejected a generic name with `TS2345`.

**Type change:** a literal command name that can't route, such as `"-x"`, `"my cmd"`, `""` or `"__proto__"`, is now a compile error where the definition is passed to `.add()` (on an app, in a recipe, or on an Extension, including when spread from an array), not at `defineCommand()` or `.as()`. So is an alias equal to its command's own name. The command-name error text is unchanged; the self-alias error now reads `Command "issue" must not list its own canonical name as an alias`. A definition that is never added no longer fails typecheck, but `defineCommand()` and `.as()` still throw a `DEFINITION` error at runtime. `.command()` names and the shape of `defineCommand()` config aliases (blank, whitespace, a leading `-`) are still checked at the call.
