---
"@crustjs/store": minor
---

Stores can now hold credentials: a `strict` mode whose lock is never taken from a running process, and writes and resets that survive a power loss.

- New `strict: true` option on `createStore()`, for a file that must not lose an update and must stay private. Its lock is never taken over from a process that may still run, however long it holds it; a waiter takes over only an owner that is provably gone (on Linux, same machine, boot and PID namespace with the process gone or its pid reused; on macOS and Windows, same platform and hostname with the process gone), serialized through `<name>.json.lock.recover`. Otherwise the mutation rejects with the new `LOCK` error after `lockTimeout` (new option, 40 seconds by default), whose details name the file, its owner, and the manual step. A strict store refuses a store file that is a symbolic link on every platform, and on Unix an existing directory that is a link, belongs to another user, or is writable by group or other users (for `read()` as well as mutations), with `PATH` and `details.reason` `"symlink"` or `"directory"`. `strict` implies `access: "private"`; combining it with another `access` throws `DEFINITION`. Every process that opens the file must set `strict`.
- New `withLock(path, fn, { signal, timeout })` export: the same strict lock for work on a path that has no store document.
- `write()`, `update()`, `patch()`, and `reset()` take an optional `{ signal }` (new `StoreMutationOptions` type). Aborting while the mutation still waits, behind earlier mutations of the same file or for its lock, rejects with `signal.reason` and changes nothing. Without a signal, the default lock behaves as before.
- New `LOCK` error code, and an optional `reason` on `PATH` error details.
- On Unix, every store now flushes the directory after renaming a write into place and after `reset()` deletes the file, and the parent of each directory it creates, so a write or reset that resolved survives a power loss, except while another process is creating the same new directories: only the creator of a directory flushes its entry. A failed flush rejects with `IO`. Windows has no directory flush.
- The temporary file of a write is created exclusively.
