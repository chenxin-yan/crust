---
"@crustjs/core": patch
---

`ctx.rootCommand` and `ctx.command` now project each child when it is first read. Reading root metadata, such as `updateNotifier()` resolving `rootCommand.meta.version`, no longer builds every command, while walking `subCommands` still sees all of them. Snapshots are reused across invocations when the entire command tree is already built and has no mutable defaults at the invocation's first snapshot read. Otherwise snapshots stay invocation-local, preserving their identity even if another invocation makes the tree reusable.
