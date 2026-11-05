---
"@crustjs/core": minor
---

`.extend()` now only records Extensions. The app applies the final Extension list when it prepares (first run, `app.snapshot()`, `at()`, or `crust build`), so Extensions behave the same whether commands were added before or after `.extend()`. Registering an `ExtensionId` again also rescues an earlier registration of that id that conflicted, on the root and on every command; before, the conflict could still fail the run.

**Behavior changes:** the first one only shows up in programs TypeScript already rejects, such as dynamic or `as never` inputs. The flag order change is visible in the help of any app that adds commands or defines root flags before `.extend()`.

- `.extend()` no longer throws. A collision between an Extension-provided flag and the app's flags, or a missing Context for an Extension's `.use()` or `.provide()`, is now a `DEFINITION` error when the app prepares: a `failed` outcome from `run()`, a rendered error from `execute()`, or a rejection from `app.snapshot()`.
- Flags owned by Extension-provided Contexts are listed first on every command, before the command's own flags. Commands added before `.extend()` and root flags defined before it used to list them after, so their help output changes order.
- A command added before `.extend()` that provides its own Context with the name of an Extension-provided one now also accepts the flags the Extension's Context owns, like a command added after `.extend()`. Its own Context still supplies the value.
