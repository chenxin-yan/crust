---
"@crustjs/utils": minor
"@crustjs/extensions": patch
"@crustjs/create": patch
---

`packageManagerFromUserAgent` and `PackageManager` moved from `@crustjs/utils/process` to the new `@crustjs/utils/package-manager`, which does not load `child_process`, so `updateNotifier()` no longer pays for it at startup.
