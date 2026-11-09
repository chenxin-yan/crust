---
"@crustjs/core": minor
"@crustjs/extensions": minor
---

Listing commands no longer builds them. In `ctx.rootCommand`, `ctx.command`, and `COMMAND_NOT_FOUND` details, a child that has not been built exposes its `defineCommand()` metadata (`name`, `description`, `aliases`, `hidden`, `usage`) without running its recipe. Reading its `meta.sections`, `hasAction`, `args`, `flags`, or `subCommands` builds it. `help()` lists subcommands from that metadata, and an unknown command no longer builds the parent's whole subtree. Root `--help` on a 200-command CLI now runs no command recipes.

**Behavior change:** a command whose recipe throws no longer breaks root help or unknown-command reporting. `cli --help` still lists it, and `cli typo` reports `Unknown command "typo"`, with a `didYouMean()` suggestion, instead of the unrelated recipe error. The broken command still fails when it is run or when `app.snapshot()`, `crust build`, or its own help reads it. On a child that has not been built, `meta.sections` is an accessor, so the key is present even when its value is `undefined`. `app.snapshot()` is unchanged: it builds and validates the full tree.
