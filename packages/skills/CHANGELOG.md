# @crustjs/skills

## 0.2.0

### Minor Changes

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Unify build-time artifact generation behind Extension build hooks and a single snapshot protocol.
  
  - Extensions can expose a `build(ctx)` hook for build-time artifact generation. The context carries the frozen root Command Snapshot and a resolved absolute output directory; snapshots are refreshed between hooks so later generators see sections derived from earlier hooks' outputs.
  - `crust build` runs build hooks from every registered Extension in registration order. Extension presence is the source of intent — the `--man` flag is removed, and `--no-validate` is the single opt-out that skips entry preparation and all build hooks. npm package staging includes every top-level artifact directory emitted by hooks; the name `bin` is reserved for generated npm executables.
  - Build validation and artifact generation share one subprocess-only snapshot-file protocol. `@crustjs/core/tooling` exports `SNAPSHOT_PATH_ENV` (replacing `VALIDATION_MODE_ENV` and `VALIDATION_FORCE_EXIT_ENV`), and man-page generation no longer requires the entry module to export its app. Entries that never call `await app.execute()` previously passed validation vacuously; they now fail with an actionable missing-snapshot error (use `--no-validate` if intentional).
  - New `man(options?)` in `@crustjs/man` is a build-only Extension that writes an mdoc page under the build output's `man` directory. Section 1 is the default; `man({ section })` selects another section and `man({ name })` sets the installed command name. `writeManPage()` remains for custom pipelines and accepts a prepared Command Snapshot as `root` instead of a live app.
  - The `skill()` Extension in `@crustjs/skills` contributes a build hook that writes packaged skills under the build output's `skills` directory: it copies an available packaged source wholesale and otherwise renders from the prepared Command Snapshot.
  - Add first-class Bun, Deno, and Node build runtimes. Projects can persist `crust.runtime` in package.json or override it with `--runtime`; Deno produces standalone executables and Node produces executable bundled JavaScript.
  - `--target` accepts canonical Bun target names only. Replace short names such as `linux-x64` and `darwin-arm64` with `bun-linux-x64-baseline` and `bun-darwin-arm64`.
  - Make build option validation deterministic through a reusable build plan and consistently reject malformed project package manifests. Fix create-crust workspace version inputs, declaratively validate distribution choices, and avoid announcing overwrites before confirmation.
  - Run Windows `.cmd` and `.bat` subprocess shims through the platform shell so Crust builds and create package install and Git steps work with Node's CVE-2024-27980 hardening.

