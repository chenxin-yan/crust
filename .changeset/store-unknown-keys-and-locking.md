---
"@crustjs/store": patch
"@crustjs/utils": patch
---

Store mutations no longer lose data to other versions, other store instances, or other processes.

- `write()`, `update()`, `patch()`, and `reset()` on the same file now run one at a time in call order, even across store instances in one process, so overlapping `update()` calls no longer drop each other's changes.
- Each mutation holds an advisory `<name>.json.lock` file, so parallel invocations of your CLI (`cli add & cli add`) keep every update. A lock left by a process that exited is taken over right away, and any lock older than 10 seconds is taken over then. After a crash leaves a lock behind, two processes that start writing at the same instant can both take it, and one of their updates can be lost; the file is never corrupt. A mutation that runs longer than 10 seconds can lose its lock the same way.
- Writes flush the temporary file to disk before renaming it into place, and on Windows retry a rename that another program's open handle briefly blocks.
- On Unix, a write keeps the replaced file's owner and, unless `access` sets file bits, its mode, so a user's `chmod 600` no longer resets to the umask default on the next write.
- `configDir()`, `dataDir()`, `stateDir()`, and `cacheDir()` throw `PATH` instead of returning a relative path when `HOME` (`USERPROFILE` on Windows) is relative or empty, and ignore a relative `APPDATA` or `LOCALAPPDATA` the way they already ignore a relative `XDG_*` value.
- A schema field with an optional property, such as `z.object({ due: z.string().optional() })`, is accepted under `exactOptionalPropertyTypes` instead of failing with `FIX_JSON_OUTPUT`, and that error now describes what JSON data is.
- Error messages and temporary files say "store file" and use the store's name (`.notes-<uuid>.tmp`) instead of "config" for every store.

**Behavior change:** `pruneUnknown` now defaults to `false`. `read()` still returns only the declared fields, but `write()`, `update()`, and `patch()` keep keys the store does not declare in the file, so an older version of your CLI no longer deletes fields a newer version wrote. Pass `pruneUnknown: true` to drop unknown keys on the next mutation, as before. With either setting, `read()` no longer returns undeclared keys.

**Behavior change:** a field `validate` or schema that awaits a mutation of the same store file now never settles, because it waits behind the mutation that called it.
