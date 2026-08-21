---
"@crustjs/extensions": minor
---

Introduce `@crustjs/extensions`, the official Extension collection succeeding `@crustjs/plugins`. All Extensions are imported from the package root:

- `help()` renders command help, including long flag aliases (`-o, --output, --out`); negation is shown for the canonical name only.
- `version(value, options?)` prints the application version. The `format` option controls output: `"plain"` prints the bare version, or a `(version, context) => string` function customizes the line; default output is `<name> v<version>`.
- `completion()` generates completion scripts; output directories always include every supported shell.
- `didYouMean()` suggests near-miss commands.
- `noColor()` adds `--color`/`--no-color`, scoping the standard `FORCE_COLOR`/`NO_COLOR` environment variables around command execution — `--color` sets `FORCE_COLOR=3` (clearing `NO_COLOR`), `--no-color` sets `NO_COLOR=1` (clearing `FORCE_COLOR`), restoring prior values after the run — so child processes and other color-aware libraries comply too.
- `updateNotifier()` checks for newer releases using Bun's SemVer precedence (including notifying prerelease users when a matching stable lands). Persistence is on by default via a lazily loaded `@crustjs/store` cache at `stateDir(packageName)`; set `cache: false` to opt out, `cache: { intervalMs }` to tune, or provide a custom adapter — a corrupt cache file is treated as empty and repaired on the next successful check. Update notices are command-less by default: an explicit install scope generates a package-manager command, and notices can link to update documentation instead.

`@crustjs/extensions` has a runtime dependency on `@crustjs/store`.
