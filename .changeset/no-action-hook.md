---
"@crustjs/core": minor
"@crustjs/extensions": patch
---

Fix `--version` printing help on a root without a Command Action when `help()` was registered before `version()`. Extensions gain a `noAction` hook (`defineExtension(id).noAction(hook)`). It runs only when the routed command has no Command Action, after every `preRun` hook has declined, in `.extend()` order, and before validation. Like `preRun`, it can return `ctx.handled()`. `help()` now shows help for action-less commands from `noAction`, so other Extensions' flags work on command groups whatever the registration order, while `--help` is still handled in `preRun`.

**Behavior change:** on a command without an action, Extension `preRun` hooks registered after `help()` now run before help is shown, and the first one that returns `ctx.handled()` wins.
