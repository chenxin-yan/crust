---
"@crustjs/core": minor
---

Rename `.handle()` to `.action()` and the Command Handler terminology to Command Action, including `CommandSnapshot.hasHandler` to `hasAction` and the duplicate-definition reason from `duplicate-handler` to `duplicate-action`.

The noun-style method matches the rest of the builder and follows Commander and cac precedent. This prerelease API is replaced directly without a compatibility shim.
