---
"@crustjs/extensions": minor
---

Introduce `@crustjs/extensions`, the official Extension collection succeeding `@crustjs/plugins`. All Extensions are imported from the package root:

- `help()` renders command help, including long flag aliases (`-o, --output, --out`); negation is shown for the canonical name only.
- `version(value, options?)` prints the application version. The `format` option controls output: `"plain"` prints the bare version, or a `(version, context) => string` function customizes the line; default output is `<name> v<version>`.
- `completion()` generates completion scripts; output directories always include every supported shell.
- `didYouMean()` suggests near-miss commands.
- `noColor()` adds `--color`/`--no-color`, scoping the standard `FORCE_COLOR`/`NO_COLOR` environment variables around command execution — `--color` sets `FORCE_COLOR=3` (clearing `NO_COLOR`), `--no-color` sets `NO_COLOR=1` (clearing `FORCE_COLOR`), and prior values are restored after the run — so child processes and other color-aware libraries comply too.
- `updateNotifier()` checks for newer releases using Bun's SemVer precedence, including notifying prerelease users when a matching stable release lands. Persistence is on by default through a lazily loaded `@crustjs/store` cache at `stateDir(packageName)`; set `cache: false` to opt out, `cache: { intervalMs }` to tune it, or provide a custom adapter. A corrupt cache file is treated as empty and repaired after the next successful check.
- Update notices are command-less by default. Configure the single `updateCommand` option with a string, a callback receiving `{ packageName, packageManager }`, or `{ scope: "global" | "local" }` for an automatically generated package-manager command; notices can instead link to update documentation. The separate `packageManager` and `installScope` options and `UpdateNotifierInstallScope` export are removed.
- Completion and typo suggestions consume Core's shared flag-negation and command-listing policies.

`@crustjs/extensions` has a runtime dependency on `@crustjs/store`.
