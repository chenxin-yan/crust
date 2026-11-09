---
"@crustjs/extensions": minor
---

`json()` streams NDJSON for async generator actions: with `--json`, each yielded event prints to stdout as a `{"type":"event","data":…}` line as it is yielded, and the stream ends with exactly one `{"type":"result","data":…}` line or, when the command fails after the action started, one `{"type":"error","error":…}` line on stdout instead of the stderr error JSON. A cancelled invocation (exit code 130), or a failure another Extension's `onError` hook claims, ends the stream without that final line, so consumers should check the exit status. Ordinary actions keep the bare result line. The "JSON output" section `json()` adds to the root command's documentation describes this stream too.
