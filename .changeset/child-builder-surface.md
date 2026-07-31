---
"@crustjs/core": minor
"@crustjs/crust": patch
---

Make `.command(builder)` accept only child builders created with `.sub()`, and remove standalone `new Crust(name)` mounting entirely.

- New exported `ChildCrust` type: the builder surface returned by `.sub()` and passed to `.command(name, callback)` callbacks. It is a `Crust` without root-only members, so `.extend()` no longer appears in child autocomplete.
- `.command(builder)` and inline callback returns are typed to `ChildCrust`, so a standalone `new Crust(name)` is rejected at compile time instead of being silently type-isolated.
- The runtime child guard in `.extend()`, the extension-carrying attachment rejection, and attachment-time Context merging are removed — the type system is the enforcement boundary; there is no code path for mounting standalone builders anymore.
- Behavior change: a parent `.provide()` called after `.sub()` is no longer backfilled into the child at attach time. Finalize parent flags and Contexts before creating split-file children, matching the documented import-order rule.

Migration: replace `parent.command(new Crust("child")...)` with `parent.command(parent.sub("child")...)` (or an inline `.command("child", (cmd) => ...)`). Extension-contributed commands (`extension(name, { commands: [...] })`) are unaffected.
