---
"@crustjs/core": minor
"@crustjs/testing": minor
---

Add end-to-end typed programmatic invocation.

- `run(path, input?, io?)` infers command paths, arguments, and flags from the application definition while still exercising the normal argv parser pipeline. Raw argv invocation remains available through `execute()`, which now also accepts an optional `io` override alongside `argv`.

```ts
const outcome = await app.run(["remote", "add"], {
  args: { name: "origin" },
  flags: { fetch: true },
});
if (outcome.status === "completed") console.log(outcome.result);
```

- `run()` resolves to a `RunOutcome` discriminated union: `completed` owns the selected action's typed `result`, while `finished` owns the identity of the Extension whose `preRun` hook ended the invocation.
- Statically declared Extension commands and flags merge into typed `run()` paths and inputs; widened, conditionally assembled, or variable-length contributions stay runtime-only. Extension-owned flag values are inferred in `defineExtension()` hook contexts (command-specific flags remain `unknown`, root-only flags include `undefined`).
- String flags/args with literal `choices` narrow to the union of those values: `{ type: "string", choices: ["staging", "production"] as const }` infers `"staging" | "production"` in the action. Widened `readonly string[]` choices still infer `string`, and `parse` still owns the output type when present.
- The `Simplify` helper type is exported from the package root, so consumers with `declaration: true` exporting inferred definitions no longer hit TS2742/TS2883.
