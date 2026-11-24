---
"@crustjs/store": minor
---

New `withFileLock(path, fn, { operation, directoryMode?, signal? })` export (and its `FileLockOptions` type): runs `fn` under the lock on `<path>.lock` that a store which is not `strict` holds around each mutation, for code that reads, changes and replaces a file of its own that other processes save too.
