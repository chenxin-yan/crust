---
"@crustjs/extensions": minor
---

Smaller additions to the official Extensions.

- `version(value, { short })` picks the short spelling of `--version`: `"v"` (the default), `"V"` for an application that uses `-v` for something else, or `false` for none.
- `search({ command })` and `schema({ command })` rename their command, for an application that has its own `search` or `schema`. A literal name keeps the command tree typed.
- `renderCommandIndex(root)` returns the Markdown `--llms` prints for a Command Snapshot, without running the app.
- `didYouMean()` suggests a name only within two edits (cobra's cutoff; three edits made `zzz` suggest `add`) and never for an empty word. It also suggests a flag for an unknown long flag, such as `Unknown flag "--tempalte". Did you mean "--template"?`, by adding the suggestion to the error's message.
- `updateNotifier({ latestVersion })` looks up the latest version with the application's own function instead of the npm registry, for a registry the user configured or a source that is not npm. It gets a signal that aborts after `timeoutMs` or on cancellation. `registryUrl` and `latestVersion` cannot be given together.
- `nextSteps` takes plain text steps, printed as written: `next.add("pnpm install", "Install dependencies")`, or `{ command: "cd my-app" }` from `onError`.
