---
"@crustjs/core": patch
---

Default invocation IO writes through `process.stdout`/`process.stderr` instead of `console.log`/`console.error`. Under Bun, once anything materializes `process.stdout` (a platform layer, a color library probing `isTTY`), the native console writer silently drops piped output past 64 KiB at exit ([oven-sh/bun#36419](https://github.com/oven-sh/bun/issues/36419)); the stream writer flushes it. Rendered text is unchanged.
