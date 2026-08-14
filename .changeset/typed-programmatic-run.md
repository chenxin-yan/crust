---
"@crustjs/core": minor
"@crustjs/testing": minor
---

Add end-to-end typed programmatic invocation: `run()` and the testing harness now infer command paths, arguments, and flags from the application definition while still exercising the normal argv parser pipeline.

**BREAKING**: `run(argv, io?)` is replaced by `run(path, input?, io?)`, and `captureRun(app, argv)` / `runInteractive(app, argv)` take the same typed `(app, path, input?)` shape.

```ts
// before
await app.run(["remote", "add", "origin", "--fetch"]);
// after
await app.run(["remote", "add"], { args: { name: "origin" }, flags: { fetch: true } });
```

Raw argv invocation remains available through `execute({ argv })` and `captureExecute(app, argv)`.
