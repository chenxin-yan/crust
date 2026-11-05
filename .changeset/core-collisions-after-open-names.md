---
"@crustjs/core": minor
---

A command name or flag spelling typed as `string` no longer switches off compile-time collision checks among the statically known ones. Before, one runtime-only name in an `.add()` chain, an Extension, or a `.provide()` or `.extend()` call let every later literal collision through to the runtime `DEFINITION` error; now these are compile errors:

- `.add()`/`.command()` after `.add(dynamicCommand)` reusing an earlier sibling's name or alias, including one added in the same batch as the dynamic command
- an Extension command colliding with an app command or an earlier Extension's command after an Extension with a runtime-only command name, in the same `.extend()` call or a later one, and an Extension's literal command colliding beside its own runtime-only one
- an Extension builder `.add()` reusing an earlier literal command after a runtime-only one
- Extension flags or Context-owned flags colliding with earlier ones after an Extension or Context with runtime-only flag spellings in the same `.extend()` or `.provide()` call, and Extension flags colliding with an added command's flags after a command with a dynamic flag record

The runtime-only names themselves are still checked when the app prepares. Flags are the remaining exception: once a command's own flags include a runtime-only spelling, its later flags are checked against the earlier ones only at runtime.
