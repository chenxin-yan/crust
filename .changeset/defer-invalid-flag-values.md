---
"@crustjs/core": minor
---

Let `--help` and `--version` win over invalid flag and argument values. A value that fails type conversion, `choices`, or `parse`, from argv or an `env` binding, is now reported after Extension `preRun` hooks, ahead of missing required values, so `PORT=abc cli --help` and `cli --port abc --version` succeed in any argv order. Messages and error codes are unchanged, and the Command Action still never runs with an invalid value. Until the error surfaces, `preRun` and `postRun` hooks see the invalid flag or argument as `undefined`, not its default; Extension-owned defaulted value flags (and `noNegate` booleans with `env`) are now typed `T | undefined` in hook contexts to match. Action types are unchanged. Malformed argv (unknown flags, a missing option value such as `--port --help`) still fails before any hook runs.

Reject blank and whitespace-only numbers: `--port ""` and `PORT=` now fail with `Expected number for --port, got ""` instead of becoming `0`. This also applies to `parseFlagValues` and `@crustjs/env` variables.
