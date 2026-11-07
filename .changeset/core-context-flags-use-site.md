---
"@crustjs/core": minor
---

A Context's owned flags now appear only on commands whose `ctx` exposes the Context, where they have an effect:

- the command that `.provide()`s it, and inline `.command()` children added after it, as before
- a reusable command that declares it with `.use()`, together with the flags of the Contexts its setup uses, transitively
- for an Extension-provided Context: the root, its inline children, and the commands that `.use()` it; every command when the Extension's hooks `.use()` it

Parsing, help, completions, manual pages, snapshots, and typed `run()` agree: elsewhere the flag is unknown. `.use()` also adds the flags to the command's `flags` type. Pulling a flag-owning Context on a command that does not parse its flags (only possible through an untyped access) fails with a `DEFINITION` error, reason `context-flags-not-parsed`.

**Breaking:** a reusable command (`defineCommand()` + `.add()`, or an Extension command) no longer accepts the flags of Contexts provided on its parent path unless it declares the Context with `.use()`, and an Extension-provided Context's flags no longer reach every command. To migrate, add `.use(context)` to each reusable command that should accept the flag, or `.use(context)` to the Extension when its hooks read the Context.
