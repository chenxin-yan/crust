---
"@crustjs/store": minor
---

Store path resolution now trusts its typed contract: untyped JavaScript callers passing a non-string `dirPath`, `name`, or `appName` get a `TypeError` instead of `CrustStoreError("PATH")`. Typed callers are unaffected.
