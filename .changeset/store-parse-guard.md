---
"@crustjs/store": patch
---

Throw a `PARSE` `CrustStoreError` when the persisted config file contains a non-object JSON root (string, number, array, or `null`). Previously a scalar root crashed with a raw `TypeError` and an array root silently reset the store to defaults.
