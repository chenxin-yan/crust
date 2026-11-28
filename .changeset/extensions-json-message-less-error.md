---
"@crustjs/extensions": patch
---

`json()` writes an error with an empty message as its `name`, as the `Error:` line without `--json` already does. An Effect `Data.TaggedError` without a `message` field printed `Error: NotFound` as text but `{"message":""}` under `--json`; it now prints `{"message":"NotFound"}`.
