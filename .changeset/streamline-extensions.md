---
"@crustjs/extensions": minor
---

Simplify update notifier commands to one `updateCommand` option: pass a string, a callback receiving `{ packageName, packageManager }`, or `{ scope: "global" | "local" }` for an automatically generated command. The separate `packageManager` and `installScope` options and `UpdateNotifierInstallScope` export are removed.

Completion and typo suggestions now consume Core's shared flag-negation and command-listing policies.