- [#327](https://github.com/chenxin-yan/crust/pull/327) [`3526708`](https://github.com/chenxin-yan/crust/commit/3526708b3e95c214c4142c31caa106f845bd2fa4) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Rework skill build options (breaking).
  
  - `writeSkills()` takes a single options object; `app` is optional, and omitting it writes only authored `extras`. Writing no skills at all is an error.
  - The `skill()` Extension's build hook always renders the generated skill and `extras` from the Command Snapshot; it no longer copies an existing `distDir`, so `crust build` output cannot go stale. `distDir` is read only at runtime.
  - `name` and `description` override the generated skill's frontmatter in every build path, `generated: false` ships only `extras`, and an authored extra with the generated skill's name replaces it.

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

- [#335](https://github.com/chenxin-yan/crust/pull/335) [`8ee2946`](https://github.com/chenxin-yan/crust/commit/8ee2946af57574bbd497104cda70dedf34e095b8) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Add command sections to the shared documentation model and export `formatDefault` from `@crustjs/core/tooling`. Root command metadata now carries the application version so version, completion, update-notifier, and skill generation can use one source of truth while extension options remain overrides; reusable command configs reject root-only version metadata. Skill link-operation results now report their effective scope.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Modernize the runtime support matrix and package builds.
  
  - Supported runtimes: Bun 1.3.14+, Node.js 22+, and Deno 2.8+. Package runtime code is portable across all three — Bun globals are replaced with Node-compatible built-ins, and process spawning uses `node:child_process`. On runtimes without `AsyncDisposableStack` (Node 22/23), invocations fall back to an in-package disposal stack.
  - Package builds migrate to tsdown (Rolldown) and modules are marked side-effect free. Internal `@crustjs/utils` imports are inlined, fixing `@crustjs/store` installs that previously required `@crustjs/utils` at runtime. Consumers bundling with Bun 1.3.10–1.3.13 may encounter oven-sh/bun#27709 when tree-shaking packages with `sideEffects: false`.
  - All packages that ship type declarations declare an optional `typescript: "^7.0.0"` peerDependency. Builder inference performance is measured and supported against the native TypeScript 7 compiler; plain-JavaScript consumers are unaffected.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Rework `@crustjs/skills` around a package-as-source model (breaking).
  
  - Build time: `writeSkills()` renders generated and authored skills into a self-describing, package-ready skill source without installing them. Hand-authored skill directories are included through `extras`; `version` is optional and only recorded in the generated SKILL.md `metadata` block. The `skill()` Extension takes the packaged source as `distDir` and can build authored extras alongside generated command documentation.
  - Install time: packaged skills install through symlinks only. Project links use relative, logical package paths verified across npm, pnpm, and Bun; global links use absolute paths; installation fails clearly when the environment cannot create symlinks. Packaged skills are discovered from required, non-empty `name` and `description` fields in SKILL.md frontmatter; missing or whitespace-only fields and frontmatter without a closing `---` fence are rejected consistently across generated, authored, and packaged skills. Ownership comes from symlink targets ending in `skills/<name>`; the pre-run hook repairs owned dangling or stale-target links, and uninstall unlinks owned entries. `crust.json` ownership/version manifests and version-based synchronization are removed.
  - `getSkillStatus()` (formerly `skillStatus()`) reports `linked`, `dangling`, `conflict`, or `absent`. Install results replace `updated` with `repaired`; `PackagedSkill` no longer includes `version`; the `SkillKind` export is removed.
  - Removed runtime generation APIs: `annotate()`, `generateSkill()`, `installSkillBundle()`, `resolveSkillName()`, and their option/result types. Command guidance belongs in `meta.sections`; use `writeSkills()` at build time and `installSkill()` for opt-in installation.
  - `detectInstalledAgents()` drops its string form and the unused `scope` and `home` options.
  - Agent matrix: Warp and Zed are new universal targets, and `pi` is reclassified as universal because it discovers `~/.agents/skills/` and project `.agents/skills/` natively. Antigravity and Mistral Vibe installation paths follow their current conventions. Existing links in old locations — Pi's `~/.pi/agent/skills/` and `.pi/skills/`, Antigravity's `.agent/skills/` and `~/.gemini/antigravity/skills/`, and `~/.vibe/skills/` when `VIBE_HOME` points elsewhere — are no longer managed; remove them manually if present.
  - Generated content: every packaged skill is advertised in root help and generated man pages with its description and resolved source path, and SKILL.md command reference tables include command descriptions.

### Patch Changes

- [#337](https://github.com/chenxin-yan/crust/pull/337) [`8e9fe39`](https://github.com/chenxin-yan/crust/commit/8e9fe3996832f0e6327bead3e82888d58df6201a) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Expose and document the public types needed to name existing API signatures. `Crust._types` is now a supported type-level seam for accessing an application's inferred command types.

- [#307](https://github.com/chenxin-yan/crust/pull/307) [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Faster startup and type-checking.
  
  - Core reuses its prepared invocation tree across repeated dispatches, and skill implementation modules are deferred until first use. Extension command recipes materialize once per builder instance instead of on every run — recipes must stay inert, per the documented contract.
  - Long `.flags()` chains hit `TS2589` about 3x later, the `.provide()` chain ceiling is removed, and `ctx` inference no longer silently degrades on long `.provide()` chains.

- [#327](https://github.com/chenxin-yan/crust/pull/327) [`3526708`](https://github.com/chenxin-yan/crust/commit/3526708b3e95c214c4142c31caa106f845bd2fa4) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Route skill management and automatic link-repair messages through the invocation's injected output, and quietly skip automatic repair when the packaged source is empty.

- [#327](https://github.com/chenxin-yan/crust/pull/327) [`3526708`](https://github.com/chenxin-yan/crust/commit/3526708b3e95c214c4142c31caa106f845bd2fa4) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Reject a generated skill tree whose direct subcommand shares the root command name instead of silently overwriting the root command documentation.

- [#327](https://github.com/chenxin-yan/crust/pull/327) [`3526708`](https://github.com/chenxin-yan/crust/commit/3526708b3e95c214c4142c31caa106f845bd2fa4) Thanks [@chenxin-yan](https://github.com/chenxin-yan)! - Declare `skill --scope` choices in the command definition so invalid scope values fail during parsing with actionable choice details.
- Updated dependencies [[`85d7aa4`](https://github.com/chenxin-yan/crust/commit/85d7aa4ee5010f82622ca6f0d9e81e85f99255ee), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`3526708`](https://github.com/chenxin-yan/crust/commit/3526708b3e95c214c4142c31caa106f845bd2fa4), [`8e9fe39`](https://github.com/chenxin-yan/crust/commit/8e9fe3996832f0e6327bead3e82888d58df6201a), [`cc466b5`](https://github.com/chenxin-yan/crust/commit/cc466b5a0b5792d4811e85d82e341980bc1fb606), [`6ce23e2`](https://github.com/chenxin-yan/crust/commit/6ce23e239b61777ffd29feb2458e23afc546953c), [`40241e2`](https://github.com/chenxin-yan/crust/commit/40241e2e7ecf80a5524a5a6abc1e603ba81ae1b4), [`8ee2946`](https://github.com/chenxin-yan/crust/commit/8ee2946af57574bbd497104cda70dedf34e095b8), [`8e9fe39`](https://github.com/chenxin-yan/crust/commit/8e9fe3996832f0e6327bead3e82888d58df6201a), [`85d7aa4`](https://github.com/chenxin-yan/crust/commit/85d7aa4ee5010f82622ca6f0d9e81e85f99255ee), [`85d7aa4`](https://github.com/chenxin-yan/crust/commit/85d7aa4ee5010f82622ca6f0d9e81e85f99255ee), [`85d7aa4`](https://github.com/chenxin-yan/crust/commit/85d7aa4ee5010f82622ca6f0d9e81e85f99255ee), [`65b6686`](https://github.com/chenxin-yan/crust/commit/65b66866b360cf07610be5a2f52c5dce46d70dbe), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`38aac0c`](https://github.com/chenxin-yan/crust/commit/38aac0cb804c300864f37dacea460c3daf0cef29), [`11f6e26`](https://github.com/chenxin-yan/crust/commit/11f6e261e08367d9f1b36f47ed52d0646ebe9903), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`8e9fe39`](https://github.com/chenxin-yan/crust/commit/8e9fe3996832f0e6327bead3e82888d58df6201a), [`11f6e26`](https://github.com/chenxin-yan/crust/commit/11f6e261e08367d9f1b36f47ed52d0646ebe9903), [`3526708`](https://github.com/chenxin-yan/crust/commit/3526708b3e95c214c4142c31caa106f845bd2fa4), [`e3b196a`](https://github.com/chenxin-yan/crust/commit/e3b196a0d300790b95e9417324b05ae2371d24ce), [`58fd65d`](https://github.com/chenxin-yan/crust/commit/58fd65d8efcba8dcad4652d11abb2bef62f32da9), [`85d7aa4`](https://github.com/chenxin-yan/crust/commit/85d7aa4ee5010f82622ca6f0d9e81e85f99255ee)]:
  - @crustjs/prompts@0.2.0
  - @crustjs/core@0.2.0
  - @crustjs/progress@0.1.0
  - @crustjs/style@0.3.0

## 0.1.2

### Patch Changes

- 42979d9: Make `force: true` rewrite same-version generated skills and bundles in addition to overwriting conflicting install directories.
- Updated dependencies [e298f11]
  - @crustjs/utils@0.0.3
  - @crustjs/core@0.0.19

## 0.1.1

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

- Updated dependencies [0dc69b1]
- Updated dependencies [d08439a]
- Updated dependencies [d08439a]
- Updated dependencies [c4d2b22]
- Updated dependencies [c4d2b22]
  - @crustjs/utils@0.0.2
  - @crustjs/core@0.0.18

## 0.1.0

### Minor Changes

- 2de97e2: `skillPlugin` now accepts a `customSkills` array for managing hand-authored
  skill bundles alongside the auto-generated command-reference skill. Each
  entry runs through the same lifecycle as the main skill (auto-update,
  interactive multiselect, `skill update`) and adds its own multiselect
  prompt after the main one, in array order.

  ```ts
  import { Crust } from "@crustjs/core";
  import { skillPlugin } from "@crustjs/skills";
  import pkg from "./package.json" with { type: "json" };

  new Crust("my-cli")
  	.meta({ description: "My CLI" })
  	.use(
  		skillPlugin({
  			version: pkg.version,
  			customSkills: [
  				{
  					name: "funnel-builder",
  					sourceDir: "skills/funnel-builder",
  					version: pkg.version,
  				},
  			],
  		}),
  	)
  	.run(() => {});
  ```

  `CustomSkillConfig.sourceDir` accepts a `URL` (`file:` protocol), an
  absolute path, or a bare relative string resolved from the nearest
  `package.json` walking up from `process.argv[1]` — the same three modes
  used by `installSkillBundle()`. Each entry's `version` drives
  auto-update detection (compared against the recorded `crust.json`
  version) and is typically wired to the consuming package's
  `package.json` `version`. Per-entry `scope` and `installMode` overrides
  are optional; unset values inherit from the plugin's `defaultScope` /
  `installMode`.

  Setup-time validation enforces:

  - Each `name` satisfies `isValidSkillName`.
  - No `name` collides with the main skill's name.
  - All `name` values are unique within the array.
  - Each `version` is a non-empty string.
  - Each `sourceDir` is a `string` or `URL`.

  Bundle files are copied as raw bytes, so supporting binary assets round-trip
  unchanged. Passing `agents: []` to `installSkillBundle()` validates the
  bundle without installing it.

  Per-entry failures are logged with the bundle name and never abort other
  entries. Failures from explicit `skill --all` and `skill update` set a
  non-zero exit code so automation notices partial failures; startup
  auto-update remains warning-only. When `customSkills` is omitted or empty,
  only the generated main skill is managed.

  The bundle's `SKILL.md` frontmatter `name:` must equal the configured
  `name` — mismatches are rejected at install time so plugin status /
  uninstall paths can never drift from the canonical install location.

- 2de97e2: `CustomSkillConfig.version` is now optional in `skillPlugin`'s
  `customSkills`. When omitted, the entry inherits the plugin's top-level
  `version` — the typical case when the bundle ships in the same package as
  the consuming CLI. Pass an explicit value to opt into independent
  versioning (e.g. a bundle vendored from another package at a different
  release cadence).

  ```ts
  skillPlugin({
    version: pkg.version,
    customSkills: [
      // Inherits `version: pkg.version` from the plugin.
      { name: "funnel-builder", sourceDir: "skills/funnel-builder" },
      // Explicit override for an independently-versioned bundle.
      {
        name: "vendored-toolkit",
        sourceDir: "skills/vendored-toolkit",
        version: "0.3.0",
      },
    ],
  });
  ```

  This aligns `version` with how `scope` and `installMode` already inherit
  from the plugin. The existing required-`version` shape keeps working —
  all current configs are unchanged.

  Setup-time validation now rejects an explicit empty-string `version` so a
  typo can't silently fall through to the plugin-level fallback. Omitting
  the field entirely is the supported way to inherit.

- dac902a: **Add `installSkillBundle()` for hand-authored skill bundles.**

  New `installSkillBundle(options)` entrypoint installs a directory containing
  `SKILL.md` and supporting files through the same canonical-store + agent
  fan-out pipeline used by `generateSkill()`. The bundle's `SKILL.md`
  frontmatter is the source of truth for `name` and `description` — both are
  required, and Crust reads them without rewriting the file. `version` is a
  required option (typically wired to the consuming package's `package.json`
  `version`) recorded in `crust.json` for update detection. Files are copied
  as UTF-8 text (binary supporting files are not supported). Bundle contents
  are copied as authored — there is no implicit name-based filtering of
  `node_modules/`, dotfiles, etc.; bundle authors are responsible for
  pointing `sourceDir` at a clean directory. `crust.json` at the bundle
  root is reserved: if found in the source, the call throws so the conflict
  surfaces immediately. Crust then writes a fresh `crust.json` for
  ownership tracking. Symlinks that escape the bundle root are rejected.

  ```ts
  import { installSkillBundle } from "@crustjs/skills";
  import pkg from "./package.json" with { type: "json" };

  await installSkillBundle({
  	sourceDir: "skills/funnel-builder",
  	agents: ["claude-code"],
  	version: pkg.version,
  });
  ```

  `sourceDir` accepts an absolute path, a `file:` URL, or a relative path
  resolved from the nearest `package.json` walking up from `process.argv[1]`
  (matching `@crustjs/create`'s template resolution).

  **Additive `kind` field on `crust.json`.** Generated and bundle skills now
  record their origin in `crust.json` as `kind: "generated" | "bundle"`.
  Legacy `crust.json` files written before this field existed are read as
  `"generated"` for backward compatibility — existing generated installs
  continue to update cleanly without a migration step.

  **New `kindMismatch` and `manifestMalformed` details on `SkillConflictError`.**
  Attempting to install a bundle on top of a generated skill (or vice versa)
  at the same name now throws `SkillConflictError` with
  `details.kindMismatch: { existing, attempted }`. A directory whose
  `crust.json` exists but is unparseable, missing a version, or declares an
  unrecognized `kind` surfaces as `details.manifestMalformed: { reason,
rawKind? }`. Pass `force: true` to overwrite, or uninstall the existing
  skill first.

  `generateSkill()` behaviour is unchanged for existing callers.

  Resolves part of #110 (the lower-level primitive half; plugin integration
  via `skillPlugin({ customSkills })` is tracked separately).

### Patch Changes

- d4cd621: # Make `agents` optional on `generateSkill`, `uninstallSkill`, and `skillStatus`

  The `agents` field on `GenerateOptions`, `UninstallOptions`, and
  `StatusOptions` is now optional. The default differs by entrypoint so
  install behavior tracks the current machine, while uninstall and status
  sweep every known path:

  | Entrypoint                      | Default when `agents` is omitted                              | `PATH` I/O? |
  | ------------------------------- | ------------------------------------------------------------- | ----------- |
  | `generateSkill`                 | `[...getUniversalAgents(), ...await detectInstalledAgents()]` | Yes         |
  | `uninstallSkill`, `skillStatus` | Every supported agent (exhaustive sweep of all known paths)   | No          |

  In all three, `agents: []` is treated as a no-op (no install, uninstall, or
  status entries). An explicit array always overrides the default.

  **Behavior change.** Existing callers that pass an explicit `agents` array
  keep their current behavior. Callers that omit `agents` (or pass
  `agents: undefined`, which is common from object spread) now trigger the
  defaults above:

  - `generateSkill` performs filesystem I/O via `detectInstalledAgents()` to
    probe `PATH` for installed agent CLIs.
  - `uninstallSkill` and `skillStatus` do not probe `PATH`; they iterate the
    full agent registry and stat each per-agent path, which can return a
    larger result set than before (one entry per supported agent).

  **Migration.**

  ```ts
  // Before — manual composition of universals + detected agents
  const universal = getUniversalAgents();
  const additional = await detectInstalledAgents();
  await generateSkill({
    command,
    meta,
    agents: [...universal, ...additional],
    scope: "global",
  });

  // After — same result, no manual composition
  await generateSkill({ command, meta, scope: "global" });
  ```

  `getUniversalAgents()`, `getAdditionalAgents()`, and
  `detectInstalledAgents()` remain exported for callers who want fine-grained
  control.

  **Bug fix.** `detectInstalledAgents()` no longer reports a command as
  installed when the matching `PATH` entry is an executable directory rather
  than a file. The probe now requires the entry to be a regular file (or
  symlink to one) before checking the `X_OK` bit.

- Updated dependencies [075490b]
- Updated dependencies [b87e0ee]
- Updated dependencies [f1baa45]
- Updated dependencies [075490b]
- Updated dependencies [8779692]
- Updated dependencies [67f815a]
- Updated dependencies [82f5ad6]
- Updated dependencies [9db2613]
- Updated dependencies [3421dbf]
  - @crustjs/style@0.2.0
  - @crustjs/core@0.0.17
  - @crustjs/prompts@0.1.0
  - @crustjs/progress@0.0.4

## 0.0.24

### Patch Changes

- Updated dependencies [df08a3a]
- Updated dependencies [7ca5e5f]
- Updated dependencies [df08a3a]
- Updated dependencies [67a9f25]
  - @crustjs/style@0.1.0
  - @crustjs/prompts@0.0.13
  - @crustjs/progress@0.0.3

## 0.0.23

### Patch Changes

- Updated dependencies [23fae62]
  - @crustjs/prompts@0.0.12

## 0.0.22

### Patch Changes

- 2ea1028: Suppress the universal skills agent hint when the skill command runs non-interactively.

  This keeps `skill` output focused on actual changes and avoids showing the universal agent support list during no-op runs that default to the current installed selection.

- 341f3b1: Add a new `@crustjs/progress` package and move the canonical `spinner()` implementation there.

  `@crustjs/prompts` now temporarily re-exports `spinner` and related types as deprecated compatibility exports, with removal planned for `v0.1.0`.

  Update internal consumers and docs to use `@crustjs/progress` as the new home for spinner-based progress UI.

- Updated dependencies [def425e]
- Updated dependencies [341f3b1]
  - @crustjs/core@0.0.16
  - @crustjs/progress@0.0.2
  - @crustjs/prompts@0.0.11

## 0.0.21

### Patch Changes

- 687b1b8: Fix scope resolution in skill auto-update to properly deduplicate project and global scopes when they resolve to the same effective scope.
- Updated dependencies [9b57c50]
  - @crustjs/style@0.0.6
  - @crustjs/prompts@0.0.10

## 0.0.20

### Patch Changes

- 4634996: Strengthen rendered skill workflow prompts to use stricter dictation tone so agents follow command documentation more consistently.

## 0.0.19

### Patch Changes

- Updated dependencies [5e0afa4]
  - @crustjs/core@0.0.15

## 0.0.18

### Patch Changes

- 5cc32c7: Add `--all` flag to skill command for non-interactive installation to all detected agents
- bff135a: Use raw CLI name as the canonical skill directory name instead of prepending `use-`, and add legacy `use-*` install migration compatibility

## 0.0.17

### Patch Changes

- 954be97: Add custom instructions and command annotations support. Plugin-level `instructions` option renders top-level guidance into SKILL.md, and `annotate()` attaches agent-facing instructions to individual commands. Also forwards `license`, `allowedTools`, `compatibility`, and `disableModelInvocation` from plugin options to skill metadata.
- Updated dependencies [f78b327]
  - @crustjs/core@0.0.14

## 0.0.16

### Patch Changes

- 32449a1: Show supported agents in Universal skill option. When selecting agents for skill installation, the Universal option now displays which agents support the universal skill format (e.g., "Agents supporting universal skills: Amp, Cline, Codex, Cursor, Gemini CLI, GitHub Copilot, Kimi Code CLI, OpenCode, Replit").
- Updated dependencies [944f852]
- Updated dependencies [6dea64c]
- Updated dependencies [819bad7]
  - @crustjs/style@0.0.5
  - @crustjs/core@0.0.13
  - @crustjs/prompts@0.0.9

## 0.0.15

### Patch Changes

- 3a13f2b: Add canonical `.crust/skills` store with configurable symlink/copy install strategy.

  - Skill bundles are now rendered once to a canonical store (`.crust/skills/` for project scope, `~/.crust/skills/` for global scope) and then installed into agent-specific paths via symlink or copy.
  - Add `installMode` option (`"auto"` | `"symlink"` | `"copy"`) to `GenerateOptions` and `SkillPluginOptions`. Default `"auto"` creates symlinks with fallback to copy; `"symlink"` requires symlinks or fails; `"copy"` writes full copies.
  - Add `resolveCanonicalSkillPath()` export for resolving the canonical store path.
  - Uninstall now cleans up the canonical store when no agent install paths remain.
  - Export new `SkillInstallMode` type from package root.

- 42b05c7: Replace spawn-based agent detection with non-executing PATH lookup to prevent unrelated IDE CLIs from launching during normal CLI startup.
  - Replace `checkCommandAvailable`/`runCommand` (which spawned `<cmd> --version`, `<cmd> -v`, `<cmd> version`) with `isCommandOnPath()` — a pure filesystem PATH scan using `fs.accessSync` with `X_OK`. This eliminates the bare `version` positional arg that caused Electron-based IDEs (Antigravity, Kiro) to open on macOS.
  - Remove `detectInstalledAgents()` from `autoUpdateSkills` and `buildSkillUpdateCommand`. Auto-update and `skill update` now check all known agents via `skillStatus()` (filesystem-only), avoiding any PATH probing during normal CLI startup.
  - Keep `detectInstalledAgents()` only for the interactive `skill` command UX, now backed by the safe PATH lookup.

## 0.0.14

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

- 0944e0e: Normalize universal agent messaging in `skill` command output.

  - Auto-update messages now report universal targets as `Universal` instead of enumerating each supported universal agent.
  - Install and overwrite success output now prints a single `Universal -> <path>` entry for universal installs.
  - Remove output now reports `Removed from Universal` (and combines with additional agents when applicable).

- cd33d3f: Strengthen generated skill guidance to reduce CLI command hallucinations.

  - `SKILL.md` now explicitly requires reading the mapped command doc before giving command-specific answers.
  - Generated command docs now include an authority section stating that only documented flags/options/aliases/defaults are supported.
  - Rendering and e2e tests were updated to enforce the stricter verification contract.

- Updated dependencies [b8ebfa4]
  - @crustjs/core@0.0.12

## 0.0.13

### Patch Changes

- ab4b601: fix universal agent path issue

## 0.0.12

### Patch Changes

- a1329a2: Refactor skills agent handling to support a broader agent matrix with a universal install group. Detection now uses CLI command probes for additional agents, universal targets are exposed as a single selectable option, and prompt behavior includes already-installed additional targets even when the agent binary is not detected. Also simplify `crust.json` metadata and align docs with the new install and detection model.

## 0.0.11

### Patch Changes

- c089f62: Generate a single-file command reference by embedding all commands (including nested commands) directly in SKILL.md and removing command-index.md. Also clarify executable routing by documenting that any command labeled `runnable` (including `runnable, group`) can be executed.
- Updated dependencies [9f81bcc]
- Updated dependencies [72ea166]
  - @crustjs/core@0.0.11

## 0.0.10

### Patch Changes

- Updated dependencies [f704195]
  - @crustjs/prompts@0.0.8

## 0.0.9

### Patch Changes

- 96ca6b2: Adopt the new builder-style command API across core and official packages, including inherited flags, lifecycle hooks, plugin usage, and command metadata improvements. Update related tooling, templates, and documentation to align with the new command authoring flow.
- Updated dependencies [96ca6b2]
  - @crustjs/core@0.0.10

## 0.0.8

### Patch Changes

- f7d68ea: Support non-interactive mode for the `skill` command.

  - Detect TTY and conditionally pass `initial` to prompts so the command works in CI/piped environments.
  - In non-interactive mode, install skills to all detected agents automatically.
  - In non-interactive mode, skip conflict overwrite (safe default).

- 8c87b69: Refactor skill plugin: remove `autoInstall`, keep auto-update, polish UI.
  - Remove `autoInstall` option — the plugin now only auto-updates already-installed skills. First-time installation should be done via the interactive `skill` subcommand or programmatically using the exported primitives (`detectInstalledAgents`, `skillStatus`, `generateSkill`).
  - Move auto-update logic from middleware to setup phase, making it independent of plugin registration order.
  - Add scope-aware agent detection: `detectInstalledAgents()` now respects the configured scope (`global` or `project`) with fallback from project to global roots.
  - Accept options object in `detectInstalledAgents()` with backwards-compatible string parameter support.
  - Skip auto-update during build validation mode (`CRUST_INTERNAL_VALIDATE_ONLY`).
  - Use spinner from `@crustjs/prompts` for auto-update messages instead of raw `console.log`.
  - Style interactive command output with `@crustjs/style` (`bold`, `dim`, `yellow`).
  - Replace hardcoded defaults with `DEFAULT_SKILL_COMMAND_NAME` and `DEFAULT_SKILL_SCOPE` constants.
  - Move `@crustjs/prompts` and `@crustjs/style` from peer to direct dependencies.
  - Fix incorrect `skillPlugin()` JSDoc example that placed `plugins` inside `defineCommand()` instead of `runMain()`.

## 0.0.7

### Patch Changes

- Updated dependencies [81608ea]
  - @crustjs/prompts@0.0.7

## 0.0.6

### Patch Changes

- a1f233e: Enable minification for all package builds, reducing bundle sizes by ~27%. Also shorten error messages in `@crustjs/core` for smaller output.
- Updated dependencies [a1f233e]
- Updated dependencies [b17db37]
- Updated dependencies [e3624b2]
  - @crustjs/core@0.0.9
  - @crustjs/prompts@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [695854e]
  - @crustjs/prompts@0.0.5

## 0.0.4

### Patch Changes

- 7be331c: Improve `skillPlugin()` auto-install messaging to clearly distinguish first-time installs from updates. Auto-installs now print an explicit notification, and when the interactive command is enabled, the message includes a `my-cli skill` management hint.
- 5c0d1b3: Enable `skillPlugin()` interactive command injection by default. The `skill` subcommand is now registered unless `command: false` is explicitly set, reducing setup friction for skill management. Update `SkillPluginOptions` docs to reflect `command` defaulting to `true` and clarify the opt-out behavior.
- 0221ca7: Rename `manifest.json` to `crust.json` and add conflict detection for non-Crust skill directories. `generateSkill()` now throws `SkillConflictError` when the target directory exists but lacks a `crust.json`, preventing silent overwrites of manually created or third-party skills. The plugin middleware warns and skips, while the interactive `skill` command prompts the user to confirm overwriting. A `force` option is available on `GenerateOptions` for programmatic override.
- 6d8aaf0: Harden SKILL.md generation with bug fixes and new features:

  **Bug fixes:** YAML frontmatter values containing special characters (`:`, `#`, `*`, `!`, etc.) are now properly escaped with double quotes. Markdown table cells in args/flags tables now escape literal `|` characters to prevent broken rendering.

  **New features:** Added `isValidSkillName()` export that validates skill names against the Agent Skills spec pattern (`^[a-z0-9]+(-[a-z0-9]+)*$`, 1–64 chars); `generateSkill()` now throws on invalid names. Added optional `allowedTools`, `license`, `compatibility`, and `disableModelInvocation` fields to `SkillMeta`, emitted conditionally in YAML frontmatter.

  **Improved output:** SKILL.md now includes "when to use this skill" guidance text derived from the skill description, and uses stronger directive language for lazy-loading command files.

## 0.0.3

### Patch Changes

- 1d75efd: Rewrite interactive skill command to single multiselect prompt and add `use-` prefix idempotency guard to `resolveSkillName`

## 0.0.2

### Patch Changes

- 384e2a9: Add `addSubCommand` to plugin `SetupActions`, allowing plugins to inject subcommands during setup. User-defined subcommands take priority over plugin-injected ones. `Command.subCommands` is now always initialized (non-optional).

  Redesign `@crustjs/skills` from a build-time CLI tool into a runtime plugin. `skillPlugin()` handles auto-update of installed skills and optionally registers an interactive `skill` subcommand via `addSubCommand`. Skill metadata (name, description) is derived from the root command — only `version` needs to be supplied. Remove `createSkillCommand` and `SkillCommandOptions` from public API.

- Updated dependencies [384e2a9]
  - @crustjs/core@0.0.8
