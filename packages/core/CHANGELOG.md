# @crustjs/core

## 0.6.0

### Minor Changes

- [#553](https://github.com/chenxin-yan/crust/pull/553) [`6a7e073`](https://github.com/chenxin-yan/crust/commit/6a7e073c4cb59452a03f41cbe656fd03e2b56dc9) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Listing commands no longer builds them. In `ctx.rootCommand`, `ctx.command`, and `COMMAND_NOT_FOUND` details, a child that has not been built exposes its `defineCommand()` metadata (`name`, `description`, `aliases`, `hidden`, `usage`) without running its recipe. Reading its `meta.sections`, `hasAction`, `args`, `flags`, or `subCommands` builds it. `help()` lists subcommands from that metadata, and an unknown command no longer builds the parent's whole subtree. Root `--help` on a 200-command CLI now runs no command recipes.
  
  **Behavior change:** a command whose recipe throws no longer breaks root help or unknown-command reporting. `cli --help` still lists it, and `cli typo` reports `Unknown command "typo"`, with a `didYouMean()` suggestion, instead of the unrelated recipe error. The broken command still fails when it is run or when `app.snapshot()`, `crust build`, or its own help reads it. On a child that has not been built, `meta.sections` is an accessor, so the key is present even when its value is `undefined`. `app.snapshot()` is unchanged: it builds and validates the full tree.

- [#600](https://github.com/chenxin-yan/crust/pull/600) [`f935d7a`](https://github.com/chenxin-yan/crust/commit/f935d7a2a71bebbb1da8201c112d3c688ed50f53) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Extensions can bind structured input from `setup` or `preRun` with `ctx.bindInput({ args, flags, raw })`, for example a JSON object read from a flag. Arguments, flags, and passthrough tokens given explicitly on argv win, even when equal to the default; every other supplied key replaces the environment value or default, converted exactly as typed `run()` input. Under `run()`, supplied keys replace the typed input. The last call wins, and `ctx.args`, `ctx.flags`, `ctx.rawArgs`, validation, and the Command Action use the bound values. Binding in `setup` lets every `preRun` check see them whatever the `.extend()` order; a bound flag never selects a flag handler.

- [#568](https://github.com/chenxin-yan/crust/pull/568) [`8bf19e2`](https://github.com/chenxin-yan/crust/commit/8bf19e2627ccf49a74792ae84d363718ebc04b9f) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - A command name or flag spelling typed as `string` no longer switches off compile-time collision checks among the statically known ones. Before, one runtime-only name in an `.add()` chain, an Extension, or a `.provide()` or `.extend()` call let every later literal collision through to the runtime `DEFINITION` error; now these are compile errors:
  
  - `.add()`/`.command()` after `.add(dynamicCommand)` reusing an earlier sibling's name or alias, including one added in the same batch as the dynamic command
  - an Extension command colliding with an app command or an earlier Extension's command after an Extension with a runtime-only command name, in the same `.extend()` call or a later one, and an Extension's literal command colliding beside its own runtime-only one
  - an Extension builder `.add()` reusing an earlier literal command after a runtime-only one
  - Extension flags or Context-owned flags colliding with earlier ones after an Extension or Context with runtime-only flag spellings in the same `.extend()` or `.provide()` call, and Extension flags colliding with an added command's flags after a command with a dynamic flag record
  
  The runtime-only names themselves are still checked when the app prepares. Flags are the remaining exception: once a command's own flags include a runtime-only spelling, its later flags are checked against the earlier ones only at runtime.

- [#608](https://github.com/chenxin-yan/crust/pull/608) [`0cdd29f`](https://github.com/chenxin-yan/crust/commit/0cdd29fb72ff71e67348f5d7e8cae75753cfaed5) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Extension hooks can find where a command definition is mounted: `ctx.commandPathOf(definition)` returns the canonical names from the application root through the command added from that definition, like `ctx.commandPath`, or `undefined` when the application does not mount it. Definitions match by identity (a `.as()` copy is a different definition); one added more than once resolves to its shallowest path.

- [#618](https://github.com/chenxin-yan/crust/pull/618) [`324fb81`](https://github.com/chenxin-yan/crust/commit/324fb814c9ee55d3824e520f719e80de010fd83e) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - A Context's owned flags now appear only on commands whose `ctx` exposes the Context, where they have an effect:
  
  - the command that `.provide()`s it, and inline `.command()` children added after it, as before
  - a reusable command that declares it with `.use()`, together with the flags of the Contexts its setup uses, transitively
  - for an Extension-provided Context: the root, its inline children, and the commands that `.use()` it or the Extension (`.use(confirm)` gives `--yes` only to that command); every command when the Extension's hooks `.use()` it
  
  A command that `.use()`s a Context may also `.provide()` it; the two share its flags. A command that `.use()`s a Context parses the declared Contexts' flags, as declared: a different same-name Context that fulfills the `.use()` must own exactly the same flags with equal definitions, and the Contexts its setup uses must own only flags the command parses, or preparing the app fails with a `DEFINITION` error, reason `context-flags-not-parsed`. To replace only the value, provide the same factory, such as its `.of()` double.
  
  Parsing, help, completions, manual pages, snapshots, and typed `run()` agree: elsewhere the flag is unknown. `.use()` also adds the flags to the command's `flags` type. Pulling a flag-owning Context on a command that does not parse its flags (only possible through an untyped access) fails with a `DEFINITION` error, reason `context-flags-not-parsed`.
  
  **Breaking:** a reusable command (`defineCommand()` + `.add()`, or an Extension command) no longer accepts the flags of Contexts provided on its parent path unless it declares the Context with `.use()`, and an Extension-provided Context's flags no longer reach every command. A same-name provider with other flags than a Context a command `.use()`s, such as another default, is now a `DEFINITION` error. To migrate, add `.use(context)` (or `.use(extension)` for an Extension's Contexts) to each reusable command that should accept the flag, or `.use(context)` to the Extension when its hooks read the Context; give a replacing same-name Context the declared flags, or provide the declared factory.

- [#586](https://github.com/chenxin-yan/crust/pull/586) [`484e055`](https://github.com/chenxin-yan/crust/commit/484e0552aeadbaa4103bc61553f1183ee25b212c) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Tokens after `--` now fill positional arguments. A positional value that starts with `-` can be passed after `--`, so `seek -- -5` binds `-5` to the first positional argument. Before, `seek -5` failed with `Unknown flag`, and `seek -- -5` left `-5` in `rawArgs`, so a required positional argument was reported missing. Tokens after `--` still never parse as flags.
  
  **Behavior change:** declared positional arguments that are still unfilled take tokens after `--` first, and only the remaining tokens reach the action as `rawArgs`. A command without positional arguments keeps receiving every token after `--` in `rawArgs`. A command with an optional or variadic positional argument now binds the first token after `--` (or all of them, for a variadic argument) to that argument. For example, `wrap [target] -- --watch src` now sets `target` to `--watch` and `rawArgs` to `["src"]`, where `target` used to be `undefined` and `rawArgs` held both tokens. To keep forwarding everything after `--`, pass every non-variadic positional value before `--`, or read them from `rawArgs` and drop the positional argument. A variadic positional argument now takes every token after `--` (`wrap src -- --watch` with `files...` sets `files` to `["src", "--watch"]`), so a command that forwards `rawArgs` should not declare one. `run()`'s `raw` input is unchanged and never fills `args`.
  
  The MCP tool schema's `raw` description no longer says its values act as if written after `--`; they are received as `rawArgs` and never fill arguments.

- [#567](https://github.com/chenxin-yan/crust/pull/567) [`2821b47`](https://github.com/chenxin-yan/crust/commit/2821b479175e77e513330ac5100b50ac159573a7) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Breaking: `ParseErrorDetails` no longer has a `value` field. Core stopped populating it; read `flag` or `argument` instead.

- [#603](https://github.com/chenxin-yan/crust/pull/603) [`0a2c6b1`](https://github.com/chenxin-yan/crust/commit/0a2c6b198b07b693789f10a4c0532f27b94a6a9d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Extension behavior no longer depends on `.extend()` order. An invocation runs `setup → handle → preRun → validation → action → postRun`:
  
  - `.setup()` configures the process before anything prints and registers cleanup with `ctx.defer()`.
  - `.handle(flag, run, { eager })` lets an Extension take over the invocation when the user passes one of its flags. Eager handlers win first, then the flag given first on the command line, as in Click, argparse, and GNU tools.
  - `.noAction()` runs when the command has no Command Action and no handler took over; an application can have one.
  - `preRun` runs only when the Command Action will, so checks and notices there never fire on `--help` or `--version`. It can fail the invocation by throwing.
  
  **Breaking:** `ctx.handled()` and the `Handled` type are removed; use `.handle()`. Help and snapshots list Extension flags by name instead of registration order.

- [#556](https://github.com/chenxin-yan/crust/pull/556) [`d5a9522`](https://github.com/chenxin-yan/crust/commit/d5a9522f11836b7c6beac79901f87f6d74d608a2) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `.extend()` now only records Extensions. The app applies the final Extension list when it prepares (first run, `app.snapshot()`, `at()`, or `crust build`), so Extensions behave the same whether commands were added before or after `.extend()`. Registering an `ExtensionId` again also rescues an earlier registration of that id that conflicted, on the root and on every command; before, the conflict could still fail the run.
  
  **Behavior changes:** the first one only shows up in programs TypeScript already rejects, such as dynamic or `as never` inputs. The flag order change is visible in the help of any app that adds commands or defines root flags before `.extend()`.
  
  - `.extend()` no longer throws. A collision between an Extension-provided flag and the app's flags, or a missing Context for an Extension's `.use()` or `.provide()`, is now a `DEFINITION` error when the app prepares: a `failed` outcome from `run()`, a rendered error from `execute()`, or a rejection from `app.snapshot()`.
  - Flags owned by Extension-provided Contexts are listed first on every command, before the command's own flags. Commands added before `.extend()` and root flags defined before it used to list them after, so their help output changes order.
  - A command added before `.extend()` that provides its own Context with the name of an Extension-provided one now also accepts the flags the Extension's Context owns, like a command added after `.extend()`. Its own Context still supplies the value.

- [#592](https://github.com/chenxin-yan/crust/pull/592) [`4208178`](https://github.com/chenxin-yan/crust/commit/420817832f065c875e836b86deac832f84d86828) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `execute()` now writes its default output synchronously to file descriptors 1 and 2 instead of through `process.stdout` and `process.stderr`, so CLIs start faster. Large output piped to another program is no longer cut off when an action calls `process.exit()` right after writing it, and a `console.log` after a large write no longer lands in the middle of it on Bun. Windows keeps writing through `process.stdout` and `process.stderr`.
  
  **Behavior change:** replacing `process.stdout.write` or `process.stderr.write` no longer captures Crust's output on macOS and Linux. Pass `execute({ io })` or use `captureExecute()` from `@crustjs/testing` instead. Print from actions with `stdout()` and `stderr()` rather than `console.log`: only output that goes through them is captured by `run()`, tests and MCP, and kept in order with Crust's own output.

- [#581](https://github.com/chenxin-yan/crust/pull/581) [`7e2da48`](https://github.com/chenxin-yan/crust/commit/7e2da482af5a21d27a2d32839a051cc6e0c36974) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `.flags()` no longer checks at runtime that each flag definition is an object when TypeScript already rejects it, such as a string or an array in place of a definition. A `null` or `undefined` definition, a `null` or `undefined` record, and a record whose prototype is not `Object.prototype` or `null` (such as a `Record`-typed literal written with a `__proto__` key) still throw a `DEFINITION` error with `reason: "invalid-flags"`.

- [#609](https://github.com/chenxin-yan/crust/pull/609) [`8876005`](https://github.com/chenxin-yan/crust/commit/887600526c5a01229f00c26cd81ba86bf1305001) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Command Actions can stream events as `async function*` generators: each `yield` emits an event and the `return` value becomes the result, validated by `.output()` when declared. `run()` and `execute()` take an `onEvent(event)` option that receives each event live, an Extension's `Renderer` gets `stream()` once before the first event and `event(value)` per yield, and the `run()` outcome and `postRun`'s `InvocationOutcome` carry the yielded values as `events` (`[]` for a generator that yields nothing; absent for ordinary actions), typed from the yields in `run()`. Events are never printed by default. Cancellation, or a throwing renderer `event` or `onEvent` callback, closes the generator with `return()` and fails the invocation, keeping the events yielded so far.

- [#587](https://github.com/chenxin-yan/crust/pull/587) [`9592652`](https://github.com/chenxin-yan/crust/commit/95926524d877ebc6d20307095408bac2f5fa95d4) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - A generic command factory such as `function deployTo<const N extends "staging" | "production">(name: N) { return defineCommand(name, …) }` now compiles, also with literal `aliases`, and `run()` keeps its typed results. Before, `defineCommand()` and `.as()` rejected a generic name with `TS2345`.
  
  **Type change:** a literal command name that can't route, such as `"-x"`, `"my cmd"`, `""` or `"__proto__"`, is now a compile error where the definition is passed to `.add()` (on an app, in a recipe, or on an Extension, including when spread from an array), not at `defineCommand()` or `.as()`. So is an alias equal to its command's own name. The command-name error text is unchanged; the self-alias error now reads `Command "issue" must not list its own canonical name as an alias`. A definition that is never added no longer fails typecheck, but `defineCommand()` and `.as()` still throw a `DEFINITION` error at runtime. `.command()` names and the shape of `defineCommand()` config aliases (blank, whitespace, a leading `-`) are still checked at the call.

- [#563](https://github.com/chenxin-yan/crust/pull/563) [`0ab1ca1`](https://github.com/chenxin-yan/crust/commit/0ab1ca1e69caa38a872a2cf36266b200664d5228) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Literal definition mistakes now fail typecheck, and computed values throw a runtime `DEFINITION` error.
  
  - Breaking: a flag name, alias, or `short` must not contain whitespace or start with `-`, and a name or alias must not contain `=`. Such spellings used to register without error: the parser adds the dashes and splits `--name=value` at the first `=`, so a name like `"a=b"` could never be matched, and `"--output"` as an alias meant typing `----output`. Literal spellings now fail typecheck (`FIX_SPELLING_SHAPE`), and dynamic ones throw a `DEFINITION` error (`reason: "invalid-spelling"`). To migrate, drop the dashes (`aliases: ["output"]`) or pick another name.
  - An empty literal `env.name`, `delimiter`, or `env.delimiter` fails typecheck (`FIX_EMPTY_ENV`, `FIX_EMPTY_DELIMITER`).
  - `defineExtensionId()` rejects an empty or untrimmed literal id (`FIX_EXTENSION_ID`).

- [#650](https://github.com/chenxin-yan/crust/pull/650) [`2209085`](https://github.com/chenxin-yan/crust/commit/22090852b5d212756be2ed9d1a2411dbb688f912) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Core value errors never print the raw value, so a secret read from an `env` binding stays out of CI logs and agent transcripts. They name the argument or flag, plus the variable when the value came from the environment. Message wording changes: `Invalid value "x" for --mode. Expected one of: …` is now `Invalid value for --mode. Expected one of: …`, `Expected number for --port, got "x"` is now `Expected a number for --port.`, `Invalid URL for --base: "x"` is now `Invalid URL for --base.` (the missing-protocol hint stays), and `Invalid JSON for --data` drops the engine's parse reason (the shell-quoting tip stays). Typed `run()` and bound input use the same wording, as in `Expected a number for --port.` (was `Expected number for --port`), `Expected a URL for --home.`, and `Expected a JSON value for --data.`. An environment value adds its source, as in `Expected a number for --port (from $PORT).`; a `noNegate` env message reads `(from $NAME)` too. These errors no longer carry the native `URL` or `SyntaxError` as `cause`, since engines quote the input there. A flag rejected before a subcommand (`flag-not-forwardable`) is named without its inline value in the message and `details.flag` (`--token=x` reports `--token`). Error codes are unchanged. Messages from your own `parse` functions and Standard Schema issues are printed as written; unknown commands and extra positional arguments are still echoed so typos stay visible.

- [#602](https://github.com/chenxin-yan/crust/pull/602) [`a074f45`](https://github.com/chenxin-yan/crust/commit/a074f454a28611f0a0a1f3d0bab8df50b235960d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Commands can declare their result with `.output(schema)` (any Standard Schema). Declared before `.action()`, TypeScript requires the action to return the schema's input type; at runtime Crust validates the awaited result and returns the schema's output as the `result`, typed in `run()` and passed to `postRun`. A rejected result fails with the new `OUTPUT` `CrustError` code (`details.issues`, paths relative to the result). `CommandSnapshot.outputSchema` carries the result's draft 2020-12 JSON Schema when the schema implements Standard JSON Schema, and `@crustjs/core/tooling` exports `standardJsonSchema(schema, "input" | "output")`, which returns that JSON Schema or `undefined` when the schema has no converter or it throws. Commands without `.output()` are unchanged. `@crustjs/utils/schema` exports the `StandardJSONSchema` and `InferInput` types.

- [#596](https://github.com/chenxin-yan/crust/pull/596) [`9a0d85c`](https://github.com/chenxin-yan/crust/commit/9a0d85c70560a394781f976949a517cba6515bcb) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Extension `postRun` hooks now receive the Command Action's result. A `completed` `InvocationOutcome` carries the action's awaited return value as `result` (`undefined` for a command without an action), in both `run()` and `execute()`. `execute()` still resolves to an exit code, and `run()` is unchanged.

- [#545](https://github.com/chenxin-yan/crust/pull/545) [`3273ceb`](https://github.com/chenxin-yan/crust/commit/3273ceb045554c446ac7da4937885700bf349d17) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Speed up type-checking of `.add()` chains and command recipes: type-check cost now grows linearly with the number of commands. Compile-time error messages are unchanged. Three corner cases change:
  
  - Explicit type arguments on `.flags()`, `.args()`, `.add()`, and `.command()`, such as `app.add<readonly [typeof deploy]>(deploy)`, are now a compile error (`FIX_EXPLICIT_TYPE_ARGUMENTS`). Remove them; these methods infer their type arguments from the builder they are called on. This also removes the explicit-tuple way to call `.add()` on a builder union (`condition ? app.add(a) : app`); write the chain in each branch instead. `.action()`, `.provide()`, `.use()`, and `.extend()` are unchanged.
  - `.add()` and `.command()` on a builder union whose branches differ, such as `(useTelemetry ? app.extend(telemetry) : app).add(child)`, are now a compile error, like the other builder methods already were. Keep the command shape static or write the chain in each branch (see [Conditional chains](https://crustjs.com/docs/api/crust#conditional-chains)).
  - Reassigning a builder variable with commands whose names are not literal types, as in `for (const name of names) app = app.add(defineCommand(name, recipe))`, no longer compiles. Register the list in one call: `app.add(...names.map((name) => defineCommand(name, recipe)))`.

- [#560](https://github.com/chenxin-yan/crust/pull/560) [`97e8def`](https://github.com/chenxin-yan/crust/commit/97e8def311a44507f4c06f16843f840bfa587d12) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `.flags()` on commands, Contexts, and Extensions accepts one record keyed by flag name: `.flags({ out: { type: "string", short: "o" }, "dry-run": { type: "boolean" } })`. A compile error lands on the offending flag's own object literal. `defineFlag(def)` defines a reusable flag without a name; the key it is attached under names it, so `.flags({ format })` and `.flags({ output: format })` share one definition.
  
  - A flag whose name is integer-like, such as `"2"` or `"10"`, now throws a `DEFINITION` error (`reason: "integer-like-name"`), because JavaScript lists such keys first and would reorder help and snapshots. A literal key is also a compile error, as is an unquoted number key such as `1.5` (write `"1.5"`). `.flags()` input that is not a plain-object record of object definitions throws a `DEFINITION` error (`reason: "invalid-flags"`), including a record written with a literal `__proto__` key, which sets the record's prototype instead of naming a flag.
  - The Extension flag type argument is now a record: the fourth type argument of `Extension` and `ExtensionFactory` is an `ExtensionFlagsDef` (default `{}`) instead of a tuple of named definitions, and `InferExtensionFlags` takes that record. Annotations such as `ExtensionFactory<[], {}, [], [], Commands>` become `ExtensionFactory<[], {}, [], {}, Commands>`. The third type argument of `ContextBuilder` is likewise the owned flag record.

- [#575](https://github.com/chenxin-yan/crust/pull/575) [`d863ca6`](https://github.com/chenxin-yan/crust/commit/d863ca674800fe6a1595187378129c2bef86a9f6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Compile-time collision checks between Extension flags and the flags of commands below the root now follow the runtime: only recursive Extension flags (the default) and flags owned by Contexts an Extension provides reach those commands.
  
  No longer compile errors, since the app runs:
  
  - a nested child added inside an inline `.command()` recipe after `.extend()` of an Extension with recursive flags (`Flag spelling "trace" collides with a registered Extension flag`)
  - a child, inline `.command()`, or Extension command declaring a spelling of an Extension flag with `recursive: false`, which is registered only on the root
  
  Now compile errors, where the runtime already throws `DEFINITION`: after an Extension with runtime-only recursive flags, an inline `.command()` or Extension command declaring a flag that collides with an inherited Context flag or a statically known recursive Extension flag.

- [#562](https://github.com/chenxin-yan/crust/pull/562) [`75555f3`](https://github.com/chenxin-yan/crust/commit/75555f37d8624114c02cf8af3cace0e6826aef02) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Breaking: `.flags()` on commands, Contexts, and Extensions takes only the record form, and `defineFlag()` takes only a definition. The named form `.flags({ name: "out", type: "string" }, …)` and `defineFlag(name, def)` are removed, along with the `NamedFlagDef` and `NamedExtensionFlagDef` types. Each call takes exactly one record; call `.flags()` again to add more. A flag's key is its name:
  
  ```ts
  const format = defineFlag({ type: "string", choices: ["json", "yaml"] });
  app.flags({ out: { type: "string", short: "o" }, format });
  ```

- [#648](https://github.com/chenxin-yan/crust/pull/648) [`76c59f8`](https://github.com/chenxin-yan/crust/commit/76c59f8df5e91ae09e96cd1e6fe8f85d22ecb6d7) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - A `Renderer` can render cleanup failures with a new optional `cleanup(error)` member. In `execute()`, Core calls it once for each cleanup failure it used to print as plain `Cleanup failed: …` lines (several cleanups that fail together are passed one by one): a Context disposal or deferred cleanup that fails after a failure was already rendered, and cleanup that fails while a cancellation unwinds. Without `cleanup`, or if it throws, Core prints its plain lines as before, so a cleanup failure is never hidden. Exit codes and `run()` are unchanged.

- [#597](https://github.com/chenxin-yan/crust/pull/597) [`de79812`](https://github.com/chenxin-yan/crust/commit/de798128f888f9525fd7b58adce9366f4c8f9610) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - An Extension can choose how an invocation's output is rendered with `.renderer(select)`. After every setup, Core calls and awaits `select(ctx)` once (it may be `async`, to load a formatter lazily); the returned `Renderer` receives the Command Action's and Contexts' `stdout()` lines (`text`) and `stderr()` lines (`diag`), the completed action's result (`result`), and, in `execute()`, a failure no `onError` hook claimed (`error`, in place of Core's `Error: …` lines). Return `undefined` to keep the default. Output written before the renderer is chosen waits for it; an application without `.renderer()` writes immediately, as before. A setup failure is rendered through the chosen renderer too (Core still calls `select`, falling back to the default if it fails; a failing `select` or renderer never replaces the setup failure); routing and argv syntax failures, before flags are bound, render by default. An Extension's own `ctx.stdout`/`ctx.stderr` bypass the renderer, exit codes are unchanged, and at most one Extension in an application may set `.renderer()` (a second is a `DEFINITION` error, `duplicate-renderer`).

- [#646](https://github.com/chenxin-yan/crust/pull/646) [`5530b8f`](https://github.com/chenxin-yan/crust/commit/5530b8f67b329928696a4102efc73e9a3f6153cf) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `execute()` now cancels on `SIGTERM` as well as `SIGINT`. Supervisors such as `docker stop`, Kubernetes, systemd, `timeout`, CI cancellation, and agent harnesses send `SIGTERM`, which used to kill the process on the spot and skip `postRun` hooks, Context disposal, and Effect finalizers. The first `SIGTERM` now aborts `ctx.signal` with an `AbortError` (`Terminated by SIGTERM.`), cleanup runs, and the process exits `143`; Ctrl-C still exits `130`, and so does an aborted `execute({ signal })`. Like Ctrl-C, a second `SIGTERM` within 50 ms counts as the same signal, a later one terminates unless another listener owns it, and a `SIGTERM` the process inherited as ignored stays ignored.
  
  **Behavior change:** a command that ignores `ctx.signal` now keeps running after the first `SIGTERM` until it finishes or a second `SIGTERM` arrives.

- [#611](https://github.com/chenxin-yan/crust/pull/611) [`3f6a973`](https://github.com/chenxin-yan/crust/commit/3f6a973e7765856a36444c7a14e96b96a6faee14) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Schema-backed args and flags now carry their Standard Schema's draft 2020-12 input JSON Schema in the Command Snapshot as `inputSchema` (when the schema can produce one), and `commandInputSchema()` from `@crustjs/core/tooling` advertises it for that definition when `run()` accepts what it describes: top-level `type` `"string"` (`"boolean"` for `type: "boolean"` flags), or `"array"` of those for variadic and `multiple`, without `$ref`/`$defs`. Other schema-backed definitions, such as `z.coerce.number()`, keep their token type. Output for non-schema definitions is unchanged. `CommandInputPropertySchema` widens `format` to `string` and `enum` to strings and booleans to match the keywords such schemas carry.

- [#628](https://github.com/chenxin-yan/crust/pull/628) [`25b631d`](https://github.com/chenxin-yan/crust/commit/25b631d0236c7b3c99eb69d19fb52c24a2f65043) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `CommandSnapshot.output` is `true` when the command declared `.output()`, even when its schema can't produce the JSON Schema `outputSchema` carries. Tooling uses it to tell commands that return data from the rest: `json()` prints only the JSON result of such a command under `--json`, dropping the text it prints with `stdout()`.

- [#595](https://github.com/chenxin-yan/crust/pull/595) [`516bb0a`](https://github.com/chenxin-yan/crust/commit/516bb0a6bff1aa10c31080b799ef76c54ec12331) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `@crustjs/core/tooling` exports the command <-> JSON input mapping that `@crustjs/mcp` used internally. `commandInputSchema(command, path)` describes a command's input as one flat JSON Schema object (each arg and flag by name, plus `raw` for passthrough values), and `parseCommandInput(command, values)` turns such an object into structured `run()` input, converting `url` strings to `URL`s (an invalid one fails with the same `PARSE` error as argv, `Invalid URL for --name.`). Also exported: `commandInputFields(command)` (the arg and `url` field names that split uses), `RAW_INPUT_PROPERTY`, and the `CommandInputFields`, `CommandInputSchema`, `CommandInputPropertySchema`, `RunInputPayload`, and `RunInputValue` types. `@crustjs/utils/json` exports `parseJsonValue(value)`, which returns a detached copy of plain JSON data (reading each property once) and throws a `TypeError` for anything JSON would not round-trip, such as `undefined`, `NaN`, class instances, array holes, or cycles (`-0` is the one exception: it is kept, though `JSON.stringify` writes it as `0`); core uses it for this input and `@crustjs/mcp` for tool results.

- [#606](https://github.com/chenxin-yan/crust/pull/606) [`83d1670`](https://github.com/chenxin-yan/crust/commit/83d16708c0e107f264f3b7089228c562d74abfd3) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - A command's `.use()` now also takes an Extension or Extension factory, standing for the Contexts that Extension provides: `.use(time)` gives the action `ctx.clock` when `time()` provides `clock`, without importing the Context factory. TypeScript checks those Contexts where the command is added, as for `.use(clock)`; at runtime, preparing an app that does not extend the Extension throws a `DEFINITION` error with the new reason `missing-extension`.

- [#601](https://github.com/chenxin-yan/crust/pull/601) [`a411ccb`](https://github.com/chenxin-yan/crust/commit/a411ccb1b09eb05dd372757549631f429587981f) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `ExtensionContext.sources`, reporting where each argument's and flag's current value came from as a `ValueSource` (`"argv"`, `"run"`, `"env"`, `"bound"`, or `"default"`), keyed by argument name and canonical flag name; names without a value are absent. `sources.raw` is `"argv"`, `"run"`, or `"bound"` when passthrough tokens came from argv, typed `run()`, or `bindInput`. It reads live, so after `bindInput` the keys it supplied report `"bound"`. Extensions that convert structured input before `bindInput` use it to skip keys argv gave. `ValueSource` is exported from `@crustjs/core`.

- [#510](https://github.com/chenxin-yan/crust/pull/510) [`6fdb8a6`](https://github.com/chenxin-yan/crust/commit/6fdb8a642b79a176d60d9a3d4be3431493201052) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Let `--help` and `--version` win over invalid flag and argument values. A value that fails type conversion, `choices`, or `parse`, from argv or an `env` binding, is now reported after Extension `preRun` hooks, ahead of missing required values, so `PORT=abc cli --help` and `cli --port abc --version` succeed in any argv order. Messages and error codes are unchanged, and the Command Action still never runs with an invalid value. Until the error surfaces, `preRun` and `postRun` hooks see the invalid flag or argument as `undefined`, not its default; Extension-owned defaulted value flags (and `noNegate` booleans with `env`) are now typed `T | undefined` in hook contexts to match. Action types are unchanged. Malformed argv (unknown flags, a missing option value such as `--port --help`) still fails before any hook runs.
  
  Reject blank and whitespace-only numbers: `--port ""` and `PORT=` now fail with `Expected a number for --port.` instead of becoming `0`. This also applies to `parseFlagValues` and `@crustjs/env` variables.

- [#559](https://github.com/chenxin-yan/crust/pull/559) [`1880c41`](https://github.com/chenxin-yan/crust/commit/1880c4108324d215baca5528a39ac779ec99329d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - An Extension command whose name or alias collides with an app command or another Extension's command is now a `DEFINITION` error (`reason: "command-collision"`) when the app prepares, matching `.add()` and the existing compile-time check. Before, one command silently replaced or shadowed the other. Breaking only for collisions TypeScript can't see, such as a name passed to `skills({ command })` as a `string`. Registering the same `ExtensionId` again still replaces its earlier commands.

- [#533](https://github.com/chenxin-yan/crust/pull/533) [`3f0db61`](https://github.com/chenxin-yan/crust/commit/3f0db6189a1e33d3c5e9dbee44624feadc8a7cb0) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Commands now build on first use. `.add()` records each definition by name and metadata, and an invocation runs only the recipes on the path it routes through, so startup no longer grows with the number of commands and long `.add()` chains are linear. `ctx.rootCommand` and `ctx.command` are projected on demand.
  
  **Behavior change:** an error thrown by a command's recipe, or a recipe-time collision with an inherited flag or a missing Context demand, now surfaces when that command is run or the tree is inspected (`app.snapshot()`, help, `crust build`) instead of at `.add()`. Other commands keep working. Call `await app.snapshot()` in a test to validate every command eagerly.

- [#559](https://github.com/chenxin-yan/crust/pull/559) [`1880c41`](https://github.com/chenxin-yan/crust/commit/1880c4108324d215baca5528a39ac779ec99329d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Drop runtime checks that only inputs bypassing the types could reach. Runtime checks now cover only values TypeScript can't see, such as names typed `string`, spread arrays, and `Record` definitions. Breaking only for callers that bypass the types (`as never`, `any`, or plain JavaScript):
  
  - `defineCommand()` without a recipe no longer throws a `DEFINITION` error (`missing-recipe`); the command fails with a `TypeError` when it is first built.
  - `version()` and `updateNotifier()` no longer throw when neither the call nor the root metadata supplies a version.
  
  `"missing-recipe"` is removed from `DefinitionErrorReason`.
  
  Runtime checks still reject a documentation section with both `only` and `except`, a flag `env` that is not `{ name: string, delimiter?: string }` (`invalid-env`), and a `delimiter` or `env.delimiter` on a flag without `multiple: true` (`delimiter-without-multiple`). Structural views can hide these properties from TypeScript without removing them at runtime.

### Patch Changes

- [#506](https://github.com/chenxin-yan/crust/pull/506) [`a805be3`](https://github.com/chenxin-yan/crust/commit/a805be3923e60e64e34fb3ac49a41b9f4b7cf71a) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fix `TS2589: Type instantiation is excessively deep and possibly infinite` when one `app.add(...)` or Extension `.add(...)` call registers 44 or more command definitions. The error names the `FIX_*` key and its text instead of the argument position. `.add<ExplicitTuple>(...)` on a builder union (`condition ? app.add(a) : app`) no longer reports a duplicate command name at compile time; `.add()` still throws for it at runtime.

- [#593](https://github.com/chenxin-yan/crust/pull/593) [`fd54147`](https://github.com/chenxin-yan/crust/commit/fd541473c362c3f0c1054513ca00bbd681287d78) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Argv is now tokenized by Crust itself instead of `node:util`'s `parseArgs`, so Bun and Node report malformed argv with the same messages (an unknown short in `-zx` is `Unknown flag "-z"` on both). A `short` of one code point, such as `"😀"`, is now accepted and works alone and in clusters. A `-` inside a short cluster (`-v-x`) is reported as an unknown flag instead of ending flag parsing like `--`. When argv contains several errors, the first one in argv order is reported.

- [#544](https://github.com/chenxin-yan/crust/pull/544) [`3c78cc9`](https://github.com/chenxin-yan/crust/commit/3c78cc9cc461be383551f599e838cb1e7253a4a1) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Speed up type-checking of one `.add(a, b, …)` call with many command definitions: the extra cost of first using the returned app now grows linearly with the number of definitions instead of quadratically. Compile-time error messages are unchanged.

- [#543](https://github.com/chenxin-yan/crust/pull/543) [`4f4d9e9`](https://github.com/chenxin-yan/crust/commit/4f4d9e9eb44a7f43577bfd883ae7959dd112ac64) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Speed up type-checking of command definitions and `.add()` chains. Compile-time error messages are unchanged.

- [#622](https://github.com/chenxin-yan/crust/pull/622) [`80a8c62`](https://github.com/chenxin-yan/crust/commit/80a8c62389994bd5368c96464e4f7d7b74ef222a) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `execute()` keeps exit code `130` when cleanup fails after cancellation (Ctrl-C or an aborted `execute({ signal })`), so shell loops and scripts still see the interrupt. A `SuppressedError` whose `suppressed` side is an `AbortError` now counts as cancellation. Core still renders the cleanup failure (`Cleanup failed: …` for Context disposal, or the disposal error from an action's own `await using`) and stays silent about the abort itself. Previously these runs exited `1`.

- [#508](https://github.com/chenxin-yan/crust/pull/508) [`cc3048c`](https://github.com/chenxin-yan/crust/commit/cc3048cb281e4f6cf556e81ed7358d7e2fb0e52c) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fix `TS2344` in `@crustjs/core`'s shipped declarations for projects that enable `exactOptionalPropertyTypes` without `skipLibCheck`. `execute({ argv })` now accepts a `readonly string[]`, such as an `as const` fixture. `parseFlagValues()` from `@crustjs/core/tooling` now keeps inline `choices` as literal unions instead of widening them to `string`. `AnyContextInstance` is now exported, so the open provider form `ExtensionFactory<[], {}, readonly AnyContextInstance[]>` can be written. Code that mutated `ExecuteOptions.argv` through the interface must now copy it first.

- [#509](https://github.com/chenxin-yan/crust/pull/509) [`6e4e59b`](https://github.com/chenxin-yan/crust/commit/6e4e59bfa71d72daf39ceebc752e27d29b0449af) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `error instanceof CrustError` now types `code` as the union of error codes and `details` as the matching details union instead of `any`; checking `error.code` narrows `details` like `.is(code)` does. Code that read code-specific `details` fields right after `instanceof` must narrow first. `details.reason` now autocompletes Core's reasons (exported as `DefinitionErrorReason` and `ParseErrorReason`) and still accepts any string. A `.flags()` brand error now lands on the offending flag's own definition (`Type '{ type: "string"; … }' is not assignable to type '… & { readonly FIX_DEFAULT_CHOICE: … }'`), and one `.flags()` call with two different spelling collisions is now rejected instead of compiling. `.extend()` of an Extension that needs root metadata the constructor lacks, such as `version()` without `new Crust(name, { version })`, now reports `FIX_ROOT_META: Extension requires root metadata "version"; …` instead of an internal `[defining].sections` variance error.

- [#572](https://github.com/chenxin-yan/crust/pull/572) [`014d5aa`](https://github.com/chenxin-yan/crust/commit/014d5aa41499d1a0cc69f83589a0ff7a0f0432c7) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fix `TS2589: Type instantiation is excessively deep and possibly infinite` when about 50 or more chained `.extend()` calls register Extensions that add flags, including Extensions whose commands have subcommands.

- [#557](https://github.com/chenxin-yan/crust/pull/557) [`46ab354`](https://github.com/chenxin-yan/crust/commit/46ab3549974b98b36329471cf212e3171e8fdf5e) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fix `TS2589: Type instantiation is excessively deep and possibly infinite` when one `.extend(...)` call registers 45 or more Extensions. Error messages are unchanged.

- [#564](https://github.com/chenxin-yan/crust/pull/564) [`da6dace`](https://github.com/chenxin-yan/crust/commit/da6dacef13b95abcbe5472ebaf1de441cddb0003) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Extension commands are typed like commands added with `.add()`, as the docs describe:
  
  - Fix `TS2589: Type instantiation is excessively deep and possibly infinite` when an app registers 45 or more Extension commands, whether one Extension `.add()`s them, one `.extend()` call passes many Extensions, or up to about 200 `.extend()` calls are chained.
  - Fix the same `TS2589` for one `.add()` call with about 50 or more literal commands followed by one whose name is only known at runtime.
  - A conditionally chosen Extension (`.extend(cond ? a : b)`) or an Extension with a conditional commands array no longer rejects every `run()` path. Like any Extension whose command names are only known at runtime, it leaves paths to runtime checks and makes `run()` results `unknown`, because it may re-register an earlier Extension's id.

- [#570](https://github.com/chenxin-yan/crust/pull/570) [`8544498`](https://github.com/chenxin-yan/crust/commit/854449869f795f00505952dc04d653f2e7f6f923) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - An `.extend()` call with an Extension whose command names are only known at runtime no longer makes every typed `run()` result `unknown`. Commands added with `.add()` or `.command()` keep their result types, since no Extension can replace them; only commands contributed by Extensions registered up to and in that call become `unknown`, because a same-id re-registration may replace them.

- [#585](https://github.com/chenxin-yan/crust/pull/585) [`e974d05`](https://github.com/chenxin-yan/crust/commit/e974d05834785604ed16551613baec9e7a961c4a) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fix `TS2589: Type instantiation is excessively deep and possibly infinite` after about 90 chained `.flags()` calls on a command, or about 100 chained `.provide()` calls with Contexts that own flags. `defineExtension(…).flags()` and `defineContext(…).flags()` chains no longer hit the same limit.

- [#576](https://github.com/chenxin-yan/crust/pull/576) [`8ff9c6a`](https://github.com/chenxin-yan/crust/commit/8ff9c6abeaf3b89adb90f72c533d98d5c13ccce9) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Typed `run(path)` and `at(path)` now type paths below a command the types can't see into, such as an Extension command after `.extend()` of an Extension with a runtime-only command name, as `RunOutcome<unknown>` instead of `RunOutcome<never>`. Such paths were already accepted and run at runtime; known paths stay precise and unknown paths under a fully typed tree are still compile errors.

- [#582](https://github.com/chenxin-yan/crust/pull/582) [`48823e8`](https://github.com/chenxin-yan/crust/commit/48823e82c50f583b990b99f49f5441bcf0280723) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Flag value errors now use Crust's own wording instead of Node's `util.parseArgs` messages, and read the same on Node and Bun. A value-taking flag with no value reports `Missing value for flag "--count"`, adding `; to pass a value starting with "-", write --count=<value>` when the next token looks like a flag. A boolean flag given a value, such as `--force=yes` or `--no-force=yes`, reports `Flag "--force" does not take a value`. These `PARSE` errors carry `details.flag` (the canonical flag name) and `details.reason` (`"missing-value"` or `"unexpected-value"`).

- [#546](https://github.com/chenxin-yan/crust/pull/546) [`09a6808`](https://github.com/chenxin-yan/crust/commit/09a68080e8809b507dbcd0c581bd9942b186f44b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fix `TS2589: Type instantiation is excessively deep and possibly infinite` when one `.provide(...)`, `.extend(...)` or command `.use(...)` call brings in 46 or more Contexts. `.provide()` covers both apps and Extensions; `.extend()` covers an Extension that provides that many Contexts. Error messages are unchanged.

- [#547](https://github.com/chenxin-yan/crust/pull/547) [`02993c7`](https://github.com/chenxin-yan/crust/commit/02993c71a43cafa1cbbd9853bf00e991efccb1cb) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Commands whose action always throws no longer fail type-checking when the app or recipe provides Contexts. This affected projects that type-check against the source, such as monorepo setups.
  
  The published types now reject assigning a builder with unmet Extension or Context demands where a satisfied builder is expected, matching type-checking against source. Previously the installed package accepted such assignments because the proof type was missing from its declarations.

- [#505](https://github.com/chenxin-yan/crust/pull/505) [`34df0c6`](https://github.com/chenxin-yan/crust/commit/34df0c604910ceab083a7e88910cc510da4a5c5a) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Speed up type-checking of typed `app.run(path, input)` calls and fix `TS2590: Expression produces a union type that is too complex to represent` from `app.at()`/`app.run()` on apps with several hundred command spellings. One literal `run()` call on a 100-command app now costs about 0.3M type instantiations instead of 5.6M. If you pass explicit type arguments to `app.run(path, input)`, the second type parameter is now the selected command shape; the input type moved to third. Calls that pass only the path type argument (`app.run<readonly ["build"]>(...)`) are unchanged.

- [#511](https://github.com/chenxin-yan/crust/pull/511) [`27f5832`](https://github.com/chenxin-yan/crust/commit/27f583260be2ad90544dd85d5653f7ab23255cff) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Report a defaulted argument or flag as optional: a snapshot's `required` is now absent when the definition has a `default`, matching the parser, so help shows `app [target]` instead of `app <target>` and man pages, skills, and completion agree. `defineCommand()`, `.command()`, and `.as()` now reject command names that contain whitespace or start with `-`, the same rule aliases already follow: the router matches each name against one argv token and reads a leading `-` as a flag. Literal names fail typecheck (`FIX_NAME_SHAPE`); dynamic names throw a `DEFINITION` error (`reason: "invalid-name"`). The root name given to `new Crust()` is unaffected. `onError` hooks now see the routed command and `commandPath` when a subcommand's argv fails to parse (e.g. an unknown flag), instead of the root.

- [#539](https://github.com/chenxin-yan/crust/pull/539) [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Drop Deno support. Crust now targets Bun and Node.js only.
  
  - `@crustjs/crust`: `crust.runtime: "deno"` and Deno targets are removed; `deno.json`/`deno.jsonc` no longer selects a runtime. `--minify` now defaults to `true` in `--help`.
  - `create-crust`: `--runtime deno` is no longer accepted.
  - `@crustjs/utils`: `PACKAGED_BUILD_KEY` and `isPackagedBuild` are removed from `@crustjs/utils/artifacts`, and Deno compiled executables are no longer detected.
  - `@crustjs/core`: the snapshot protocol no longer checks the packaged-build marker.
  - `@crustjs/mcp`: Deno standalone builds are no longer detected as compiled executables.

- [#540](https://github.com/chenxin-yan/crust/pull/540) [`643beb2`](https://github.com/chenxin-yan/crust/commit/643beb264f5b206177110dd947b258f47cc68073) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - On Bun on Linux, a CLI started with a signal ignored (SIGHUP under `nohup`, SIGINT for a background job in a script) now keeps ignoring it. Core's Ctrl-C handling, timed `runProcess()` calls, and `crust build`'s snapshot step no longer listen for an ignored signal; listening replaced the ignore, and Bun restores the default action when the listener is removed, so the process could die from a signal it was started to ignore. Node already resets inherited ignores at startup, so nothing changes there. macOS on Bun still loses the ignore until Bun keeps the previous disposition (oven-sh/bun#47574). Adds `isSignalIgnored()` from `@crustjs/utils/signals`.

- [#552](https://github.com/chenxin-yan/crust/pull/552) [`aad9c15`](https://github.com/chenxin-yan/crust/commit/aad9c156dd89b3283e73cb420aac724d2f3598eb) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - An Extension with a `sections` callback, such as `skill()`, no longer makes every invocation build the whole command tree. The callback still runs when the application prepares, but its snapshot builds only the commands it reads, so `skill()` CLIs route lazily like any other app (about 15 ms faster per run on a 200-command CLI). As in apps without such a callback, a broken recipe in one command no longer fails unrelated runs; it surfaces when that command is used or when `app.snapshot()`, help, or `crust build` reads it.

- [#558](https://github.com/chenxin-yan/crust/pull/558) [`708e181`](https://github.com/chenxin-yan/crust/commit/708e181f0de97b81b77d64261f754e2649af1761) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Start faster on Node. Core, Extensions, and utils load Node built-ins with `process.getBuiltinModule()` where they are used instead of static `node:*` imports, which made Node evaluate every lazy export of `node:fs` and `node:util` at startup. `node:stream`, which is expensive to load on Bun, now loads only for `run()` and for `execute()` with injected `io`.

- [#536](https://github.com/chenxin-yan/crust/pull/536) [`4e2c3d7`](https://github.com/chenxin-yan/crust/commit/4e2c3d73577561d447e0ef58f7fc521b8a6fa3fa) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `ctx.rootCommand` and `ctx.command` now project each child when it is first read. Reading root metadata, such as `updateNotifier()` resolving `rootCommand.meta.version`, no longer builds every command, while walking `subCommands` still sees all of them. Snapshots are reused across invocations when the entire command tree is already built and has no mutable defaults at the invocation's first snapshot read. Otherwise snapshots stay invocation-local, preserving their identity even if another invocation makes the tree reusable.

- [#541](https://github.com/chenxin-yan/crust/pull/541) [`0cf0914`](https://github.com/chenxin-yan/crust/commit/0cf091408ad9e1251b6e8f42712b20299e591309) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - A `SIGINT` that arrives within 50 ms of the first is now treated as the same Ctrl-C. `npm run`, `npx`, `bun run`, and pnpm 10 relay the terminal's `SIGINT` to their child as well (npm/cli#8164), so a single Ctrl-C could arrive twice and force-quit the CLI before its cleanup ran. A second deliberate Ctrl-C still force-quits.

- [#512](https://github.com/chenxin-yan/crust/pull/512) [`71cd6dd`](https://github.com/chenxin-yan/crust/commit/71cd6dd8b0e5af788e11ccd68616b3c7b1c693ba) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Speed up dispatch, help, and command registration. `run()` and `execute()` reuse one root Command Snapshot per prepared app instead of rebuilding it each time, so `command`/`rootCommand` keep the same identity across invocations; apps with `URL` or mutable JSON-array defaults still get a fresh snapshot each time, so later changes to a default stay visible. Snapshot objects keep fast property access, and `.add(...definitions)` checks name collisions in linear time; snapshot contents and collision errors are unchanged.

- [#522](https://github.com/chenxin-yan/crust/pull/522) [`d64f307`](https://github.com/chenxin-yan/crust/commit/d64f30727fd3d28dcb26b7edeb6aed929a3efe19) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - A Standard Schema without the optional `types` member now infers its output from the successful `validate()` result (awaited) instead of `unknown` in store fields, env variables, and schema-backed flags and arguments; declared `types.output` still wins. `defineEnv()` now rejects a literal default outside literal `choices` and an async `parse` at compile time, as `defineFlag()` does. A store schema whose output is not JSON data now fails with a `FIX_JSON_OUTPUT` message instead of "not assignable to type 'never'". `@crustjs/effect` exports the `HandlerInput` type that `service()` requires, and `@crustjs/core/tooling` exports `LocalValueBrand`.
- Updated dependencies [[`6fdb8a6`](https://github.com/chenxin-yan/crust/commit/6fdb8a642b79a176d60d9a3d4be3431493201052), [`a074f45`](https://github.com/chenxin-yan/crust/commit/a074f454a28611f0a0a1f3d0bab8df50b235960d), [`516bb0a`](https://github.com/chenxin-yan/crust/commit/516bb0a6bff1aa10c31080b799ef76c54ec12331), [`ce12aed`](https://github.com/chenxin-yan/crust/commit/ce12aed7a34275c49b54340d1995378afedfa2a6), [`643beb2`](https://github.com/chenxin-yan/crust/commit/643beb264f5b206177110dd947b258f47cc68073), [`708e181`](https://github.com/chenxin-yan/crust/commit/708e181f0de97b81b77d64261f754e2649af1761), [`4a4386d`](https://github.com/chenxin-yan/crust/commit/4a4386d64fdef5440e77cebd8b9ac85e7a1d7350), [`4208178`](https://github.com/chenxin-yan/crust/commit/420817832f065c875e836b86deac832f84d86828), [`d64f307`](https://github.com/chenxin-yan/crust/commit/d64f30727fd3d28dcb26b7edeb6aed929a3efe19), [`e802ec7`](https://github.com/chenxin-yan/crust/commit/e802ec7c09c6635d77716e3c1c545faa99fe7759), [`7811b12`](https://github.com/chenxin-yan/crust/commit/7811b12f73827e1d47a1574c4b88736eb82632b0), [`3a6dbb1`](https://github.com/chenxin-yan/crust/commit/3a6dbb1702cff684c17054cd476ddef0b5d56f99), [`a411ccb`](https://github.com/chenxin-yan/crust/commit/a411ccb1b09eb05dd372757549631f429587981f), [`0cdd29f`](https://github.com/chenxin-yan/crust/commit/0cdd29fb72ff71e67348f5d7e8cae75753cfaed5)]:
  - @crustjs/utils@0.3.0

## 0.5.6

No changes in this release.

## 0.5.5

No changes in this release.

## 0.5.4

### Patch Changes

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Invalid command aliases now throw a `DEFINITION` error with `details` (`reason: "invalid-alias"`), like every other definition error.

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `defineCommand(name, config)` called from JavaScript without a recipe now throws a `DEFINITION` error (`reason: "missing-recipe"`) instead of a later `TypeError` from `.add()`.

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - URL, path, and JSON parse errors now name the flag or argument that failed (e.g. `Invalid URL for --base: "x"`, `Path for <dir> cannot be empty`) and keep the original error as `cause`. A `~` path is now expanded correctly when the home directory contains `$`.

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Dynamic flag and argument definitions with a default outside `choices`, or a multi-character `short`, now throw `DEFINITION` errors that name the definition and carry `details` (`reason: "default-outside-choices"` or `"invalid-short"`).

- [#483](https://github.com/chenxin-yan/crust/pull/483) [`e7db3a0`](https://github.com/chenxin-yan/crust/commit/e7db3a0dec77bd5bff375275daa3c83e5a350444) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Unknown-flag `PARSE` errors from argv now carry `details: { flag, reason: "unknown-flag" }`, matching structured `run()` input.

- [#484](https://github.com/chenxin-yan/crust/pull/484) [`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `isInstalledCommandName()` and `INSTALLED_COMMAND_NAME_RULE` to `@crustjs/core/tooling`: the one rule for installed command names (letters, digits, `.`, `_`, and `-`, starting with a letter or digit) shared by `crust build`, `create-crust`, and `completion()`.

- [#484](https://github.com/chenxin-yan/crust/pull/484) [`1f7b266`](https://github.com/chenxin-yan/crust/commit/1f7b26648e412d0c6170c2866fb6ec97aa907f14) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `DocumentationFlag.spellings` now lists the single-dash form of one-character names and aliases, which the parser already accepts. `{ name: "port", short: "p", aliases: ["P", "listen"] }` documents `-p, -P, --port, --P, --listen`, so help, man pages, and skills show `-P` too.

## 0.5.3

### Patch Changes

- Updated dependencies [[`eca2876`](https://github.com/chenxin-yan/crust/commit/eca287680727e32da4b2770782342969398f7f09)]:
  - @crustjs/utils@0.2.2

## 0.5.2

### Patch Changes

- [#476](https://github.com/chenxin-yan/crust/pull/476) [`4a0fce5`](https://github.com/chenxin-yan/crust/commit/4a0fce520c5c6e528d2137c533d75fd779cd2b58) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Rename `ctx.finish()` to `ctx.handled()` in Extension `preRun` hooks. The returned token type `Finished` is now `Handled`, and the matching `RunOutcome` and `postRun` status `"finished"` is now `"handled"`. Update hooks to `return ctx.handled()` and outcome checks to `outcome.status === "handled"`.

## 0.5.1

### Patch Changes

- [#473](https://github.com/chenxin-yan/crust/pull/473) [`7ec6ded`](https://github.com/chenxin-yan/crust/commit/7ec6ded6f433081034ad49dc67017cb65608fffc) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Reject unknown argument, flag, and top-level keys in `app.run()` and `handle.run()` inputs held in variables, not only in object literals. Keys set to `undefined` are still accepted. `RunInput` also omits the `args` or `flags` section when a command defines none, so editors stop suggesting it; a command without flags no longer accepts arbitrary `flags`.

- [#470](https://github.com/chenxin-yan/crust/pull/470) [`ea04984`](https://github.com/chenxin-yan/crust/commit/ea0498441ba9599c7c1dbf1cf1f3128f71f126d2) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Restore editor autocompletion of command names in `app.run(path)` and `app.at(path)`. Invalid paths are still rejected at compile time.

- [#472](https://github.com/chenxin-yan/crust/pull/472) [`a7e083a`](https://github.com/chenxin-yan/crust/commit/a7e083a6794335ea0723c085ff405fa6f96a5fd1) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Allow `.command()` inside `defineCommand` recipes, so subcommands can nest inline. The inline recipe sees the Contexts its parent declared with `.use()` or `.provide()` before the call.

- [#469](https://github.com/chenxin-yan/crust/pull/469) [`1984299`](https://github.com/chenxin-yan/crust/commit/1984299962d29641ed1b9741f1ed252a1b3f8e1b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Raise the minimum supported Node.js version to 24. Remove the Node 22 disposal-stack fallback and use native AsyncDisposableStack on all supported runtimes. Update generated Node projects to require Node 24 and use @types/node 24.
- Updated dependencies [[`1984299`](https://github.com/chenxin-yan/crust/commit/1984299962d29641ed1b9741f1ed252a1b3f8e1b)]:
  - @crustjs/utils@0.2.1

## 0.5.0

### Minor Changes

- [#455](https://github.com/chenxin-yan/crust/pull/455) [`bc3cbb2`](https://github.com/chenxin-yan/crust/commit/bc3cbb250974fcdba4ce2f50ee4b6b90a1f16c30) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Breaking: replace config-based Context definitions with immutable fluent authoring: defineContext(name).use(...factories).flags(...defs).setup((input, options) => value). The terminal .setup() returns the same callable ContextFactory with .of(value). Factory options move out of the setup input into setup's optional second parameter, so annotating only `options: T` keeps ctx, flags, and the value inferred; optional or defaulted options can be omitted when calling the factory. Remove the defineContext(name, setup) and defineContext(name, config, setup) forms and ContextConfig; ContextSetup drops its Options type parameter (now ContextSetup<Flags, Deps>), and ContextBuilder is exported.

- [#450](https://github.com/chenxin-yan/crust/pull/450) [`c4f44d6`](https://github.com/chenxin-yan/crust/commit/c4f44d6f9e3dd206154d0b18a84fb75464dc2dfe) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Breaking: replace object-based extension definitions with immutable fluent authoring: defineExtension<MetaKeys>(id).use(...).provide(...).flags(...).add(...), followed by lifecycle methods. Configure extensions with .factory((extension, ...args) => extension...), preserving .id. Rename Context dependency configuration from uses to use. Remove the old object, factory-callback and curried defineExtension forms, ExtensionConfig, DefineExtensionWith, and exposed extension data fields; use ExtensionBuilder for authoring and Extension for registration.

- [#454](https://github.com/chenxin-yan/crust/pull/454) [`0b835c2`](https://github.com/chenxin-yan/crust/commit/0b835c20b9bcf09e9dea7f179eeecd43a9c50763) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add typed environment Contexts with redacted validation errors and command-scoped help/man sections. Reuse the core flag value pipeline and preserve ENV errors in the Effect adapter.

- [#457](https://github.com/chenxin-yan/crust/pull/457) [`4977f33`](https://github.com/chenxin-yan/crust/commit/4977f33e87a928d968202af40f9729e390b7df93) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add experimental Deno runtime packages. With `"crust": { "runtime": "deno", "artifact": "package" }` (or `--artifact package`), `crust build` bundles each command with native `deno bundle`, which Deno marks experimental, into a root-only npm package whose `bin/<command>.js` files run on the consumer's installed Deno through `deno run npm:<package>/<command>` or `deno install -g`. The package embeds no runtime, carries no shebang or permission flags, and leaves every grant to the consumer. Building needs `deno` 2.5.0 or newer on PATH, checked in the project directory before `.crust/` is replaced; the bundler version is printed as `Compiler:` but not recorded as `embeddedRuntimeVersion`, and `engines.deno` stays a consumer requirement. `--minify`, `--env-file`, `crust.bunPlugins`, `--target`, and `crust.targets` are rejected for this mode. Deno binaries and their permissions are unchanged.
  
  Finished Deno packages mark themselves through a marker prepended to the bundle, preserving `import.meta.main` for the declared command, so `@crustjs/core` skips Command Snapshot and build-hook execution and `resolveArtifactDir()` from `@crustjs/utils/artifacts` resolves assets beside the installed package, without reading any environment variable. The package must be built against this `@crustjs/core` release or newer: with an older core, the finished package needs `--allow-env` and obeys build-only snapshot variables.

### Patch Changes

- [#452](https://github.com/chenxin-yan/crust/pull/452) [`eb9928d`](https://github.com/chenxin-yan/crust/commit/eb9928d60edc3033652ad55a3a019e790dafdf06) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Omitted variadic arguments now resolve their declared `default` as a one-element array (`[default]`) for both `execute()` and `run()`; supplied values still replace it.
- Updated dependencies [[`0da2c5c`](https://github.com/chenxin-yan/crust/commit/0da2c5ce54f71acc5d51fad1dcb2c5546a71948e), [`4360cb1`](https://github.com/chenxin-yan/crust/commit/4360cb1cefca245e76967ade43c82b5361c039e5), [`4977f33`](https://github.com/chenxin-yan/crust/commit/4977f33e87a928d968202af40f9729e390b7df93), [`4977f33`](https://github.com/chenxin-yan/crust/commit/4977f33e87a928d968202af40f9729e390b7df93)]:
  - @crustjs/utils@0.2.0

## 0.4.1

No changes in this release.

## 0.4.0

### Minor Changes

- [#438](https://github.com/chenxin-yan/crust/pull/438) [`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Replace string environment fallbacks with explicit `env: { name, delimiter? }` bindings. Keep flag-level `delimiter` argv-only, with independently configured environment splitting and immutable binding snapshots.

- [#438](https://github.com/chenxin-yan/crust/pull/438) [`0e1799b`](https://github.com/chenxin-yan/crust/commit/0e1799bb99cfcc73fa24bf288068600fc01dc7bb) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `env: { name, delimiter? }` and `delimiter` to `FlagDef`. A flag with `env` reads the named environment variable when absent from argv (argv > env > `default`); the value goes through the same coercion, `choices`, `parse`, and schema path as an argv token and satisfies `required`. Flag-level `delimiter` splits string argv occurrences; `env.delimiter` independently splits environment text. Both require repeatable flags and drop empty segments, with no implicit separator inheritance. `FlagSnapshot`/`DocumentationFlag` carry the immutable environment binding and argv delimiter; help and generated man pages render `[env: NAME]` after the description and never the value. `formatDescription` accepts an optional trailing `env` argument. Structured `run()` input does not read the environment and is never split.

## 0.3.6

No changes in this release.

## 0.3.5

No changes in this release.

## 0.3.4

### Patch Changes

- [#425](https://github.com/chenxin-yan/crust/pull/425) [`26baf42`](https://github.com/chenxin-yan/crust/commit/26baf426534a2df0493a3be29c34f1574810fea1) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Context cleanup no longer constructs new Contexts. Once every setup started during the invocation has settled, pulling a Context that was never built (from a `defer` callback or a fire-and-forget chain left by `postRun`) rejects with a `DEFINITION` `CrustError` whose `details.reason` is `context-during-disposal`, instead of opening a resource on the already-disposing stack and surfacing a raw `ReferenceError` while the value leaks. Promises for Contexts already built keep resolving during cleanup; whether the value is still live depends on `defer` registration order. The Node 22 disposal-stack fallback is now idempotent: disposing it twice runs each cleanup once, matching the native `AsyncDisposableStack`.
  
  `.execute()` no longer drops a cleanup failure that follows a rendered action or `preRun` failure: the disposal side of the escaping `SuppressedError` is written to `stderr` as `Cleanup failed: message` lines without calling `onError` again, and a cancelled action whose cleanup fails exits `1` as before. Core's default renderer lists the members of a `SuppressedError` chain or a genuine `AggregateError` (including the Node 22 fallback's aggregate) instead of printing a bare `Error: ` for their blank or boilerplate messages, bounded to 256 values with a final `[additional failures omitted]` line, and it terminates on self-referential or throwing-getter values. `run()` outcomes are unchanged.

- [#423](https://github.com/chenxin-yan/crust/pull/423) [`9d19b33`](https://github.com/chenxin-yan/crust/commit/9d19b33a077247f47689b64e1babe1527638b9ed) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Default invocation IO writes through `process.stdout`/`process.stderr` instead of `console.log`/`console.error`. Under Bun, once anything materializes `process.stdout` (a platform layer, a color library probing `isTTY`), the native console writer silently drops piped output past 64 KiB at exit ([oven-sh/bun#36419](https://github.com/oven-sh/bun/issues/36419)); the stream writer flushes it. Rendered text is unchanged.

- [#424](https://github.com/chenxin-yan/crust/pull/424) [`52e0938`](https://github.com/chenxin-yan/crust/commit/52e0938ceee270340c366afb59f756d455d1623a) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add an invocation-scoped cancellation signal. Every Context setup, Command Action, Extension hook context, and `onError` fallback context now carries `signal: AbortSignal`. `execute()` accepts a caller-owned `signal` and handles Ctrl-C automatically: the first Ctrl-C aborts `ctx.signal` with an `AbortError`, allowing cooperative work to stop and cleanup to run; a second terminates unless another listener owns the signal. This changes the previous immediate-termination behavior: work that ignores the signal requires a second Ctrl-C to force-quit. The listener stays registered until the invocation settles so one-shot handlers such as the `@crustjs/progress` spinner defer to Core. A caller signal keeps its own abort reason. When work throws that reason, an `AbortError` exits 130 and other errors render and exit 1. Effect signal interruption instead becomes an `AbortError` regardless of the caller's reason. `run()` and `handle.run()` take `InvocationOptions` (`stdout`/`stderr` sinks plus `signal`) as their last argument. New exported types: `InvocationOptions`, `ExecuteOptions`.

- [#416](https://github.com/chenxin-yan/crust/pull/416) [`5183e78`](https://github.com/chenxin-yan/crust/commit/5183e78b60f263b4da820d3214863ef715d3dca4) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Builder clones now share their immutable flag-spelling entries instead of re-creating each one, reducing allocations when chaining builder methods, extending with Extensions, and preparing an invocation. Parsing behavior is unchanged.

- [#417](https://github.com/chenxin-yan/crust/pull/417) [`2835c5b`](https://github.com/chenxin-yan/crust/commit/2835c5b1d2df03585c58c579d50e0ef6298138a0) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Builder methods (`.flags()`, `.args()`, `.use()`, `.provide()`, `.action()`, `.extend()`, `.add()`, `.command()`) now copy only the command-node containers they change and share the rest with the source builder, so building a CLI allocates less. Builders stay immutable: the source builder is never affected by derived ones.

- [#418](https://github.com/chenxin-yan/crust/pull/418) [`cac21ad`](https://github.com/chenxin-yan/crust/commit/cac21ad6c9a57423aabf048cd3bf25223d52a1ae) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Flag parsing no longer allocates and discards a `util.parseArgs` option descriptor for every short flag spelling; the accepted spellings and parsed values are unchanged.

- [#415](https://github.com/chenxin-yan/crust/pull/415) [`b02c2af`](https://github.com/chenxin-yan/crust/commit/b02c2af97addd3e7064dff2155d6bf3b2a27c6cd) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Preparing a command tree no longer builds an intermediate snapshot when no registered Extension defines `sections`, making fresh invocations and `Crust.snapshot()` cheaper for apps without section callbacks. Section callbacks, help output and snapshots are unchanged.

- [#421](https://github.com/chenxin-yan/crust/pull/421) [`05603c9`](https://github.com/chenxin-yan/crust/commit/05603c9049edc0f0c7f74e6e22b8a69ecfe02dd6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Invocations no longer project the resolved command's snapshot a second time; `ctx.command` is now the very subtree object found inside `ctx.rootCommand` (previously a structurally equal but distinct copy), and equals `ctx.rootCommand` for the root command.

## 0.3.3

### Patch Changes

- [#413](https://github.com/chenxin-yan/crust/pull/413) [`63ef15c`](https://github.com/chenxin-yan/crust/commit/63ef15c2a009c87cc568d1eab2d1011332417057) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Finished Bun and Node CLI bundles (built by `crust build`) no longer include the `CRUST_INTERNAL_SNAPSHOT_PATH` snapshot/build-hook protocol: the bundle is smaller and dispatches normally even when that variable is set. Source entries run by `crust build` and Deno binaries are unchanged.

## 0.3.2

### Patch Changes

- [#411](https://github.com/chenxin-yan/crust/pull/411) [`2cbdc21`](https://github.com/chenxin-yan/crust/commit/2cbdc2122f7bffbad42b79185bf0e4d8d97021a7) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Depend on the published `@crustjs/utils` package instead of inlining its sources into the bundle.
- Updated dependencies [[`2cbdc21`](https://github.com/chenxin-yan/crust/commit/2cbdc2122f7bffbad42b79185bf0e4d8d97021a7)]:
  - @crustjs/utils@0.1.0

## 0.3.1

No changes in this release.

## 0.3.0

### Minor Changes

- [#386](https://github.com/chenxin-yan/crust/pull/386) [`955f85c`](https://github.com/chenxin-yan/crust/commit/955f85c130400c7c8d0e63efa9b16807482dba3e) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - ### @crustjs/crust
  
  `crust build` now stages publishable npm packages in `.crust/`, replacing that tree on each staged build. Node produces a root-only package with a self-contained `bin/<command>.js` bundle; Bun and Deno produce a root launcher plus platform packages. Deno's Linux targets are glibc-only. The staged CLI runs locally, and `crust publish` publishes the same tree using `.crust/manifest.json`.
  
  `crust build` keeps four flags: `--target` (repeatable; canonical names or `host` for this machine, deduplicated), `--env-file`, `--validate/--no-validate`, and `--minify/--no-minify`. Removed `--package`, `--stage-dir` (build and publish), `--outdir`, `--name`, `--resolver`, `--outfile`, `--runtime`, `--entry`, `--bun-plugin`, and the raw `dist/` multi-binary layout with `cli`/`cli.cmd` shell resolvers. For a single binary on Bun or Deno, run `crust build --target host` and take `.crust/<platform>/bin/<command>-<target>`; Node accepts no `--target` and always produces `.crust/root/bin/<command>.js`. `.crust/manifest.json` is the index.
  
  Build configuration lives in one `package.json` block; unknown keys under `crust` are an error:
  
  ```json
  {
    "bin": { "my-cli": "src/cli.ts" },
    "crust": {
      "runtime": "bun",
      "bunPlugins": ["@opentui/solid/bun-plugin"],
      "include": ["templates"]
    }
  }
  ```
  
  Runtime selection follows `crust.runtime`, then inference: `deno.json`/`deno.jsonc` selects Deno; `@types/node` without `@types/bun` selects Node; otherwise Bun. Builds report the selected runtime and its source. `crust.bunPlugins` lists Bun bundler plugin modules: bare names resolve from `node_modules`, paths from the project root, each default-exporting the plugin; Deno rejects it. `crust.include` copies asset directories alongside Extension artifacts into the root package and each platform package's `bin/`. Every bundle defines `process.env.CRUST_INTERNAL_BUILD` as `"1"`; the name is reserved and reads of it are replaced at build time.
  
  `@crustjs/crust` ships a JSON schema for the `crust` block at `node_modules/@crustjs/crust/schema/package.json` (extending SchemaStore's package.json schema) for editor completion; point `"$schema"` at it in `package.json`.
  
  `crust publish` keeps `--tag`, `--dry-run`, and `--registry`; removed `--access` and `--verify`. Staged metadata is always verified. npm reads `publishConfig.access` from each staged `package.json`, so scoped public packages need `publishConfig.access: "public"` in `package.json` (copied into every staged package). `npm publish` runs inside each `.crust/<package>` directory, so a project-level `.npmrc` is not read; use trusted publishing, `NPM_CONFIG_USERCONFIG`, or `~/.npmrc`.
  
  ### create-crust
  
  Replaced the distribution-mode prompt and `--distribution` with a runtime prompt and `--runtime bun|node|deno`. All templates explicitly set `crust.runtime`, point `bin` at `src/cli.ts` (which starts with the runtime's shebang: `#!/usr/bin/env bun`, `#!/usr/bin/env node`, or `#!/usr/bin/env -S deno run -A`, so `npm link` runs the source), and use `build` (`crust build`), `release` (`crust publish`), and `start` (the staged `.crust/root/bin/<name>.js` entry). Removed the old `package`, `publish`, and `prepack` scripts and `files` field; `.crust` is gitignored.
  
  Templates use runtime-specific TypeScript settings, JSON import attributes, and script-runner instructions. `@crustjs/core` and `@crustjs/extensions` are dependencies; `@crustjs/crust` is a development dependency.
  
  Generated `package.json` files start with `"$schema": "./node_modules/@crustjs/crust/schema/package.json"` so editors complete and validate the `crust` block.
  
  `create-crust` itself now ships as a Crust-built Node bundle, with templates staged through `crust.include` and located through `resolveArtifactDir("templates")`.
  
  ### @crustjs/core
  
  Added `resolveArtifactDir(name)` for top-level artifact directories: beside the executable in compiled Bun/Deno binaries, beside `bin/` in Crust-built Node bundles, under the entry's isolated hook output directory while `crust build` prepares the Command Snapshot (so sections evaluated during the build see what earlier Extension build hooks wrote), or under `.crust/root/` at the real entrypoint's nearest package root when running from source. It computes the path without checking whether the artifact directory exists.
  
  ### @crustjs/skills
  
  Removed `SkillOptions.distDir` and the previous skill-source fallback logic. Packaged skills now come from `resolveArtifactDir("skills")`; remove `distDir` from your configuration and run `crust build`. Missing or empty packaged skills produce a build-first diagnostic, rendered as a note in help rather than failing help.

- [#393](https://github.com/chenxin-yan/crust/pull/393) [`19c99e7`](https://github.com/chenxin-yan/crust/commit/19c99e77ffcff792527064354b2c5b9d756c51df) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - ### @crustjs/core
  
  **Breaking:** Extension build hooks return their files instead of writing them. `build(ctx)` now returns `BuildArtifacts = readonly BuildFile[]`, where `BuildFile` is `{ path, content }` with `path` relative to the build output directory and `content` a `string` or `Uint8Array`. Returning `void` is no longer allowed. Core validates every path, rejects a path that collides with one already produced in this or an earlier hook (equal paths compared case-insensitively, or a path nested under or above an existing file; the error names both spellings and the owning Extension), writes the files into the output directory, and records exactly the written paths; `BuildReport.extensions[].files` is always `readonly string[]` (the `"unknown"` marker is gone). `ExtensionBuildContext` no longer exposes `outDir`: hooks have no handle to write beside their returned files, which is what makes the report exact. A hook that drives an external tool should write to its own temporary directory and read the results back.
  
  Migration: replace `mkdir`/`writeFile` calls in a hook with returned entries, and drop `outDir` from the destructured context.
  
  ```ts
  // before
  async build({ snapshot, outDir }) {
    await mkdir(join(outDir, "acme"), { recursive: true });
    await writeFile(join(outDir, "acme", "manifest.json"), JSON.stringify(snapshot));
    return ["acme/manifest.json"];
  }
  // after
  build({ snapshot }) {
    return [{ path: "acme/manifest.json", content: JSON.stringify(snapshot) }];
  }
  ```
  
  ### @crustjs/crust
  
  `crust build` records each `bin` entry's Build Report under `build` in `.crust/manifest.json` (`build.<command>.extensions[].files`), so the manifest lists exactly which files every Extension produced. The field is absent under `--no-validate`, which skips the hooks. The build summary no longer prints `ran (artifacts not reported)`. Since hooks cannot produce symlinks anymore, multi-entry artifact merging no longer copies symlinks.
  
  ### @crustjs/man
  
  The `man()` build hook returns the rendered page instead of writing it. `writeManPage()` is unchanged as a standalone render-and-write helper.
  
  ### @crustjs/skills
  
  The `skill()` build hook returns rendered skill files instead of writing them. `writeSkills()` and `writeSkillsFromSnapshot()` are unchanged: they still replace the dedicated `skills` output directory.
  
  ### @crustjs/extensions
  
  The `completion()` build hook returns the three shell scripts instead of writing them. The runtime `completion <shell> --output-dir` command still writes all three files.

- [#376](https://github.com/chenxin-yan/crust/pull/376) [`9961a9b`](https://github.com/chenxin-yan/crust/commit/9961a9ba254ba1b58746ea0c6e8b43c76a9268e3) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `app.at(path)`, which returns a typed `CommandHandle` bound to one command. `handle.run(input?, io?)` accepts the same structured input and IO as `app.run(path, ...)` with the path already applied, so a subcommand can be re-exported as a typed library function or handed to other commands and test helpers. Unknown paths throw `COMMAND_NOT_FOUND` eagerly from `at()`.

### Patch Changes

- [#377](https://github.com/chenxin-yan/crust/pull/377) [`c15d855`](https://github.com/chenxin-yan/crust/commit/c15d855b43d55605a310719c63f50d89c23a416d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Adapter hook: expose bag sources and instance factory. Context bags carry their sources under the non-enumerable `contextSources` symbol, and Context instances expose their defining `factory`.

- [#390](https://github.com/chenxin-yan/crust/pull/390) [`e450975`](https://github.com/chenxin-yan/crust/commit/e450975f70d9dffda5fe068b55d56c48eb17ab44) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Resolve source-linked command artifacts from the real entrypoint package instead of the consumer package. Preserve existing compiled and bundled artifact lookup.

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Improve positional type capacity with accumulator duplicate-name scanning. Fifty and one hundred chained arguments now support action inference and typed run inputs while preserving duplicate and union semantics; this is not a compiler-speed claim.

- [#392](https://github.com/chenxin-yan/crust/pull/392) [`33cd937`](https://github.com/chenxin-yan/crust/commit/33cd93792366803f2b33fac16fc4ab99057f9b0b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Reject statically known invalid members of a name union even when another member is an open template, such as `` "" | `mode-${string}` `` or `` "__proto__" | `mode-${string}` ``. Applies to command names, command aliases, `.as()` renames, argument names, and flag names, short flags, and aliases. Open members remain runtime-checked and still keep attachment records open. `.add(cond ? a : b)` no longer rejects a definition union whose variants alias each other's canonical name (`a` named `x` with alias `y`, `b` named `y` with alias `x`); each variant is compared with its own aliases only.

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Preserve action-local Context value obligations after binding. Incompatible inherited shadowing is still allowed before an action; compatible replacements and independent descendant shadowing remain valid. Previously accepted replacements that invalidate a stored action now fail typechecking.

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fix prototype-named flag and positional binding, and await foreign-realm Standard Schema validation without changing synchronous custom-parser payloads.

- [#396](https://github.com/chenxin-yan/crust/pull/396) [`015bcdb`](https://github.com/chenxin-yan/crust/commit/015bcdb1e9ca9285d3029794c573bb3f3ea3aa73) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Tighten Extension hook flag inference: uncertain scopes may omit defaults, uncertain collections expose raw values, and optional schema multiplicity includes arrays. Previously unsafe scalar assumptions now require narrowing.

- [#376](https://github.com/chenxin-yan/crust/pull/376) [`9961a9b`](https://github.com/chenxin-yan/crust/commit/9961a9ba254ba1b58746ea0c6e8b43c76a9268e3) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Fix typed `run()` paths through siblings registered by one variadic `.add(a, b)` call: each path now narrows to its own command's input and result instead of the union of every sibling's shape.

- [#375](https://github.com/chenxin-yan/crust/pull/375) [`1a919d7`](https://github.com/chenxin-yan/crust/commit/1a919d773f592cab65afd8d8f437c7947016523d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Prevent variadic calls on conditional builder unions from silently losing input validation and inferred value types. `.provide()`, `.use()`, and `.add()` reject failed input inference, while allowing explicit input tuples that pass validation. `.flags()`, `.args()`, and `.extend()` reject incompatible union signatures.
  
  Use lightweight input defaults for Context and command registrations to avoid repeated whole-builder type instantiations on large command trees. Unconditional chains, identical-branch unions, and non-variadic methods are unchanged; no runtime change.

## 0.2.1

### Patch Changes

- [#371](https://github.com/chenxin-yan/crust/pull/371) [`d103a76`](https://github.com/chenxin-yan/crust/commit/d103a7688dd3240c913596e46f6100b772ded80d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Raise the supported Bun floor to 1.4.0.
  
  Every package now declares `engines.bun` as `>=1.4.0`, and Bun 1.3 is no longer tested. Bun 1.4 ships a single x64 binary, which is what lets `crust build` use the canonical `bun-linux-x64` and `bun-windows-x64` target names.

## 0.2.0

### Minor Changes

- [#360](https://github.com/chenxin-yan/crust/pull/360) [`0b0aeca`](https://github.com/chenxin-yan/crust/commit/0b0aecaed104b6ee548ae01f589c71c44a2eb9bc) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Attribute files returned by Extension build hooks to their Extension ids, transport the Build Report to `crust build`, and print a concise per-hook artifact summary before compilation.

- [#361](https://github.com/chenxin-yan/crust/pull/361) [`38e7298`](https://github.com/chenxin-yan/crust/commit/38e7298954c60ec0a45dcfa830b515b2bc32ece0) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Replace the separate command recipe builder interface with a capability-typed `Crust`, keeping root-only operations uncallable in recipes across fluent chains.

- [#366](https://github.com/chenxin-yan/crust/pull/366) [`59b8ec6`](https://github.com/chenxin-yan/crust/commit/59b8ec6ae3eae3da450d3297e375fee057296379) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add `defer(cleanup)` to Context setup. Cleanup registered with `defer` runs after post-run hooks in reverse registration order, including when the action or a later step of the same setup throws, so a value no longer needs a `[Symbol.dispose]` method to release what setup opened. Returned disposable values are still disposed automatically. Calling `defer` after setup has settled throws a `DEFINITION` error.
  
  ```ts
  // before
  defineContext("database", () => {
    const db = open();
    return { ...db, [Symbol.dispose]: () => db.close() };
  });
  
  // after
  defineContext("database", ({ defer }) => {
    const db = open();
    defer(() => db.close());
    return db;
  });
  ```

- [`cc466b5`](https://github.com/chenxin-yan/crust/commit/cc466b5a0b5792d4811e85d82e341980bc1fb606) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Breaking API revamp: replace plugin-driven builders with reusable commands, Contexts, and Extensions.
  
  - **Definitions and composition:** `defineCommand(name, config, recipe)` creates an inert reusable command attached with `.add(...definitions)`; `.as(name)` reuses it under another name. Root-only `.command(name, recipe)` remains inline sugar, but `.command(builder)`, `.sub()`, and `.meta()` are removed. Root metadata moves to `new Crust(name, { description, version, usage, sections })`; `version` is rejected in reusable command configs. `defineFlag` and `defineArg` create named definitions: use accumulative `.flags(...defs)` and `.args(...defs)` instead of records and tuples. Every positional argument now requires a core `type` or Standard Schema `schema`.
  - **Extensions replace plugins:** attach `defineExtension(defineExtensionId("acme:feature"), config)` with `.extend(...extensions)` instead of `.use(plugin)`. `defineExtension(id, factory)` returns a callable `ExtensionFactory` with shared `.id`. Named `hooks` replace middleware and builder lifecycle handlers: `preRun(ctx)` can return `ctx.finish()`, `postRun(ctx, outcome)` runs in reverse Extension order after settlement, and `onError(error, ctx)` returns `true` after rendering an `execute()` failure. Extension flags are readonly arrays of named definitions; `recursive` defaults to `true`. Commands contributed by Extensions use `defineCommand()`.
  - **Contexts:** `defineContext(name, { flags?, uses? }, setup)` declares a lazy dependency. Applications supply `.provide(...instances)`, commands demand `.use(...factories)`, and Contexts/Extensions declare dependencies with `uses`. Actions access values through `ctx`; `.of(value)` supplies dependency-free test doubles. Contexts dispose through `Symbol.dispose`/`Symbol.asyncDispose` in reverse construction order. `FlagDef.inherit` is removed: use Context-owned flags or recursive Extension flags to reach subcommands.
  - **Actions and execution:** `.action(handler)` replaces `.run(handler)`; repeating `.action()` replaces the handler. Action contexts expose lazy `ctx`, `stdout`/`stderr`, and `command`/`rootCommand` snapshots. `.run(path, input?, io?)` invokes a command programmatically with quiet captured output and returned failed outcomes. `.execute({ argv?, io? })` renders failures, sets `process.exitCode`, and now resolves to the exit code (`0`, `1`, or `130`) rather than `void`. Cancellation uses `AbortError`, is offered to `onError`, and stays silent when unclaimed. Handled failures expose the rendering Extension's id in `InvocationOutcome.by`; fallback rendering leaves it undefined. `onError` settles before `postRun`, and Contexts remain available through both hooks.
  - **Typed invocation:** `run()` infers command paths, arguments, flags, and action results. It binds structured input directly, without producing argv; only own argument/flag properties count as supplied. JSON and URL values retain identity; JSON inputs accept named interfaces, readonly arrays, and tuples when recursively JSON-compatible at the type level. Extension hooks see the command path only in `argv`. `RunOutcome` always carries captured `stdout`/`stderr` and is `completed` with the typed `result`, `finished` with the finishing Extension's `by` identity, or `failed` with the original escaping `error`. Statically declared Extension commands/flags participate in inference; dynamic contributions remain runtime-only. Literal string `choices` narrow result types unless `parse` supplies its own output type.
  - **Validation and errors:** arg/flag definitions accept Standard Schema through `schema`, replacing `@crustjs/validate`. Compile-time `FIX_*` diagnostics reject invalid names, aliases, defaults, variadic placement, schema combinations, async parsers, section audiences, and dependency graphs; dynamic definitions fail with `DEFINITION` at composition. `CrustError` codes are `DEFINITION`, `PARSE`, `VALIDATION`, and `COMMAND_NOT_FOUND`; `CONFIG` and `EXECUTION` are removed, and action/Context failures pass through unwrapped. `DEFINITION` and `PARSE` gain structured details (`DefinitionErrorDetails`, `ParseErrorDetails`); `COMMAND_NOT_FOUND.details.parentCommand` becomes a `CommandSnapshot`. `toJSON()` and `CrustErrorJson` are added.
  
  **Parser and routing**
  
  - Undeclared positionals now fail with `VALIDATION` instead of being discarded. Declare a variadic argument for open-ended input, or read opaque `rawArgs` after `--`.
  - Boolean negation accepts every long alias (`--no-<alias>`); negating a `noNegate` flag through any spelling fails with `PARSE`.
  - Routing skips known flags and their values before subcommands, including aliases, inline values, and bundled short booleans. Recursive flags bind to the selected child (`app --help sub` shows child help). A flag before a subcommand that the child cannot accept fails with an explanatory `PARSE` error. Unknown flags and `--` still stop routing.
  - Missing or invalid flag values report Node's descriptive `PARSE` message naming the flag instead of `Failed to parse command arguments`.
  - Tokens such as `constructor` and `__proto__` report `COMMAND_NOT_FOUND` instead of crashing; `details.available` lists only visible sibling commands.
  
  **Snapshots, sections, and public types**
  
  - `await app.snapshot()` replaces `prepareCommandTree()` with a frozen `CommandSnapshot`. Commands and Extensions can contribute plain-text documentation sections. Sections reach every renderer by default; `only`/`except` select audiences using factories, `ExtensionId` values, or factory statics such as `help.id`. The `crust:` prefix is reserved by convention. `CommandSection`, `CommandSectionInput`, `SectionAudience`, `SectionConsumer`, and arg/flag snapshot types are exported; `FlagSnapshot.negatable` exposes parser policy.
  - New `@crustjs/core/tooling` exports `buildCommandDocumentation`, `formatDefault`, `formatDescription`, `isListed`, `sectionsFor`, `visibleSectionsFor`, documentation types, and the build protocol constants `SNAPSHOT_PATH_ENV`/`BUILD_OUT_DIR_ENV`. Extensions can declare `build(ctx)` with an `ExtensionBuildContext` containing the root snapshot and absolute output directory.
  - Removed root exports: `parseArgs`, `validateParsed`, `resolveCommand`, `CommandRoute`, `CommandNode`, `CrustPlugin`, `PluginMiddleware`, `SetupActions`, `SetupContext`, `MiddlewareContext`, `VALIDATION_MODE_ENV`, `VALIDATION_FORCE_EXIT_ENV`, `ValidateVariadicArgs`, `ValidateNoPrefixedFlags`, `ValidateFlagAliases`, `ValidateCrossCollisions`, `Resolve`, `ResolveBaseType`, `InferArgs`, `InferFlags`, `InheritableFlags`, and `EffectiveFlags`. Build integrations use the new snapshot protocol instead of `CRUST_INTERNAL_VALIDATE_*`.
  - Prefer inference over positional `Crust` generic annotations: the generic parameters have changed. Exported command, Context, Extension, and run-input/result types name the new contracts. `Crust._types` (`flags`, `args`, `ctx`, `tree`, `shape`) is a supported type-level seam with no runtime value.

- [#355](https://github.com/chenxin-yan/crust/pull/355) [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Make core `run()` quiet and captured by default. Every `RunOutcome` includes `stdout` and `stderr`; completed outcomes carry the typed action result, finished outcomes identify the Extension, and failed outcomes retain the original escaping error and partial output after cleanup. Invocation failures now resolve to `failed` instead of rejecting. Optional IO callbacks forward live output once while retaining capture. `execute()` remains the streaming terminal adapter with error presentation and exit codes.
  
  Remove `captureRun` and `CapturedRun` from `@crustjs/testing`: call `app.run(path, input)` directly. Keep `captureExecute` for terminal semantics. `runInteractive` explicitly propagates failed core outcomes through `done` and `waitFor`, including primitive thrown values.

- [#355](https://github.com/chenxin-yan/crust/pull/355) [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Default `ExtensionFactory` dependency, provider, flag, and command parameters to closed contribution sets. Published factories can now omit empty trailing type arguments; explicitly use the broad upper-bound type for namespaces that must remain open.

- [#354](https://github.com/chenxin-yan/crust/pull/354) [`cb0e9f1`](https://github.com/chenxin-yan/crust/commit/cb0e9f1f0538c0576505534d429566ed29bcb996) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add curried, extension-owned root metadata requirements with defineExtension<"version">()(id, configOrFactory). Required keys refine hook and artifact snapshots and are checked by strict TypeScript when installing extensions. version() now requires guaranteed root version metadata unless an explicit string or lazy provider is supplied; remove its runtime missing-version error. Keep ordinary defineExtension calls unchanged and put scaffold versions in root metadata. Root metadata now rejects statically known extra keys on pretyped objects as well as fresh literals; generic wrappers must also establish that their metadata contains only root keys.

- [#359](https://github.com/chenxin-yan/crust/pull/359) [`37a4ae1`](https://github.com/chenxin-yan/crust/commit/37a4ae15d7cc635406ad2f7643afaad6d7391e75) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Merge documentation sections with the same exact title after audience filtering, preserving their first position and joining bodies with a single newline.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Update runtime compatibility and package builds.
  
  - Libraries support Bun 1.3.14+, Node.js 22+, and Deno 2.8+ (`engines` updated). Context disposal includes a fallback for runtimes without `AsyncDisposableStack`, including Node 22/23. The `crust` build CLI remains Bun tooling; its npm distribution ships standalone executables with Bun embedded.
  - Published packages no longer depend on `@crustjs/utils`; its helpers are bundled. `@crustjs/store` also drops `@standard-schema/spec`. Library packages and `create-crust` are marked `sideEffects: false` for bundlers.
  - Packages shipping declarations declare an optional TypeScript `^7.0.0` peer; builder inference is supported on TypeScript 7. JavaScript consumers are unaffected by this compiler requirement.

- [#355](https://github.com/chenxin-yan/crust/pull/355) [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Automatically validate observable constraints at authoring, preparation, deferred definition consumption, and invocation. Dynamic names and collections use the same APIs; spread collections into variadic builder methods. Consume deferred Extension factory/section results when produced and verify declared Context availability without constructing Contexts.
  
  Keep known invocation contracts strict: literal choices, required fields, supplied positional prefixes, nonempty required variadics, value kinds, and command paths retain compile-time checking. Fresh object literals reject typo keys alongside valid required fields; standard structural assignability still permits extra keys on predeclared objects. Schemas and custom parsers retain raw input contracts independently of their action output types.
  
  A bare `Crust` has an empty argument tuple. Prefer inferred authoring builders; `AnyCrust` is a completed-app inspection/invocation view with broad input and an unknown action result, not authoring authority. Dynamic/open shapes retain independently known fields, and uncertain unions retain conservative obligations. Broad string names work without wrappers; known-invalid union members remain rejected.
  
  Own normalized structural definition arrays without cloning JSON, URL, schema, callback, or Context-option payloads. Preserve Context/Extension defining data through structural copies, lazy setup, once-per-invocation resolution, replacement ordering, preRun/finish ordering, and cleanup. Keep static duplicate checks that protect earlier typed consumers; supported dynamic replacements retain last-write-wins. Supplied removed flag keys fail binding, but omitting a retired defaulted flag can still leave an earlier action observing undefined.
  
  Preserve TypeScript-owned metadata, dependency, and callback-value demands, including conditional/nested providers used by descendant hooks. Recipe-local duplicate Context checks use actual local providers rather than inherited/demanded names, allowing compatible local provisioning while rejecting incompatible values and repeated local providers. Preserve precise static Extension contributions and migrate configurable Completion/Skills callers to ordinary composition.

### Patch Changes

- [#355](https://github.com/chenxin-yan/crust/pull/355) [`7d72b4c`](https://github.com/chenxin-yan/crust/commit/7d72b4cfd235517e941e9384516a80f8dfa74e95) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `.provide()` now rejects a broad-named provider whose value type does not satisfy a dependency declared by a later provider, including when a known literal provider sits beside an unknown broad provider (`FIX_DEPENDENCY_TYPE`). Previously these mismatches compiled and surfaced only as runtime `TypeError`s.

- [#353](https://github.com/chenxin-yan/crust/pull/353) [`72b462e`](https://github.com/chenxin-yan/crust/commit/72b462e110c421ce453b7a2f81ef0e284f908607) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Reduce redundant child-map copying during command registration, accumulating variadic additions in one private map while preserving eager materialization and immutable builders.

## 0.0.19

### Patch Changes

- Updated dependencies [e298f11]
  - @crustjs/utils@0.0.3

## 0.0.18

### Patch Changes

- 0dc69b1: Introduce `@crustjs/utils`, fold in `@crustjs/schema-utils`, dedupe `resolveSourceDir`, and switch validated helpers to explicit Standard Schema-backed validation.

  **`@crustjs/utils` (new, `0.0.1`)** — Pre-stable; public surface may change without notice until `0.1.0`. Pin to an exact version if depending externally.

  - `resolveSourceDir(input: string | URL): string` for three-mode source-directory resolution (`file:` URL via `fileURLToPath`, absolute path via `path.resolve`, or relative path resolved from the nearest `package.json` walking up from `process.argv[1]`).
  - `@crustjs/utils/schema` subpath exposes Standard Schema boundary assertions, issue normalization, and type aliases (`assertStandardSchema`, `isStandardSchema`, `formatPath`, `normalizeStandardIssues`, `normalizeStandardPath`, plus `StandardSchema` / `InferInput` / `InferOutput` / `ValidationIssue`). Internal-only — **not part of the public Crust API** and may change without a deprecation cycle. Use `@crustjs/validate` instead.
  - `@crustjs/utils/schema` is core-free shared infrastructure; package-specific APIs wrap errors at their own boundaries.

  **`@crustjs/schema-utils` removed.** The standalone workspace package is gone; its surface lives at `@crustjs/utils/schema`. The published `@crustjs/schema-utils@0.0.1` artifact on npm will be deprecated separately.

  **`@crustjs/core`, `@crustjs/validate`, `@crustjs/store` — raw schema-backed validation.** Vendor-specific schema introspection is removed; validated helpers now use Standard Schema validation over parsed values. `arg()`, `flag()`, and `field()` no longer infer type, requiredness, descriptions, multiplicity, or defaults from Zod/Effect internals. Missing values are passed to validation as `undefined`, so schema `.optional()` and `.default()` behavior applies naturally at runtime.

  - Validated positional args can omit parser `type`; they validate the raw positional string (or string array for variadic args) through the schema.
  - Validated CLI flags must declare parser `type` because it defines CLI grammar/token ownership: boolean flags do not consume a value, while string/number flags consume `--flag value` / `--flag=value`. Schemas validate and transform after parsing.
  - Descriptions must now be supplied through Crust options.
  - The internal `@crustjs/utils/schema` introspection exports (`inferOptions`, `extractDefault`, and related types) were removed.
  - This is a public behavior change for metadata-driven parser/help/store consumers: add explicit Crust metadata (`type`, `multiple`, `description`, `default`, etc.) where that metadata is still needed.

  **`@crustjs/create`, `@crustjs/skills` — internal dedup onto `resolveSourceDir`.** Public signatures and behavior of `createProject()` and `installSkillBundle()` are unchanged, but the wording of three thrown `Error` messages now comes from the shared helper:

  - `"Template URL must use file: protocol, got ..."` / `"Bundle URL must use file: protocol, got ..."` → `"sourceDir URL must use file: protocol, got ..."`
  - `"Could not resolve relative template path ..."` / `"Could not resolve relative bundle path ..."` → `"Could not resolve relative sourceDir ..."` (both `process.argv[1]` unset and missing-`package.json` variants)

  Consumers that match on `Error.message` text from these three failure modes will need to update their patterns. All other thrown messages (`Template directory does not exist`, `Template path is not a directory`, path-traversal rejection, `Bundle source directory does not exist`, missing `SKILL.md`, destination-conflict, etc.) are unchanged.

  The `@internal`-tagged `resolveBundleSourceDir` export from `@crustjs/skills/bundle` was removed. It carried `@internal` JSDoc and was undocumented (exported only for direct unit-test access); its behavior is preserved by `resolveSourceDir` from `@crustjs/utils`.

- d08439a: Internal refactor: `ValueType`, `ResolvePrimitive`, and number coercion now use shared `@crustjs/utils` primitives with no consumer-visible behavior change.
- c4d2b22: Extend `ValueType` with `"url"`, `"path"`, and `"json"` (resolving to `URL`, absolute `string`, and `unknown`). Add a `parse?: (raw: string) => unknown` escape hatch on `StringFlagDef`/`StringMultiFlagDef`/`StringArgDef`; every non-string variant declares `parse?: never`, so misuse is rejected at compile time. Async `parse` functions are rejected at command setup via a new `CONFIG` error code. Fix: when `parse` is set and argv is absent but `default` is present, `parse(String(default))` now runs so the runtime value matches the inferred type. **Behavior change:** `choices` on string flags/args is now enforced at parse time (previously hint-only); raw argv is validated against `choices` before any `parse` transform runs.
- c4d2b22: Review-driven follow-ups to the value-type and parse-escape-hatch work:

  - `type: "path"` flag/arg defaults now run through `coercePath` so omitting the flag yields the same absolute path users get when they pass it on the command line (`{ type: "path", default: "./dist" }` previously returned the raw relative string).
  - `choices` is now validated against `default` values in both the parse and non-parse default branches, mirroring argv-side enforcement so `{ choices: ["a","b"], default: "z" }` can't be silently accepted while `--flag z` throws.
  - Re-export the documented `Resolve<T>` and `ResolveBaseType<F>` type helpers from `@crustjs/core` so consumers can `import type { Resolve, ResolveBaseType } from "@crustjs/core"` as the API reference shows.

- Updated dependencies [0dc69b1]
- Updated dependencies [d08439a]
  - @crustjs/utils@0.0.2

## 0.0.17

### Patch Changes

- b87e0ee: Add `choices` to `FlagDef`/`ArgDef` and `hidden` to `CommandMeta`.

  Two purely-additive optional fields on the `@crustjs/core` public type surface:

  - **`choices?: readonly string[]`** on string-typed flag and arg variants
    (`StringFlagDef`, `StringMultiFlagDef`, `StringArgDef`) — a static enum of
    valid values for the flag/arg.

    ```ts
    flags: {
      target: { type: "string", choices: ["browser", "bun", "node"] },
    }
    ```

    `choices` is a **hint for tooling** consumed by shell-completion tooling
    to emit static value candidates and may be consumed by future opt-in
    validation. It is **NOT** enforced at parse time in this version: passing
    a value outside `choices` does not throw, the value is still parsed as a
    string and delivered to your handler. Validate explicitly inside your
    handler if you need runtime rejection today. Adding `choices` to
    number/boolean variants is a compile-time error.

  - **`hidden?: boolean`** on `CommandMeta` — omits a command from any
    tooling that enumerates the command tree for users (help output, man
    pages, skill descriptors, completion candidate lists, etc.).

    ```ts
    meta: { name: "__complete", hidden: true, description: "Internal" }
    ```

    Listing-only: the command stays fully invocable by name (or alias),
    routing is unchanged, and it can still surface through tooling that
    looks up specific commands rather than enumerating the tree (e.g.
    `didYouMeanPlugin`). The default `helpPlugin` (in `@crustjs/plugins`)
    follows this contract today; first-party generators and custom
    renderers should too.

  Both fields are purely additive at the type level — existing code that
  does not set `choices` or `hidden` is unchanged. The parser is
  unmodified.

- f1baa45: Add `aliases` to `CommandMeta`.

  Commands and subcommands can now declare alternative names that resolve to the same command node:

  ```ts
  new Crust("my-cli").command("issue", (cmd) =>
    cmd.meta({ aliases: ["issues", "i"] }).run(() => {})
  );
  // my-cli issue, my-cli issues, and my-cli i all route to the same command
  ```

  The change is purely additive at the type level — existing code that does not set `aliases` is unchanged. `resolveCommand` gains a fast path that scans sibling `meta.aliases` on miss; `commandPath` continues to record the canonical name only, so error messages, help titles, and downstream plugins are unaffected by which alias the user typed. `CrustError("COMMAND_NOT_FOUND")`'s `details.available` keeps its canonical-only contract — alias-aware consumers (e.g. `didYouMeanPlugin`) read aliases directly from `details.parentCommand.subCommands`.

  Alias collisions are eagerly rejected at registration time with `CrustError("DEFINITION", …)`. Plugin-installed subcommands (via the `addCommand` setup action) get the same check and are skipped with a warning if their canonical name or any alias collides — mirroring how a colliding canonical name was already handled. `validateCommandTree` re-runs the full check against the final tree. An alias may not equal the command's own canonical name, any sibling's canonical name, or any sibling's alias; aliases must be non-empty, contain no whitespace, and not start with `-`.

- 8779692: Make the `choices`, `meta.aliases`, and `meta.hidden` contracts consistent
  across every consumer (help, did-you-mean, man, completion).

  A cross-consumer audit found three gaps:

  - `helpPlugin` rendered output omitted the `choices` list for both flags
    and positional args, so users could not discover valid values from
    `--help` without resorting to shell completion or source-reading.
  - `didYouMeanPlugin` and the `@crustjs/man` manpage generator both
    walked the command tree without filtering `meta.hidden: true`, so
    internal commands (e.g. `__complete`) leaked into typo suggestions,
    the "Available commands" fallback, and published man pages.
  - `@crustjs/man` omitted long flag aliases (`def.aliases`) and `choices`
    from the OPTIONS / ARGUMENTS sections, leaving the man page strictly
    less informative than `--help`.
  - The completion plugin's bash and fish templates only surfaced
    `choices` for the **first** positional argument; zsh respected every
    slot. Variadic-with-choices arguments and multi-positional commands
    silently fell through to file completion in bash/fish.

  Changes:

  - `helpPlugin` renders `[choices: a, b, c]` after the description for
    every flag and arg that declares a `choices` list, composed with
    `[default: ...]` when both are present.
  - `didYouMeanPlugin` skips `meta.hidden: true` siblings in both the
    Levenshtein suggestion corpus (canonical names **and** aliases) and
    the "Available commands" fallback list.
  - `@crustjs/man` filters `meta.hidden: true` subcommands from the
    SUBCOMMANDS section (and skips the section entirely when every
    subcommand is hidden), surfaces flag and arg `choices` as a
    `[choices: ...]` suffix, and includes long flag aliases in OPTIONS
    labels (`-o, --output, --out`, plus `--no-` negation for every long
    spelling on boolean flags).
  - `completionPlugin` bash and fish templates now track positional slot
    index past the resolved command path and emit per-slot choice
    candidates. Variadic-with-choices arguments are handled correctly
    (the choice list applies at every slot from the variadic's declared
    index onwards). The fish template gains a second per-script helper
    `__<ident>_path_at_arg` that the existing `__<ident>_path_is` is
    layered alongside; subcommand and flag rules continue to use the
    original predicate.

  Core / docs:

  - `CommandMeta.hidden` JSDoc now enumerates every tooling surface the
    flag affects (help, completion, did-you-mean, man, skills) and is
    explicit that there is intentionally no analogous `FlagDef.hidden` —
    the workaround for flag-level hiding is to register without a
    description.

- 9db2613: Make build-validation mode safe for in-process callers.

  `Crust.execute()` no longer calls `process.exit()` when only
  `CRUST_INTERNAL_VALIDATE_ONLY=1` is set — it now runs the validation
  pipeline, surfaces errors via stderr and `process.exitCode`, and returns
  like the rest of `.execute()`'s error paths. Process termination is
  opt-in via the new `CRUST_INTERNAL_VALIDATE_FORCE_EXIT=1` env var, which
  `crust build`'s `validateEntrypoint()` sets on its spawned subprocess.

  For end users there is no change: `crust build` now sets both env vars on
  its validation subprocess, preserving the existing behavior of skipping
  entrypoint code after `await app.execute()` during the build check.
  Tests and embedders that need to exercise the validation pipeline can
  now do so without being terminated.

## 0.0.16

### Patch Changes

- def425e: Restrict `noNegate` to boolean flag types only

  Moved `noNegate` from the shared `FlagDefBase` interface to `BooleanFlagDef` and `BooleanMultiFlagDef`. Setting `noNegate` on a non-boolean flag (e.g. string or number) is now a compile-time error instead of being silently ignored at runtime.

## 0.0.15

### Patch Changes

- 5e0afa4: Fix inherited flags not being applied to subcommand trees injected by plugins. The help flag (`-h`) now correctly inherits into plugin-added subcommands.

## 0.0.14

### Patch Changes

- f78b327: Decouple parsing from validation: `parseArgs()` is now a pure parse+coerce function that never throws for missing required values. A new `validateParsed()` function handles required-value constraints separately. This fixes `--help` showing an error instead of help text when required args are missing.

## 0.0.13

### Patch Changes

- 6dea64c: Handle Ctrl+C prompt cancellations more gracefully. Prompt rendering now moves to a fresh line on cancel, and `Crust.execute()` treats `CancelledError` as a silent user abort with exit code `130` instead of printing `Error: Prompt was cancelled.`.

## 0.0.12

### Patch Changes

- b8ebfa4: Refine skill plugin ergonomics and tighten core public API boundaries.

  - `@crustjs/skills`:

    - `skillPlugin` now uses `command?: string` (default: `"skill"`) instead of `boolean | string`.
    - `skillPlugin` option `scope` was replaced with `defaultScope`.
    - Interactive scope selection now prompts for `project`/`global` only when `defaultScope` is not provided; non-interactive fallback is `global`.
    - Auto-update now checks both `project` and `global` install paths for the current cwd and reports scope in update messaging.
    - Added `skill update` subcommand for manual update-only runs.

  - `@crustjs/core`:
    - Removed `createCommandNode` and `computeEffectiveFlags` from the root `@crustjs/core` export surface.
    - High-level `Crust` builder usage is now the recommended path for command construction.

## 0.0.11

### Patch Changes

- 9f81bcc: Preserve effective flag typing across `Crust` builder chains by carrying an internal `Eff` generic, and short-circuit `EffectiveFlags` for wide inherited flag types to reduce TypeScript type-check overhead.
- 72ea166: Reduce TypeScript type-check overhead in large projects by removing compile-time inherited/local flag cross-collision validation from `Crust#flags()`. Runtime collision checks remain in argument parsing and command-tree validation.

## 0.0.10

### Patch Changes

- 96ca6b2: Adopt the new builder-style command API across core and official packages, including inherited flags, lifecycle hooks, plugin usage, and command metadata improvements. Update related tooling, templates, and documentation to align with the new command authoring flow.

## 0.0.9

### Patch Changes

- a1f233e: Enable minification for all package builds, reducing bundle sizes by ~27%. Also shorten error messages in `@crustjs/core` for smaller output.
- e3624b2: Add pre-compile validation to `crust build`. Before compiling, the build command now spawns your entry file in a validation-only subprocess to check the full command tree (including plugin-injected flags and subcommands) for definition errors such as flag alias collisions and reserved `no-` prefix misuse. Disable with `--no-validate`.

## 0.0.8

### Patch Changes

- 384e2a9: Add `addSubCommand` to plugin `SetupActions`, allowing plugins to inject subcommands during setup. User-defined subcommands take priority over plugin-injected ones. `Command.subCommands` is now always initialized (non-optional).

  Redesign `@crustjs/skills` from a build-time CLI tool into a runtime plugin. `skillPlugin()` handles auto-update of installed skills and optionally registers an interactive `skill` subcommand via `addSubCommand`. Skill metadata (name, description) is derived from the root command — only `version` needs to be supplied. Remove `createSkillCommand` and `SkillCommandOptions` from public API.

## 0.0.7

### Patch Changes

- 1364768: Harden boolean flag parsing by reserving the `no-` prefix for canonical negation only: reject `no-`-prefixed flag names/aliases at definition time, disallow `--no-<alias>` in favor of `--no-<canonical>`, and return clearer parse errors for invalid boolean value assignment forms like `--flag=true`.

## 0.0.6

### Patch Changes

- 8c23587: Add `@crustjs/validate` package with Zod 4 and Effect schema-first validation for CLI commands.

  `defineZodCommand` uses Zod schemas as the single source of truth — parser definitions, help text, runtime validation, and handler types are all derived from the schemas. Includes `arg()` and `flag()` DSL helpers, compile-time variadic/alias validation, and structured `CrustError("VALIDATION")` errors.

  Core changes: export `ValidateFlagAliases` and `ValidateVariadicArgs` utilities, add `ValidationErrorDetails` type to `VALIDATION` error code, and generalize compile-time validation types to work with any record/tuple shape.

## 0.0.5

### Patch Changes

- 8e0b48a: Fix published package metadata containing unresolved workspace and catalog protocols by switching to bun publish

## 0.0.4

### Patch Changes

- 115d396: revamp type system for args and flags for better UX when working with defineCommand
- 9b951e9: fix alias collision error message to use correct prefix for multi-letter aliases
- bdd101f: improve compile-time validation errors to show per-item granularity with descriptive branded properties
- dcc258c: switch to use literal string for flags and args types

## 0.0.3

### Patch Changes

- Update domain to crustjs.com, update dependencies, add homepage, and remove flaky cross-compilation tests
