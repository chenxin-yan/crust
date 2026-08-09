---
"@crustjs/store": patch
---

Throw a `PARSE` `CrustStoreError` when the persisted config file contains a non-object JSON root (string, number, array, or `null`). Previously a string or number root crashed with a raw `TypeError`, while an array or `null` root silently reset the store to defaults.
