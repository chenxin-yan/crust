---
"@crustjs/extensions": minor
---

Add `input()`, an Extension with a recursive `--input` flag that accepts a command's arguments and flags as one JSON object keyed by their names (plus `raw` for passthrough values), the same shape MCP tools take. The value is inline JSON, `@path` to read a file, or `-` to read stdin. Arguments and flags given on argv win over the same keys; every other key replaces the environment value or default, converted as typed `run()` input. Invalid JSON, a non-object, an unreadable file, or an invalid URL fails with a `PARSE` error whose message starts with `--input:`.
