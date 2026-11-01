---
"@crustjs/utils": minor
"@crustjs/extensions": patch
"@crustjs/create": patch
---

Add `@crustjs/utils/package-manager` for `packageManagerFromUserAgent` and `PackageManager`. `@crustjs/utils/process` still re-exports them; importing the new subpath avoids loading `child_process`, so `updateNotifier()` no longer pays for it at startup.
