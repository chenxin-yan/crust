---
"@crustjs/extensions": minor
---

Add `nextSteps()`, an Extension that suggests follow-up commands. It provides `nextStepsContext`, a `next` Context: actions call `(await ctx.next).add(command, input?, description?)`, and the `onError(error)` option returns recovery steps for a failed invocation, matched by the application, e.g. with `instanceof`. After the invocation completes or fails, a plain-text `Next steps:` block is printed to stderr, recovery steps first, each rendered as a shell-quoted command line from the command's arguments and flags. Steps that do not match the command tree are skipped with a note on stderr; printing never changes the exit code. Routing and argv syntax failures print no steps.
