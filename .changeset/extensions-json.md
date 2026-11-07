---
"@crustjs/extensions": minor
---

Add `json()`, an Extension with a recursive `--json` flag for machine-readable output. With `--json`, the Command Action's result is printed to stdout as one line of JSON (nothing for `undefined`), the action's and Contexts' `stdout()` and `stderr()` lines go to stderr, and failures are written to stderr as JSON: a `CrustError`'s `toJSON()`, or `{ "message": … }` for any other error. A result JSON cannot represent exactly (BigInt, cycles, functions, class instances, `-0`) fails the command with exit code 1. Exit codes are otherwise unchanged. `json()` sets the invocation's renderer, so it can't be combined with another Extension that does. Unknown commands and argv syntax errors still use the default rendering, because they fail before `--json` is parsed; under `run()`, failures are read from `outcome.error`.
