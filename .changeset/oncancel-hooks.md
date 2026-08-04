---
"@crustjs/core": minor
---

`execute()` now offers `AbortError` cancellation to Extension `onError` hooks before finishing, so applications can render a cancellation message (e.g. "Operation cancelled") centrally. Exit code stays `130` and cancellation remains silent when no hook claims it — default behavior is unchanged.
