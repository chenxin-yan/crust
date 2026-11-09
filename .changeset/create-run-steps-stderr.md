---
"@crustjs/create": minor
---

`runSteps(steps, cwd, options?)` accepts `options.stderr` for non-fatal warnings, such as an editor that failed to open. Inside a Crust command, pass the action's `stderr` so warnings go through the invocation's output.

**Behavior change:** without `options.stderr`, warnings are written to standard error through Crust's shared writer instead of `console.warn`, so replacing `console.warn` no longer captures them.
