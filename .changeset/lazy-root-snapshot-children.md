---
"@crustjs/core": patch
---

`ctx.rootCommand` and `ctx.command` now project each child when it is first read. Reading root metadata, such as `updateNotifier()` resolving `rootCommand.meta.version`, no longer builds every command, while walking `subCommands` still sees all of them. A snapshot is reused across invocations once every command in its subtree is built and no default in it is mutable.
