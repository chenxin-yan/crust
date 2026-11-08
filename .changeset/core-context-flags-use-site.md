---
"@crustjs/core": minor
---

A Context's owned flags now appear only on commands whose `ctx` exposes the Context, where they have an effect:

- the command that `.provide()`s it, and inline `.command()` children added after it, as before
- a reusable command that declares it with `.use()`, together with the flags of the Contexts its setup uses, transitively
- for an Extension-provided Context: the root, its inline children, and the commands that `.use()` it or the Extension (`.use(confirm)` gives `--yes` only to that command); every command when the Extension's hooks `.use()` it

A command that `.use()`s a Context may also `.provide()` it; the two share its flags. A command that `.use()`s a Context parses only the declared Contexts' flags: a different same-name Context that fulfills the `.use()` (or one its setup uses) must not own other flags, or preparing the app fails with a `DEFINITION` error, reason `context-flags-not-parsed`. For a flag both define, the provider may change its spelling, help, default value, or narrow its `choices`, but a definition that changes the values or presence the declared one promises is a `DEFINITION` error.

Parsing, help, completions, manual pages, snapshots, and typed `run()` agree: elsewhere the flag is unknown. `.use()` also adds the flags to the command's `flags` type. Pulling a flag-owning Context on a command that does not parse its flags (only possible through an untyped access) fails with a `DEFINITION` error, reason `context-flags-not-parsed`.

**Breaking:** a reusable command (`defineCommand()` + `.add()`, or an Extension command) no longer accepts the flags of Contexts provided on its parent path unless it declares the Context with `.use()`, and an Extension-provided Context's flags no longer reach every command. To migrate, add `.use(context)` (or `.use(extension)` for an Extension's Contexts) to each reusable command that should accept the flag, or `.use(context)` to the Extension when its hooks read the Context.
