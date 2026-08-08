# @crustjs/core

## 0.2.0

### Minor Changes

- [#150](https://github.com/chenxin-yan/crust/pull/150) [`ac028c8`](https://github.com/chenxin-yan/crust/commit/ac028c8a8694fc4d685ed7140353a881bc92aeb6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Boolean negation is now alias-symmetric: `--no-<alias>` works for every long alias, matching what man pages and completion scripts already advertised. `noNegate: true` is now enforced by the parser — negating a `noNegate` boolean via any spelling is a `PARSE` error instead of being silently accepted.

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Ship the 0.2 API revamp for the framework spine (see `docs/adr/0001`–`0009`):

  - Extensions replace plugins: `@crustjs/extensions` package, `defineExtension(name, config)` plain frozen configs with `intercept(ctx, next)` and `handleError` presentation chain; `.use()` removed.
  - Contexts are command dependencies: `defineContext(name, config?, setup)` always returns a factory, attached with the variadic `.provide(...)`, constructed topologically by declared `requires` dependencies (values arrive via `ctx`), and disposed via native `Symbol.dispose`/`Symbol.asyncDispose` in reverse construction order.
  - `.handle(handler)` defines the Command Handler; `.run(argv, { stdout, stderr })` throws for programmatic embedding; `.execute()` renders and sets `process.exitCode`. `preRun`/`postRun` removed.
  - `CrustError` keeps four stable codes (`DEFINITION`, `PARSE`, `VALIDATION`, `COMMAND_NOT_FOUND`); `_tag`, `CONFIG`, and `EXECUTION` removed; handler and Context errors pass through unwrapped.
  - Standard Schema supported directly on arg/flag definitions; `@crustjs/validate` removed.
  - Public `CommandNode`/`prepareCommandTree()` removed; serializable Command Snapshots cross public boundaries; man/crust/skills consume the unsupported `@crustjs/core/tooling` subpath.
  - `create-crust` ships a single minimal template.

  This is a hard cut from the 0.1 API with no compatibility shims; each removed name's replacement is listed above.

- [#152](https://github.com/chenxin-yan/crust/pull/152) [`ff01466`](https://github.com/chenxin-yan/crust/commit/ff01466931a7f0616ac01e9ea6be2285f702344f) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - New `captureExecute(app, argv)` in `@crustjs/testing` drives the terminal `execute()` path in-process: exit-code protocol (`0`/`1`/`130`), Extension `onError` rendering, and cancellation are assertable without subprocess probes; `process.exitCode` is restored afterwards. To support it, `Crust.execute()` now accepts an optional `io` override alongside `argv`.

- [#144](https://github.com/chenxin-yan/crust/pull/144) [`4e4af76`](https://github.com/chenxin-yan/crust/commit/4e4af76a7236f64ee843504126d09efb799d54ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add inert reusable command definitions with `defineCommand(name, requirements?, recipe)` and checked mounting with the variadic `.mount(...definitions)`.

  A definition carries its own name and lists the Context capabilities it needs from its mount site in a plain `requires` array. Every requirement is checked at the `.mount()` call — compile-time for missing or incompatible Context values, and at runtime for required Context names missing from the parent path. Every mount materializes a fresh command under the definition's carried name; use `.as(newName)` to mount one definition under multiple names or parents, and definitions can `.mount()` other definitions.

  Remove `.sub()`, `.command(name, callback)`, `.command(builder)`, and the exported `ChildCrust` type. One-off inline commands are `.mount(defineCommand("up", (command) => ...))`.

  Migration:

  ```ts
  // Before
  const deploy = parent.sub("deploy").handle(({ flags, ctx }) => {});
  const app = parent.command(deploy);

  // After
  const verbose = defineFlag("verbose", { type: "boolean" });
  const logging = defineContext(
    "logging",
    { flags: [verbose] },
    ({ flags }) => flags
  );
  const auth = defineContext("auth", () => createAuthClient());

  const deploy = defineCommand(
    "deploy",
    { requires: [logging, auth] },
    (command) => command.handle(({ ctx }) => {})
  );

  const app = parent.provide(logging(), auth()).mount(deploy);
  const shipToo = parent.mount(deploy.as("ship"));
  ```

  Provide required Context capabilities with `.provide()` on the parent builder before `.mount()`. Extension-contributed commands are unchanged.

- [#153](https://github.com/chenxin-yan/crust/pull/153) [`98cf6d1`](https://github.com/chenxin-yan/crust/commit/98cf6d193ddabdb9f1f9421935698e79bfc8cc6d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add Context-owned flags with `defineContext(name, { flags }, setup)`. Calling `.provide()` installs each owned flag as a propagating effective flag on that command and descendants mounted afterward, refines the builder's flag types, and passes the validated values to Context setup:

  ```ts
  const apiKey = defineFlag("api-key", { type: "string" });
  const api = defineContext("api", { flags: [apiKey] }, ({ flags }) =>
    createClient({ apiKey: flags["api-key"] })
  );

  const app = new Crust("cli").provide(api()).mount(deploy);
  ```

  Make requirements capability-only. `defineCommand(name, { requires: [logging, auth] }, recipe)` and `defineContext(name, { flags, requires: [config] }, setup)` accept a plain array of Context factories. Top-level `flags` means definitions the unit owns or parses; `requires` means Context capabilities supplied by the command path. Required raw flags are not injected into downstream handler types; expose any needed value from its owning Context.

  Context setup now receives the invocation's injected `stdout` and `stderr` callbacks, shared with the Command Handler. Contexts can encapsulate output behavior instead of exposing flag state for every handler to interpret:

  ```ts
  const logging = defineContext(
    "logging",
    { flags: [verbose] },
    ({ flags, stderr }) => ({
      debug: (message: string) => flags.verbose && stderr(message),
    })
  );
  ```

  Owned flag names, short forms, and aliases cannot collide with application, other Context, or Extension flags; collisions throw `CrustError("DEFINITION", ...)` in either fluent registration order. Extension flag collisions now use `details.reason: "flag-collision"` instead of `"extension-flag-collision"`, with updated message wording.

  `.of(value)` test doubles retain owned flags so test and production command grammars match. `.provide()` does not backfill descendants mounted on an earlier builder.

  The generic slots on `ContextInstance`, `ContextFactory`, `ContextSetup`, `Crust`, and `CommandDefinitionBuilder` now carry Context-owned flags instead of required or inherited flags. Pre-1.0 consumers that specify these generic parameters positionally must update their type arguments.

- [#144](https://github.com/chenxin-yan/crust/pull/144) [`4e4af76`](https://github.com/chenxin-yan/crust/commit/4e4af76a7236f64ee843504126d09efb799d54ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Contexts declare capability requirements: `defineContext(name, config, setup)` accepts `{ flags?: [...owned flag defs], requires?: [...Context factories] }`, and setup receives `{ options, flags, ctx }` — validated values for that Context's owned flags only, plus the values of its declared Context dependencies.

  `.provide(...instances)` is variadic and provide order is free: Contexts on the resolved command path are constructed topologically by their declared `requires` dependencies. A missing dependency or a dependency cycle throws `CrustError("DEFINITION", ...)`, also caught by command-tree validation.

  Every factory also exposes `.of(value)`, returning an instance whose setup yields the precomputed value with its requirements considered satisfied — for test doubles:

  ```ts
  const env = defineFlag("env", { type: "string" });

  const config = defineContext("config", { flags: [env] }, ({ flags }) =>
    loadConfig(flags.env)
  );
  const db = defineContext("db", { requires: [config] }, ({ ctx }) =>
    connect(ctx.config)
  );

  app.provide(db(), config()); // constructed as config → db

  // In tests:
  app.provide(db.of(fakeDb), config.of(fakeConfig));
  ```

  Disposal follows construction: values implementing `Symbol.dispose`/`Symbol.asyncDispose` are disposed in reverse construction order, on success or failure.

- [#144](https://github.com/chenxin-yan/crust/pull/144) [`4e4af76`](https://github.com/chenxin-yan/crust/commit/4e4af76a7236f64ee843504126d09efb799d54ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Name every definition helper with a `define*` prefix: `defineContext(name, ...)`, `defineExtension(name, config)`, `defineCommand(name, ...)`, and the new `defineFlag(name, def)` and `defineArg(name, def)`.

  `defineFlag` and `defineArg` are const-generic helpers that return the definition with its `name` attached, preserving literal types without `as const`. Named definitions attach through the now-variadic builder methods — `.flags(...defs)` replaces `.flags(record)` and `.args(...defs)` replaces `.args(tuple)` — and Contexts may own flag definitions through their top-level `flags` array. Inline object literals carrying a `name` work everywhere a named definition does:

  ```ts
  const verbose = defineFlag("verbose", { type: "boolean", short: "v" });
  const target = defineArg("target", { type: "string", required: true });

  const app = new Crust("my-cli")
    .flags(verbose, { name: "dry-run", type: "boolean" })
    .args(target)
    .handle(({ flags, args }) => {});
  ```

- [#164](https://github.com/chenxin-yan/crust/pull/164) [`2a3250e`](https://github.com/chenxin-yan/crust/commit/2a3250e3e78fc780b873ae9a1b4069997b1f0235) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add a shared presentation-neutral command documentation model to `@crustjs/core/tooling` and use it for help, mdoc, and Agent Skill rendering.

  Help headings now follow conventional title case and list negation for every long alias. Man pages use semantic mdoc flag and argument macros. Generated skills omit hidden commands.

- [#149](https://github.com/chenxin-yan/crust/pull/149) [`db943af`](https://github.com/chenxin-yan/crust/commit/db943af22e3d7e8766b396edd845487368040435) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `ExtensionConfig.commands` now accepts only `defineCommand()` definitions. Migrate extension-owned `new Crust("name")` builders to `defineCommand("name", (command) => ...)`; `ExtensionCommand` is removed. Definition Context requirements are checked when the application prepares and report `DEFINITION` errors.

- [#146](https://github.com/chenxin-yan/crust/pull/146) [`eb0add9`](https://github.com/chenxin-yan/crust/commit/eb0add9272d93f734ecf321e0b481a0aaf6da57e) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Replace Extension `intercept(ctx, next)` and `handleError(error, ctx, next)` with named `hooks`: `preRun(ctx)`, `postRun(ctx, outcome)`, and `onError(error, ctx)`. `preRun` returns `ctx.finish()` to short-circuit successfully; `postRun` runs in reverse extension order after every settled invocation; `onError` returns `true` after rendering an `execute()` failure.

  Command Handlers now receive `rootCommand`, including handlers for Extension-owned commands. Migrate Extension-owned routing work into real `.handle()` callbacks.

- [#152](https://github.com/chenxin-yan/crust/pull/152) [`ff01466`](https://github.com/chenxin-yan/crust/commit/ff01466931a7f0616ac01e9ea6be2285f702344f) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - `execute()` now offers `AbortError` cancellation to Extension `onError` hooks before finishing, so applications can render a cancellation message (e.g. "Operation cancelled") centrally. Exit code stays `130` and cancellation remains silent when no hook claims it — default behavior is unchanged.

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Remove the unused `CrustError.commandNotFound` factory and make internal flag-validation type helpers private.

- [#153](https://github.com/chenxin-yan/crust/pull/153) [`98cf6d1`](https://github.com/chenxin-yan/crust/commit/98cf6d193ddabdb9f1f9421935698e79bfc8cc6d) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - **BREAKING:** Remove `FlagDef.inherit`. Command flags declared with `.flags()` are now always local; Context-owned flags are the only application-level flag propagation mechanism. Recursive Extension flags continue to use `ExtensionFlagDef.recursive`.

  The public `FlagSnapshot.inherit` field and the internal `InheritableFlags` and `ForceInherit` utility types are also removed. A local child flag can no longer override a same-named inherited flag because ordinary flags no longer inherit; Context-owned name collisions remain `DEFINITION` errors.

  | Previous usage                                     | Migration                                                                                                                                                                                        |
  | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `inherit: true` feeds behavior shared by a subtree | Move the flag into `defineContext(name, { flags: [...] }, setup)` and attach the instance with `.provide()` before mounting descendants. Handlers should require the derived Context capability. |
  | Each command reads the raw flag directly           | Define the descriptor once with `defineFlag()` and attach it with `.flags()` to each command that parses it.                                                                                     |

  Cross-command dependencies are capability-only: list Context factories in `requires` and consume their derived values through `ctx`. Raw flag requirements are removed.

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Require Bun 1.3.14 or newer across all published packages and remove the obsolete sync-disposal workaround now that `AsyncDisposableStack.use()` supports `Symbol.dispose`.

- [#152](https://github.com/chenxin-yan/crust/pull/152) [`ff01466`](https://github.com/chenxin-yan/crust/commit/ff01466931a7f0616ac01e9ea6be2285f702344f) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Routing now skips known flags (and their values) that appear before a subcommand name, so `app --quiet translate` runs `translate` instead of silently resolving the handler-less root and exiting 0. All parser-accepted spellings are recognized during routing: long names, `--flag=value`, `--no-<name>` negation (respecting `noNegate`), short flags and inline values, long aliases, and bundled short booleans. Unknown flags and the `--` terminator still stop routing as before.

  Behavior change: recursive flags placed before a subcommand now bind to the subcommand's invocation — e.g. `app --help sub` shows `sub`'s help (previously the root's), and a root-only flag before a subcommand name is now an "unknown flag" error in the subcommand (previously a silent no-op).

### Patch Changes

- [#139](https://github.com/chenxin-yan/crust/pull/139) [`0ce45f4`](https://github.com/chenxin-yan/crust/commit/0ce45f4cd41cc4c9ef4181a23ea6360fd756b49b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Documentation consolidation: package READMEs are now concise stubs linking to the docs site (crustjs.com), unique README content moved into the docs, and public option/type TSDoc was enriched (descriptions, `@default` tags) to back generated API reference tables. No runtime behavior changes.

- [#152](https://github.com/chenxin-yan/crust/pull/152) [`ff01466`](https://github.com/chenxin-yan/crust/commit/ff01466931a7f0616ac01e9ea6be2285f702344f) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Export the `Simplify` helper type from the package root. Consumers with `declaration: true` exporting inferred `defineFlag`/`defineArg`/builder values no longer hit TS2742/TS2883 ("cannot be named without a reference to a private chunk").

- [`c962196`](https://github.com/chenxin-yan/crust/commit/c962196c777401f9627ab70bc4453ac5a62a8233) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Bundle the shared internal utilities into each consumer so `@crustjs/utils` is no longer installed as a runtime dependency.

- [#158](https://github.com/chenxin-yan/crust/pull/158) [`4959ae7`](https://github.com/chenxin-yan/crust/commit/4959ae784da8c8097608fc6c1c6cf525662c16e6) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Refactor flag parsing and command routing to share one canonical flag-spelling table.

- [#159](https://github.com/chenxin-yan/crust/pull/159) [`9963b85`](https://github.com/chenxin-yan/crust/commit/9963b8590cf641f10a76a6ee2b2a5ef80542428b) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Refactor command invocation orchestration into a private pipeline module without changing behavior.

- [#168](https://github.com/chenxin-yan/crust/pull/168) [`275d6a7`](https://github.com/chenxin-yan/crust/commit/275d6a74dc0095089a5f1769b37a1dbd35b656c8) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Vendor the Standard Schema protocol types, as recommended by the specification, and remove `@standard-schema/spec` from runtime dependencies. This does not change the public API or runtime behavior, and published declarations no longer reference the spec package.

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
