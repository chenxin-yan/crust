---
"@crustjs/core": minor
---

`CommandSnapshot.output` is `true` when the command declared `.output()`, even when its schema can't produce the JSON Schema `outputSchema` carries. Tooling uses it to tell commands that return data from the rest: `json()` prints only the JSON result of such a command under `--json`, dropping the text it prints with `stdout()`.
