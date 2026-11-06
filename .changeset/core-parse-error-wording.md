---
"@crustjs/core": patch
---

Flag value errors now use Crust's own wording instead of Node's `util.parseArgs` messages, and read the same on Node and Bun. A value-taking flag with no value reports `Missing value for flag "--count"`, adding `; to pass a value starting with "-", write --count=<value>` when the next token looks like a flag. A boolean flag given a value, such as `--force=yes` or `--no-force=yes`, reports `Flag "--force" does not take a value`. These `PARSE` errors carry `details.flag` (the canonical flag name) and `details.reason` (`"missing-value"` or `"unexpected-value"`).
