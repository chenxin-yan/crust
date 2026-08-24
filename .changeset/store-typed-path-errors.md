---
"@crustjs/store": minor
---

Store path resolution now trusts its typed contract: untyped JavaScript callers passing a non-string `dirPath`, `name`, or `appName` get a `TypeError` instead of `CrustStoreError("PATH")`. Typed callers are unaffected.

Raw JSON field defaults are now deep-copied when applied, so nested objects and arrays cannot leak mutations between reads. Standard Schemas may output named interfaces when every property is recursively JSON-compatible.
