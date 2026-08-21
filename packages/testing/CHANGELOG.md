# @crustjs/testing

## 0.1.0

### Minor Changes

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Modernize the runtime support matrix and package builds.
  
  - Supported runtimes: Bun 1.3.14+, Node.js 22+, and Deno 2.8+. Package runtime code is portable across all three — Bun globals are replaced with Node-compatible built-ins, and process spawning uses `node:child_process`. On runtimes without `AsyncDisposableStack` (Node 22/23), invocations fall back to an in-package disposal stack.
  - Package builds migrate to tsdown (Rolldown) and modules are marked side-effect free. Internal `@crustjs/utils` imports are inlined, fixing `@crustjs/store` installs that previously required `@crustjs/utils` at runtime. Consumers bundling with Bun 1.3.10–1.3.13 may encounter oven-sh/bun#27709 when tree-shaking packages with `sideEffects: false`.
  - All packages that ship type declarations declare an optional `typescript: "^7.0.0"` peerDependency. Builder inference performance is measured and supported against the native TypeScript 7 compiler; plain-JavaScript consumers are unaffected.

- [#142](https://github.com/chenxin-yan/crust/pull/142) [`c679228`](https://github.com/chenxin-yan/crust/commit/c679228436d00a398c103142762ee89381e44836) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Introduce `@crustjs/testing`: application testing helpers with captured output and fake interactive terminals.
  
  - `captureRun(app, path, input?)` drives the typed `run()` pipeline and returns a status-discriminated `CapturedRun` with captured `stdout`/`stderr`: `completed` owns the action's typed `result`, `finished` owns the finishing Extension's `by` identity, and `failed` owns the thrown `error`.
  - `captureExecute(app, argv)` drives the terminal `execute()` path in-process: exit-code protocol (`0`/`1`/`130`), Extension `onError` rendering, and cancellation are assertable without subprocess probes; `process.exitCode` is restored afterwards.
  - `runInteractive(app, path, input?)` runs against a fake terminal for prompt-driven flows. `keys()` autocompletes named key names (`ctrl+<letter>` and single printable characters remain accepted), and spinners and progress indicators render onto the fake terminal through the ambient progress sink — `waitFor()` and `screen()` observe them.
  
  `@crustjs/testing` requires `@crustjs/progress` and `@crustjs/prompts` as peer dependencies.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add end-to-end typed programmatic invocation.
  
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
