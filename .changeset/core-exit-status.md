---
"@crustjs/core": minor
"@crustjs/testing": patch
---

An invocation now owns one exit code, and a Command Action can choose it. **Breaking:** usage errors exit 2, and `process.exitCode = n` inside an action or hook no longer changes the exit status.

- `exitCode(n)` on the action context sets the code `execute()` ends with when the action completes. The action carries on, and the last call wins; `return` or `throw` to stop early.
- A thrown value with a non-zero integer `exitCode` property exits with it, so a child process error passes its status through. Any other failure exits 1.
- `PARSE`, `VALIDATION`, and `COMMAND_NOT_FOUND` errors exit 2 instead of 1, as `grep`, `rg`, and argparse do, so scripts can tell "called wrong" from "the work failed".
- `execute()` resolves to the code and assigns `process.exitCode` once at the end. It does not take the exit code from `process.exitCode`, so a value an action or `onError` hook assigns is overwritten. Cancellation still exits 130 (143 after `SIGTERM`).
- `run()` outcomes carry a readonly `exitCode`: the code `execute()` would end with. `captureExecute().exitCode` and `runInteractive()` reflect every case. **Breaking:** a `RunOutcome` built by hand (for example one passed to `@crustjs/mcp`'s `toolResultFromOutcome`) must now include `exitCode`.

```ts
new Crust("search")
  .args({ name: "pattern", type: "string", required: true })
  .action(({ args, stdout, exitCode }) => {
    const found = lines.filter((line) => line.includes(args.pattern));
    for (const line of found) stdout(line);
    if (found.length === 0) exitCode(1);
  });
// Before: `process.exitCode = 1` in the action, invisible to `execute()` and tests.
// `search` with no pattern: before exit 1, now exit 2.
```
