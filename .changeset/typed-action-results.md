---
"@crustjs/core": minor
"@crustjs/testing": minor
---

Infer action return values from typed `run()` calls.

**BREAKING**: `run()` no longer resolves to `void`; it resolves to a `RunOutcome` discriminated union — `completed` owns the selected action's typed `result`, while `finished` owns the identity of the Extension whose `preRun` hook ended the invocation. `captureRun()` exposes the same distinction as a status-discriminated `CapturedRun`: `completed` owns `result`, `finished` owns the finishing Extension's `by` identity, and `failed` owns the thrown `error` (it previously reported output and errors through optional fields).

```ts
const outcome = await app.run(["inspect"], { args: { file: "a.txt" } });
if (outcome.status === "completed") console.log(outcome.result);
```
