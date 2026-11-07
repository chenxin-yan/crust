---
"@crustjs/extensions": minor
---

`json()` streams NDJSON for async generator actions: with `--json`, each yielded event prints to stdout as a `{"type":"event","data":…}` line as it is yielded, and the stream ends with exactly one `{"type":"result","data":…}` line or, when the command fails after the action started, one `{"type":"error","error":…}` line on stdout instead of the stderr error JSON. Ordinary actions keep the bare result line.
