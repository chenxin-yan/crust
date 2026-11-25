---
"@crustjs/store": minor
---

New `withFileLock(path, fn, { operation, directoryMode?, signal? })` export (and its `FileLockOptions` type): runs `fn` under the lock on `<path>.lock` that a store which is not `strict` holds around each mutation, for code that reads, changes and replaces a file of its own that other processes save too. A waiter now also takes over a link left at the lock path once it is 10 seconds old, rather than following it and waiting forever.
