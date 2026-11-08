---
"@crustjs/core": minor
---

A Context's owned flags now appear only on commands whose `ctx` exposes the Context, where they have an effect:

- the command that `.provide()`s it, and inline `.command()` children added after it, as before
- a reusable command that declares it with `.use()`, together with the flags of the Contexts its setup uses, transitively
- for an Extension-provided Context: the root, its inline children, and the commands that `.use()` it or the Extension (`.use(confirm)` gives `--yes` only to that command); every command when the Extension's hooks `.use()` it

A command that `.use()`s a Context may also `.provide()` it; the two share its flags. A command that `.use()`s a Context parses the declared Contexts' flags, as declared: a different same-name Context that fulfills the `.use()` must own exactly the same flags with equal definitions, and the Contexts its setup uses must own only flags the command parses, or preparing the app fails with a `DEFINITION` error, reason `context-flags-not-parsed`. To replace only the value, provide the same factory, such as its `.of()` double.

Parsing, help, completions, manual pages, snapshots, and typed `run()` agree: elsewhere the flag is unknown. `.use()` also adds the flags to the command's `flags` type. Pulling a flag-owning Context on a command that does not parse its flags (only possible through an untyped access) fails with a `DEFINITION` error, reason `context-flags-not-parsed`.

**Breaking:** a reusable command (`defineCommand()` + `.add()`, or an Extension command) no longer accepts the flags of Contexts provided on its parent path unless it declares the Context with `.use()`, and an Extension-provided Context's flags no longer reach every command. A same-name provider with other flags than a Context a command `.use()`s, such as another default, is now a `DEFINITION` error. To migrate, add `.use(context)` (or `.use(extension)` for an Extension's Contexts) to each reusable command that should accept the flag, or `.use(context)` to the Extension when its hooks read the Context; give a replacing same-name Context the declared flags, or provide the declared factory.
