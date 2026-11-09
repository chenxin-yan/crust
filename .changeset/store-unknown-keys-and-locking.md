---
"@crustjs/store": patch
"@crustjs/utils": patch
---

Store mutations no longer lose data to other versions, other store instances, or other processes.

- `write()`, `update()`, `patch()`, and `reset()` on the same file now run one at a time in call order, even across store instances in one process, so overlapping `update()` calls no longer drop each other's changes.
- Each mutation holds an advisory `<name>.json.lock` file, so parallel invocations of your CLI (`cli add & cli add`) keep every update. The holder keeps the lock for as long as the mutation runs; a lock left by a process that exited, or not refreshed for 10 seconds, is taken over by exactly one waiter.
- A schema field with an optional property, such as `z.object({ due: z.string().optional() })`, is accepted under `exactOptionalPropertyTypes` instead of failing with `FIX_JSON_OUTPUT`, and that error now describes what JSON data is.
- Error messages and temporary files say "store file" and use the store's name (`.notes-<uuid>.tmp`) instead of "config" for every store.

**Behavior change:** `pruneUnknown` now defaults to `false`. `read()` still returns only the declared fields, but `write()`, `update()`, and `patch()` keep keys the store does not declare in the file, so an older version of your CLI no longer deletes fields a newer version wrote. Pass `pruneUnknown: true` to drop unknown keys on the next mutation, as before. With either setting, `read()` no longer returns undeclared keys.
