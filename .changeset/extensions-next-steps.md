---
"@crustjs/extensions": minor
---

Add `nextSteps()`, an Extension that suggests follow-up commands. It provides the `nextSteps` Context: a command declares it with `.use(nextSteps)`, and its action awaits `ctx.nextSteps` and calls `.add(definition, input?, description?)` on it with a command definition and input typed from that definition's arguments and flags. The `onError(error)` option returns recovery steps (`{ command: definition, input?, description? }`) for a failed invocation, matched by the application, e.g. with `instanceof`. After the invocation completes or fails, a plain-text `Next steps:` block is printed to stderr, recovery steps first, each rendered as a shell-quoted command line at the path the application added the definition. Steps whose definition the application does not add, or whose input does not match the command, are skipped with a note on stderr; printing never changes the exit code. Routing and argv syntax failures print no steps.
