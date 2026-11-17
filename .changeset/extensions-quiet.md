---
"@crustjs/extensions": minor
---

Add `quiet(options?)`, which provides a boolean `quiet` Context read from `--quiet` / `-q`, `--no-quiet`, then an optional environment variable (`quiet({ env: "MY_CLI_QUIET" })`), then `false`. Commands that `.use(quiet)` await `ctx.quiet` and skip their own optional output; other Extensions don't read it.
