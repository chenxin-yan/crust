---
"@crustjs/extensions": patch
---

`noColor`: overlapping programmatic runs with opposing `--color`/`--no-color` flags now fail fast in `preRun` instead of last-writer-wins on `process.env`.
