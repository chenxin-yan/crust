---
"@crustjs/core": minor
"@crustjs/extensions": minor
"@crustjs/crust": minor
"create-crust": minor
"@crustjs/man": minor
"@crustjs/skills": minor
"@crustjs/testing": minor
---

Ship the 0.2 API revamp for the framework spine (see `docs/adr/`). This is a hard cut from the 0.1 API with no compatibility shims; each removed name's replacement is listed below.

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
