# @crustjs/testing

## 0.1.0

### Minor Changes

- [`cc466b5`](https://github.com/chenxin-yan/crust/commit/cc466b5a0b5792d4811e85d82e341980bc1fb606) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Ship the 0.2 API revamp for the framework spine (see `docs/adr/`). This is a hard cut from the 0.1 API with no compatibility shims; each removed name's replacement is listed below.
  
  - **Extensions replace plugins**: `defineExtension(id, config)` in `@crustjs/core` (ids minted by `defineExtensionId()`) returns a plain frozen config; `.use()` is removed. Extension behavior lives in named `hooks` — `preRun(ctx)` (return `ctx.finish()` to short-circuit successfully), `postRun(ctx, outcome)` (runs in reverse extension order after every settled invocation), and `onError(error, ctx)` (return `true` after rendering an `execute()` failure). Extension-contributed commands are `defineCommand()` definitions (`ExtensionCommand` is removed), and `execute()` offers `AbortError` cancellation to `onError` hooks for central rendering (exit code stays `130`, silent when unclaimed).
  - **`define*` helpers name every definition**: `defineCommand`, `defineContext`, `defineExtension`, `defineFlag`, `defineArg`. Builder methods are variadic and accumulative — `.flags(...defs)` replaces `.flags(record)`, `.args(...defs)` replaces `.args(tuple)` — with statically known duplicate names, spellings, and aliases rejected at compile time through `FIX_*` brands. Runtime checks remain for dynamic command-recipe behavior, Context dependencies, documentation sections, and argv input. Repeating `.action()` replaces the prior action.
  - **Commands are inert reusable definitions**: `defineCommand(name, { description, usage, aliases, hidden }, recipe)` attached with the checked variadic `.add(...definitions)`; use `.as(newName)` to reuse one definition under multiple names. `.sub()`, `.command()`, `.meta()`, and `ChildCrust` are removed; root metadata moves to `new Crust(name, { description, usage })`.
  - **Contexts are declared lazy command dependencies**: `defineContext(name, { flags?, uses? }, setup)` returns a factory attached with `.provide(...instances)` and consumed through lazy `ctx` properties. Contexts, reusable commands, and Extensions declare dependencies with `uses`; composition sites check the graph. Context-owned flags are the only flag-propagation mechanism (`FlagDef.inherit` and `FlagSnapshot.inherit` are removed); `.of(value)` creates dependency-free test doubles; Context values are disposed via `Symbol.dispose`/`Symbol.asyncDispose` in reverse construction order.
  - **Actions and execution**: `.action(action)` replaces `.handle()` and defines the Command Action; `.run(path, input, { stdout, stderr })` throws for programmatic embedding; `.execute()` renders and sets `process.exitCode`. Builder-level `preRun`/`postRun` are removed — lifecycle work moves to Extension hooks.
  - **Errors**: `CrustError` keeps four stable codes (`DEFINITION`, `PARSE`, `VALIDATION`, `COMMAND_NOT_FOUND`); `_tag`, `CONFIG`, and `EXECUTION` are removed; action and Context errors pass through unwrapped.
  - **Validation**: Standard Schema is supported directly on arg/flag definitions; `@crustjs/validate` is removed.
  - **Tooling**: `Crust.snapshot()` is the supported API for frozen, validated Command Snapshots; public `CommandNode`/`prepareCommandTree()` are removed, and man/crust/skills render help, man pages, and Agent Skills from one shared command documentation model.
  - **Generics**: the generic parameters on `Crust`, `CommandDefinitionBuilder`, and the Context types were reordered and re-purposed; prefer inference over positional annotations.
  - `create-crust` ships a single minimal template.
  
  **Parser and routing**
  
  - Boolean negation is alias-symmetric: `--no-<alias>` works for every long alias, matching man pages and completion scripts. `noNegate: true` is enforced by the parser — negating a `noNegate` boolean via any spelling is a `PARSE` error instead of being silently accepted.
  - Routing skips known flags and their values before a subcommand name, so `app --quiet translate` runs `translate` instead of silently resolving the actionless root and exiting 0. It recognizes every parser-accepted spelling: long names, `--flag=value`, permitted `--no-<name>` negation, short flags and inline values, long aliases, and bundled short booleans. Unknown flags and the `--` terminator still stop routing.
  - Recursive flags before a subcommand bind to the subcommand invocation, so `app --help sub` shows the child's help. A pre-subcommand flag the routed child cannot parse now fails during routing with an actionable `PARSE` error (`Flag "--quiet" cannot be used before subcommand "sub" because "sub" does not accept it.`) instead of an unknown-flag error or silent no-op. Propagating Context-owned and recursive Extension flags continue routing through.
  - Argv tokens matching inherited `Object.prototype` keys, such as `mycli constructor` and `mycli __proto__`, report `COMMAND_NOT_FOUND` instead of crashing; typed `run()` positional and flag lookups no longer resolve inherited keys.
  
  **Definition validation**
  
  - Compile-time `FIX_*` brands own statically checkable mistakes: variadic placement, flag defaults outside literal `choices` (`FIX_DEFAULT_CHOICE`), spelling/name/alias collisions, empty flag spellings and command/argument names, reserved `__proto__` spellings, `no-` prefixes, schema exclusivity, parser synchronicity, section audience exclusivity, and dependency closure — consistently across `.flags()`, `.args()`, `.add()`, `.provide()`, `.extend()`, `defineContext`, and `defineExtension`.
  - `defineExtension()` flags are authored as a readonly array of named definitions, matching `.flags()` and `defineContext()`. Statically known Extension command collisions within one Extension tuple, with authored commands, or with other Extensions are rejected with `FIX_COMMAND_COLLISION`; flag collisions against application flags and earlier Extensions use `FIX_ALIAS_COLLISION`.
  - Dynamically assembled definitions — including config-built flags, args, commands, and Extensions — fail loudly with `DEFINITION` errors at the same composition points instead of silently misbehaving. Runtime otherwise validates only what types cannot see: argv values, dynamic strings, recipe behavior, and transitive dependencies above an `.of()` cut.
  
  **Typed run and execute**
  
  - `run(path, input?, io?)` infers command paths, arguments, and flags from the application definition while exercising the normal argv parser pipeline. Raw argv invocation remains available through `execute()`, which accepts an optional `io` override alongside `argv`.
  
  ```ts
  const outcome = await app.run(["remote", "add"], {
    args: { name: "origin" },
    flags: { fetch: true },
  });
  if (outcome.status === "completed") console.log(outcome.result);
  ```
  
  - `run()` resolves to a `RunOutcome` discriminated union: `completed` owns the selected action's typed `result`, while `finished` owns the identity of the Extension whose `preRun` hook ended the invocation.
  - Statically declared Extension commands and flags merge into typed `run()` paths and inputs; widened, conditionally assembled, or variable-length contributions remain runtime-only. Extension-owned flag values are inferred in `defineExtension()` hook contexts; command-specific flags remain `unknown`, and root-only flags include `undefined`.
  - String flags and args with literal `choices` narrow to their value union: `{ type: "string", choices: ["staging", "production"] as const }` infers `"staging" | "production"`. Widened `readonly string[]` choices still infer `string`, and `parse` still owns the output type when present.
  - Syntax-parsed input is typed separately from schema-validated action input. Typed `run()` JSON values — including named object interfaces, readonly arrays, and tuples — are constrained to recursively JSON-compatible data.
  
  **Tooling snapshots and documentation sections**
  
  - Tooling snapshots expose parser-derived flag-negation and command-listing policy. Section-listing helpers move from `@crustjs/core` to `@crustjs/core/tooling`, and the internal `Simplify` type is no longer exported.
  - Commands can define plain-text `meta.sections`, and Extensions can append sections to canonical command paths during application preparation. Help and man-page output render merged per-command sections after built-in content; generated man pages also include sections from visible subcommands.
  - Sections are visible to every renderer by default; `only` and `except` select audiences. Audiences accept Extension and renderer factory objects directly (`only: [skill]`), branded `ExtensionId` values from `defineExtensionId()` for custom renderers, and official identities on factory statics (`help.id`, `man.id`, `skill.id`). The `crust:*` id namespace is reserved for official Extensions.
  - Extensions are identified by branded ids, for example `defineExtension(defineExtensionId("acme:feature"), config)`, and expose that identity as `.id`. Handled `execute()` failures are attributed through `InvocationOutcome.by`; compare it with a factory static such as `outcome.by === help.id`. Core fallback rendering leaves `outcome.by` undefined.
  - For `execute()` failures reached during dispatch, `onError` settles before `postRun`. Invocation Contexts remain pullable through `onError` and `postRun` before disposal.
  - Application-authored "Agent skills" sections are preserved in generated skills.

- [#345](https://github.com/chenxin-yan/crust/pull/345) [`6afef3d`](https://github.com/chenxin-yan/crust/commit/6afef3d3ca04bd941507298d074d1b54a775c54a) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Require a caret-compatible version of @crustjs/core in official package peers. Packed peer ranges now start at the versioned workspace core instead of accepting all 0.x releases, excluding older incompatible core APIs.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Modernize the runtime support matrix and package builds.
  
  - Supported runtimes: Bun 1.3.14+, Node.js 22+, and Deno 2.8+. Package runtime code is portable across all three — Bun globals are replaced with Node-compatible built-ins, and process spawning uses `node:child_process`. On runtimes without `AsyncDisposableStack` (Node 22/23), invocations fall back to an in-package disposal stack.
  - Package builds migrate to tsdown (Rolldown) and modules are marked side-effect free. Internal `@crustjs/utils` imports are inlined, fixing `@crustjs/store` installs that previously required `@crustjs/utils` at runtime. Consumers bundling with Bun 1.3.10–1.3.13 may encounter oven-sh/bun#27709 when tree-shaking packages with `sideEffects: false`.
  - All packages that ship type declarations declare an optional `typescript: "^7.0.0"` peerDependency. Builder inference performance is measured and supported against the native TypeScript 7 compiler; plain-JavaScript consumers are unaffected.

- [#142](https://github.com/chenxin-yan/crust/pull/142) [`c679228`](https://github.com/chenxin-yan/crust/commit/c679228436d00a398c103142762ee89381e44836) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Introduce `@crustjs/testing`: application testing helpers with captured output and fake interactive terminals.
  
  - `captureRun(app, path, input?)` drives the typed `run()` pipeline and returns a status-discriminated `CapturedRun` with captured `stdout`/`stderr`: `completed` owns the action's typed `result`, `finished` owns the finishing Extension's `by` identity, and `failed` owns the thrown `error`.
  - `captureExecute(app, argv)` drives the terminal `execute()` path in-process: returned exit codes (`0`/`1`/`130`), Extension `onError` rendering, and cancellation are assertable without subprocess probes.
  - `runInteractive(app, path, input?)` runs against a fake terminal for prompt-driven flows. `keys()` autocompletes named key names (`ctrl+<letter>` and single printable characters remain accepted), and spinners and progress indicators render onto the fake terminal through the ambient progress sink — `waitFor()` and `screen()` observe them.
  
  `@crustjs/testing` requires `@crustjs/progress` and `@crustjs/prompts` as peer dependencies.

### Patch Changes

- [#334](https://github.com/chenxin-yan/crust/pull/334) [`6ce23e2`](https://github.com/chenxin-yan/crust/commit/6ce23e239b61777ffd29feb2458e23afc546953c) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Return the terminal exit code from `Crust.execute()`, reject dynamic flag spelling collisions instead of overwriting them, and validate command-authored documentation sections eagerly. Remove `snapshotCommand(node)` from `@crustjs/core/tooling`; use `app.snapshot()` instead. `captureExecute()` now reads the returned exit code without serializing calls or restoring `process.exitCode`.

- [#337](https://github.com/chenxin-yan/crust/pull/337) [`8e9fe39`](https://github.com/chenxin-yan/crust/commit/8e9fe3996832f0e6327bead3e82888d58df6201a) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Expose and document the public types needed to name existing API signatures. `Crust._types` is now a supported type-level seam for accessing an application's inferred command types.

- [#336](https://github.com/chenxin-yan/crust/pull/336) [`189f89c`](https://github.com/chenxin-yan/crust/commit/189f89c734664138e3873b299cd5104907f8ed8b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Route build and publish output through invocation IO, reuse build plans across distribution staging, and prevent captured executions from leaking their exit code to the process.

- [#338](https://github.com/chenxin-yan/crust/pull/338) [`85d7aa4`](https://github.com/chenxin-yan/crust/commit/85d7aa4ee5010f82622ca6f0d9e81e85f99255ee) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `withTerminalIO()` to prompts and progress so prompts, spinners, and progress indicators share one ambient input/output scope. Existing `withPromptIO()` and `withProgressSink()` APIs remain as focused aliases, and `ProgressSink` now accepts writable-compatible outputs with optional TTY metadata.
- Updated dependencies [[`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`3526708`](https://github.com/chenxin-yan/crust/commit/3526708b3e95c214c4142c31caa106f845bd2fa4), [`cc466b5`](https://github.com/chenxin-yan/crust/commit/cc466b5a0b5792d4811e85d82e341980bc1fb606), [`6ce23e2`](https://github.com/chenxin-yan/crust/commit/6ce23e239b61777ffd29feb2458e23afc546953c), [`40241e2`](https://github.com/chenxin-yan/crust/commit/40241e2e7ecf80a5524a5a6abc1e603ba81ae1b4), [`8ee2946`](https://github.com/chenxin-yan/crust/commit/8ee2946af57574bbd497104cda70dedf34e095b8), [`8e9fe39`](https://github.com/chenxin-yan/crust/commit/8e9fe3996832f0e6327bead3e82888d58df6201a), [`65b6686`](https://github.com/chenxin-yan/crust/commit/65b66866b360cf07610be5a2f52c5dce46d70dbe), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`38aac0c`](https://github.com/chenxin-yan/crust/commit/38aac0cb804c300864f37dacea460c3daf0cef29), [`11f6e26`](https://github.com/chenxin-yan/crust/commit/11f6e261e08367d9f1b36f47ed52d0646ebe9903), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`11f6e26`](https://github.com/chenxin-yan/crust/commit/11f6e261e08367d9f1b36f47ed52d0646ebe9903), [`3526708`](https://github.com/chenxin-yan/crust/commit/3526708b3e95c214c4142c31caa106f845bd2fa4), [`58fd65d`](https://github.com/chenxin-yan/crust/commit/58fd65d8efcba8dcad4652d11abb2bef62f32da9)]:
  - @crustjs/core@0.2.0
