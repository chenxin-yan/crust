# Task: TP-012 — Extend `ValueType` with `url`/`path`/`json` + add `parse?:` escape hatch

**Created:** 2026-04-29
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** New public API surface on `@crustjs/core` (three new built-in
`ValueType` members plus a `parse?:` escape hatch) with non-trivial TS
inference machinery and runtime semantics that the oracle review flagged
multiple critical bugs in. Plan review locks the type-level shape and the
parse-default-coercion semantics before code lands; code review verifies the
runtime fixes (default coercion, async rejection, per-element multi-value)
and the `parse?: never` enforcement on non-string variants.
**Score:** 5/8 — Blast radius: 2 (core public types + plugins completion +
docs surface), Pattern novelty: 2 (entirely new API field with TS-level
override of `Resolve<T>` and per-variant compile-time gating), Security: 0,
Reversibility: 1 (purely additive — new types + new optional field + new
docs pages)

## Canonical Task Folder

```
taskplane-tasks/TP-012-extend-valuetype-with-parse-escape-hatch/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Extend `@crustjs/core`'s `ValueType` literal union with three new built-in
formatted types — `"url"`, `"path"`, `"json"` — that transform raw argv
strings into typed runtime values (a `URL` instance, an absolute resolved
path string, and a `JSON.parse`-d `unknown`). Add a per-variant `parse?:`
escape hatch (a sync function `(raw: string) => T`) allowed **only on string
variants** for any case the closed enum doesn't cover; the TS inference
correctly extracts `ReturnType<typeof parse>` and overrides the built-in
`Resolve<T>` mapper. Update the completion plugin's templates to emit file
completion for `path` flags. The other previously-considered types (`date`,
`duration`, `port`, `regex`, `count`, `bytes`, `bigint`, `hex`, `base64`,
`file`, `dir`) are deferred — they ship as copy-paste recipes in the docs
instead. Several critical bug fixes from the oracle review must be baked in
from the start: the **default-value coercion** semantics, **async-parse
rejection** at command setup, and **compile-time `parse?: never`** on every
non-string variant.

## Dependencies

- **Task:** TP-009 (same-file overlap on `packages/core/src/types.ts`;
  TP-009 adds the `choices` field that this task must coexist with)
- **Task:** TP-010 (this task modifies the completion plugin templates that
  TP-010 creates: walker, spec, bash/zsh/fish templates and their tests)
- **Task:** TP-011 (uses `BaseValueType` and `ResolvePrimitive` from
  `@crustjs/utils`; this task extends `ValueType` to
  `BaseValueType | "url" | "path" | "json"` and `Resolve<T>` accordingly)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**

Spec — required, **read end-to-end first**:
- `/tmp/crust-types-final/FINAL.md` — locked spec for TP-011 + TP-012; the
  "Locked decisions" section at the top is non-negotiable, and the
  "TP-012 — concrete file map" section is the authoritative file list

Oracle reviews — required reading before composing the plan:
- `/tmp/crust-types-oracle/C-typescript-inference.md` — TS inference bug
  findings, especially the **default-coercion bug** (§ around line 244)
  and the `ResolveBaseType<F>` helper shape
- `/tmp/crust-types-oracle/D-ergonomics.md` — naming + UX polish; see the
  `coerce` → `parse` rationale, error-message proposals, and the recipes
  list that powers the `recipes.mdx` page
- `/tmp/crust-types-oracle/B-pragmatism.md` — slim-down rationale; explains
  why `date`, `duration`, `port`, `regex`, `count` are deferred to recipes

Repo source — required reading before touching code:
- `packages/core/src/types.ts` — `ValueType`, `Resolve<T>`,
  `InferFlagValue<F>`, `FlagDef`/`ArgDef` discriminated unions; this task
  modifies it extensively
- `packages/core/src/parser.ts` — `coerceValue` dispatch, default handling,
  multi-value handling; modified to add new-type dispatch, `parse` runtime
  semantics, and the default-coercion bug fix
- `packages/core/src/errors.ts` — `CrustError` shape (`PARSE`, `CONFIG`
  codes used in this task's error paths)
- `packages/plugins/src/completion/walker.ts` (created by TP-010) —
  modified to recognize new types and mark `path` for file completion
- `packages/plugins/src/completion/spec.ts` (created by TP-010) — extend
  `CompletionSpec` if a path-completion hint is needed
- `packages/plugins/src/completion/templates/{bash,zsh,fish}.ts` (created
  by TP-010) — modified to emit shell-appropriate file completion for
  `path` flags/positionals

Reference example for size/complexity and style:
- `taskplane-tasks/TP-010-completion-plugin-static/PROMPT.md`

## Environment

- **Workspace:** `packages/core/` (primary), `packages/plugins/`,
  `apps/docs/`
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

**New files in `@crustjs/core`:**
- `packages/core/src/coercers.ts` — exports `coerceUrl`, `coercePath`,
  `coerceJson`
- `packages/core/src/coercers.test.ts` — co-located tests, one `describe`
  block per coercer

**New documentation:**
- `apps/docs/content/docs/guide/built-in-types.mdx` — quick-reference table
  + per-type deep dives + `parse` escape hatch section + common pitfalls
- `apps/docs/content/docs/guide/recipes.mdx` — at least 10 copy-paste
  recipes for deferred/rejected types

**Modified files in `@crustjs/core`:**
- `packages/core/src/types.ts` — extend `ValueType`, add `Resolve<T>`
  branches for the new types, add `ResolveBaseType<F>` helper, update
  `InferFlagValue<F>` to use `ResolveBaseType<F>` and presence checks
  (`F extends { default: any }`, NOT type-equality), add new variant
  interfaces (`UrlFlagDef`, `PathFlagDef`, `JsonFlagDef`, plus the
  multi-variants where applicable, plus equivalent ArgDef variants), add
  `parse?: (raw: string) => unknown` to string variants, add
  `parse?: never` to all other variants, update `FlagDef` and `ArgDef`
  discriminated unions
- `packages/core/src/parser.ts` — dispatch on the new `ValueType` members
  (call coercers); when `parse` is present, runtime async check at command
  setup, skip the built-in coercer and call `parse` instead, per-element
  handling for `multiple: true`, default-value coercion (oracle C fix);
  when `parse` and `choices` both present, validate `choices` before
  running `parse`
- `packages/core/src/parser.test.ts` — extensive new tests (see Test
  coverage section below)
- `packages/core/src/types.test.ts` — type-level tests for `parse`
  inference and the `parse?: never` enforcement (create the file if it
  does not exist)

**Modified files in `@crustjs/plugins`:**
- `packages/plugins/src/completion/walker.ts` — recognize `url`/`path`/
  `json` types; mark `path` entries with a file-completion hint
- `packages/plugins/src/completion/spec.ts` — extend `CompletionSpec` if
  needed to carry the path-completion hint
- `packages/plugins/src/completion/templates/bash.ts` — emit `compgen -f`
  for `path` flags and positionals
- `packages/plugins/src/completion/templates/zsh.ts` — emit `_files` for
  `path`
- `packages/plugins/src/completion/templates/fish.ts` — use
  `__fish_complete_path` for `path`
- `packages/plugins/src/completion/walker.test.ts` — extend with new-type
  cases and the path-hint case
- `packages/plugins/src/completion/templates/bash.test.ts` — extend with
  a `path` snapshot
- `packages/plugins/src/completion/templates/zsh.test.ts` — extend
- `packages/plugins/src/completion/templates/fish.test.ts` — extend

**Changesets:**
- `.changeset/*-core-extend-valuetype.md` — `@crustjs/core`: minor — new
  `url`/`path`/`json` types + `parse` escape hatch (default-coercion fix
  is technically a bugfix but bundled with the feature)
- `.changeset/*-plugins-completion-path.md` — `@crustjs/plugins`: patch —
  completion templates emit file completion for `path`

## Critical Correctness Requirements (oracle review — non-negotiable)

The implementation MUST satisfy every item below. Each has a corresponding
test in the Test Coverage section.

1. **Default-value coercion fix (oracle C — CRITICAL)**: when `parse` is
   present and argv is **absent**, the parser MUST run
   `parse(String(default))` before returning. Without this fix,
   `{ type: "string", parse: Number, default: "3000" }` returns the
   string `"3000"` at runtime while TS infers `number`.
2. **Async parse rejection (oracle C)**: at command setup time, walk every
   flag/arg with a `parse` field and check
   `parse.constructor.name === "AsyncFunction"`. If true, throw
   `CrustError("CONFIG", "Async parse not supported for flag --<name>. Use a sync parser; do async work in run().")`.
   Use the appropriate phrasing for positional args (e.g. `argument <name>`).
3. **`parse` only on string variants (oracle C + D)**: compile-time
   enforcement via `parse?: never` on `NumberFlagDef`, `BooleanFlagDef`,
   `UrlFlagDef`, `PathFlagDef`, `JsonFlagDef`, every multi-value variant
   of those, and every equivalent `ArgDef` variant. Only `StringFlagDef`,
   `StringMultiFlagDef`, and `StringArgDef` accept `parse`.
4. **Multi-value `parse` runs per-element**: for `multiple: true` with
   `parse` set, the parser maps `parse` over the array of raw values. The
   inferred output type is `T[]` where `T = ReturnType<typeof parse>`.
5. **`parse` + `choices` precedence**: `choices` validates the raw argv
   string first, **then** `parse` transforms. Document this in
   `built-in-types.mdx` and add a regression test
   (`{ type: "string", choices: ["1","2"], parse: Number }` → `"1"`
   becomes `1`; `"3"` rejected by choices before `parse` ever runs).
6. **Naming**: the field name is `parse`, NOT `coerce`. Internal helper
   functions can keep descriptive names (`coerceUrl`, `coercePath`,
   `coerceJson`) — those are not user-facing field names.

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes.
> Workers expand steps when runtime discoveries warrant it. See task-worker
> agent for rules.

### Step 0: Preflight

- [ ] Confirm TP-009 is merged: `choices` field present on `FlagDef`/`ArgDef`
  in `packages/core/src/types.ts`
- [ ] Confirm TP-010 is merged: `packages/plugins/src/completion/` exists
  with `walker.ts`, `spec.ts`, and the three template files
- [ ] Confirm TP-011 is merged: `@crustjs/utils` exports `BaseValueType`
  and `ResolvePrimitive`, and `packages/core/src/types.ts` already imports
  them
- [ ] Read `/tmp/crust-types-final/FINAL.md` end-to-end and the three
  oracle reports (C, D, B)
- [ ] All existing tests pass on the current branch:
  `bun run check && bun run check:types && bun run test`

### Step 1: Extend `ValueType` and TS inference machinery

> **Review override: plan + code** — both reviews required (plan locks
> the type-level shape and the `ResolveBaseType<F>` / `InferFlagValue<F>`
> contract before any runtime work begins).

- [ ] In `packages/core/src/types.ts`: extend `ValueType` to
  `BaseValueType | "url" | "path" | "json"`
- [ ] Extend `Resolve<T>` with new branches: `"url"` → `URL`, `"path"` →
  `string`, `"json"` → `unknown`
- [ ] Add the `ResolveBaseType<F>` helper that extracts
  `ReturnType<typeof parse>` when present, otherwise falls back to
  `Resolve<F["type"]>`
- [ ] Update `InferFlagValue<F>` to use `ResolveBaseType<F>` and **presence
  checks** (`F extends { default: any }`) — NOT type-equality checks
  (avoids the circular reference oracle C flagged)
- [ ] Add new variant interfaces: `UrlFlagDef`, `PathFlagDef`,
  `JsonFlagDef`, plus the multi-value variants where applicable, plus
  equivalent `UrlArgDef`, `PathArgDef`, `JsonArgDef` (and multi where
  applicable)
- [ ] Update the `FlagDef` and `ArgDef` discriminated unions to include
  the new variants
- [ ] Add type-level tests in `packages/core/src/types.test.ts`
  (create the file if it doesn't exist) covering:
  - `InferFlags<{ x: { type: "url" } }>` → `{ x: URL | undefined }`
  - `InferFlags<{ x: { type: "path", default: "/tmp" } }>` → `{ x: string }`
  - `InferFlags<{ x: { type: "json", required: true } }>` → `{ x: unknown }`
- [ ] Run targeted tests:
  `cd packages/core && bun run check:types && bun test src/types.test.ts`

**Artifacts:**
- `packages/core/src/types.ts` (modified)
- `packages/core/src/types.test.ts` (new or modified)

### Step 2: Implement built-in coercers

- [ ] Create `packages/core/src/coercers.ts` exporting:
  - `coerceUrl(raw: string): URL` — wraps `new URL(raw)`; on
    `TypeError`, throws `CrustError("PARSE", ...)` with a hint about the
    missing protocol (include the offending input)
  - `coercePath(raw: string): string` — expands `~` against
    `os.homedir()`, then resolves against `process.cwd()` to an absolute
    path; throws `CrustError("PARSE", "...empty path...")` on empty
    input
  - `coerceJson(raw: string): unknown` — strict `JSON.parse`; on
    `SyntaxError`, throws `CrustError("PARSE", ...)` with a shell-quoting
    hint
- [ ] Create `packages/core/src/coercers.test.ts` with one `describe`
  block per coercer covering at minimum the scenarios listed in the Test
  Coverage section below
- [ ] Run targeted tests:
  `cd packages/core && bun test src/coercers.test.ts`

**Artifacts:**
- `packages/core/src/coercers.ts` (new)
- `packages/core/src/coercers.test.ts` (new)

### Step 3: Add `parse?:` field to string variants

- [ ] In `packages/core/src/types.ts`: add
  `parse?: (raw: string) => unknown` to `StringFlagDef`,
  `StringMultiFlagDef`, and `StringArgDef` (and any string-multi
  `ArgDef` variant if one exists)
- [ ] Add `parse?: never` to **every other variant**: `NumberFlagDef`,
  `BooleanFlagDef`, `UrlFlagDef`, `PathFlagDef`, `JsonFlagDef`, every
  multi-value variant of those, and every equivalent `ArgDef` variant
- [ ] Add compile-time tests in `packages/core/src/types.test.ts` that
  expect a TS error when:
  - `{ type: "number", parse: (s) => Number(s) }` is written
  - `{ type: "url", parse: (s) => s }` is written
  - `{ type: "boolean", parse: (s) => s }` is written
  Use `// @ts-expect-error` to assert each rejection.
- [ ] Add positive type-level tests for `parse` inference:
  - `InferFlags<{ x: { type: "string", parse: (s) => new URL(s) } }>` →
    `{ x: URL | undefined }`
  - `InferFlags<{ x: { type: "string", multiple: true, parse: (s) => Number(s) } }>` →
    `{ x: number[] | undefined }`
  - `InferFlags<{ x: { type: "string", parse: (s) => Number(s), required: true } }>` →
    `{ x: number }`
- [ ] Run targeted tests: `cd packages/core && bun run check:types`

**Artifacts:**
- `packages/core/src/types.ts` (modified)
- `packages/core/src/types.test.ts` (modified)

### Step 4: Wire parser dispatch and `parse` runtime semantics

> **Review override: plan + code** — both reviews required (this is the
> step that bakes in every oracle-flagged runtime correctness fix).

- [ ] In `packages/core/src/parser.ts`: extend the `coerceValue` dispatch
  to handle `"url"`, `"path"`, `"json"` by delegating to `coerceUrl`,
  `coercePath`, `coerceJson`
- [ ] At command setup time (whichever entry point validates flag/arg
  defs before running the command), iterate every flag and arg; if
  `def.parse` is set and `def.parse.constructor.name === "AsyncFunction"`,
  throw `CrustError("CONFIG", "Async parse not supported for flag --<name>. Use a sync parser; do async work in run().")`
  (use `argument <name>` phrasing for positional args)
- [ ] When `parse` is present and argv is **present**: skip the built-in
  coercer and call `parse(rawString)` instead. Wrap thrown errors so the
  `CrustError("PARSE", ...)` includes the flag/arg name
- [ ] For `multiple: true` with `parse`: map `parse` over the array of
  raw values per-element; output is `T[]`
- [ ] When `parse` is present and argv is **absent** but `default` is
  provided: call `parse(String(def.default))` and return that
  (oracle C bug fix)
- [ ] When `parse` is present and argv is absent and there is no
  `default`: return `undefined` (do NOT call `parse`)
- [ ] When `choices` is also present: validate against `choices` first
  using the **raw argv string**, then call `parse` if validation passes
- [ ] Extend `packages/core/src/parser.test.ts` with all scenarios
  listed in the Test Coverage section below — especially the
  default-coercion regression test (oracle C bug)
- [ ] Run targeted tests:
  `cd packages/core && bun test src/parser.test.ts src/coercers.test.ts`

**Artifacts:**
- `packages/core/src/parser.ts` (modified)
- `packages/core/src/parser.test.ts` (modified)

### Step 5: Update completion plugin for `path`

> ⚠️ Hydrate: After reading TP-010's `walker.ts` and `spec.ts`, expand
> the checkboxes below to track the actual `CompletionSpec` field name
> for the path-completion hint (e.g. `isPath: true`, `complete: "path"`,
> or `kind: "path"`). The exact field name depends on what TP-010 shipped.

- [ ] Read `packages/plugins/src/completion/walker.ts` and `spec.ts` to
  determine the existing `CompletionSpec` shape and the cleanest place
  to thread a path-completion hint
- [ ] Modify `walker.ts` to recognize `url`/`path`/`json` types (no spec
  change for `url`/`json` — they fall through to the default value
  completion). For `path`, mark the spec entry so templates can emit
  file completion
- [ ] Extend `spec.ts` with a path-completion hint field if needed
- [ ] Update `templates/bash.ts` to emit `compgen -f` for `path` flags
  and positional args
- [ ] Update `templates/zsh.ts` to emit `_files` for `path`
- [ ] Update `templates/fish.ts` to use `__fish_complete_path` for `path`
- [ ] Extend `walker.test.ts` with cases verifying the path hint is
  emitted for `type: "path"` on both flags and ArgDef
- [ ] Extend `templates/bash.test.ts`, `templates/zsh.test.ts`,
  `templates/fish.test.ts` with `path` snapshot cases; verify the
  existing snapshots still pass (no regression for non-path flags)
- [ ] Run targeted tests:
  `cd packages/plugins && bun test src/completion/`

**Artifacts:**
- `packages/plugins/src/completion/walker.ts` (modified)
- `packages/plugins/src/completion/spec.ts` (modified)
- `packages/plugins/src/completion/templates/{bash,zsh,fish}.ts` (modified)
- `packages/plugins/src/completion/walker.test.ts` (modified)
- `packages/plugins/src/completion/templates/{bash,zsh,fish}.test.ts` (modified)

### Step 6: Documentation

> ⚠️ Hydrate: Confirm exact MDX paths and any `meta.json` / sidebar
> conventions by reading `apps/docs/content/docs/guide/` before writing
> the new pages. If `meta.json` uses an explicit page list (not a
> wildcard), add the two new entries; if it's a wildcard, no edit needed.

- [ ] Create `apps/docs/content/docs/guide/built-in-types.mdx`:
  - Quick reference table at the top (8 rows: 5 existing —
    `string`/`number`/`boolean` + the 3 new ones — `url`/`path`/`json`)
  - Per-type sections for `url`, `path`, `json` with examples and the
    actual error messages emitted by the coercers
  - "Custom types via `parse`" section covering: when to use `parse`
    vs. `@crustjs/validate`, precedence rules (argv → choices → parse →
    output), the string-variants-only restriction, default coercion
    behavior (with the `Number, default: "3000"` example), async-parse
    rejection, per-element semantics for `multiple: true`
  - Common pitfalls list (5–10 entries from oracle D's list)
- [ ] Create `apps/docs/content/docs/guide/recipes.mdx`:
  - Brief intro distinguishing "transform" (parse) from "validate"
    (`@crustjs/validate`)
  - At least 10 copy-paste recipes covering: ISO-8601 date (strict),
    natural language date (chrono-node), duration (vendored or
    `vercel/ms`), port (number with range check), regex with
    `/pat/flags`, CIDR (with `ip-cidr` library), env-var KEY=VAL pairs,
    comma-separated list, file:// URL, BigInt, hex string → number,
    base64 decode, count emulation via `multiple: true` + `.length`
- [ ] Add a section to `packages/core/README.md` listing the new types
  and the `parse` escape hatch (with a one-paragraph example)
- [ ] Update `apps/docs/content/docs/api/types.mdx` (or whichever API
  page documents `FlagDef`/`ArgDef`/`ValueType`) to add the new types
  and the `parse` field
- [ ] Note in `apps/docs/content/docs/modules/plugins/completion.mdx`
  that `path` flags now emit file completion in all three shells
- [ ] Note in `packages/plugins/README.md` that completion now handles
  `path`
- [ ] Check `apps/docs/content/docs/guide/flags.mdx` and
  `arguments.mdx` — if they enumerate `ValueType` members, update them
- [ ] If `apps/docs/content/docs/guide/meta.json` uses an explicit page
  list, add the two new pages; if wildcard, skip

**Artifacts:**
- `apps/docs/content/docs/guide/built-in-types.mdx` (new)
- `apps/docs/content/docs/guide/recipes.mdx` (new)
- `packages/core/README.md` (modified)
- `apps/docs/content/docs/api/types.mdx` (modified, if it exists)
- `apps/docs/content/docs/modules/plugins/completion.mdx` (modified)
- `packages/plugins/README.md` (modified)
- `apps/docs/content/docs/guide/{flags,arguments}.mdx` (modified, if they
  enumerate `ValueType` members)

### Step 7: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a
> quality gate. Earlier steps used targeted tests for fast feedback.

- [ ] Run FULL test suite:
  `bun run check && bun run check:types && bun run test`
- [ ] Build passes: `bun run build`
- [ ] Manual smoke test: scaffold a tiny CLI in a temp dir using each
  new built-in type (`url`, `path`, `json`) and the `parse` escape
  hatch; verify the runtime values match the TS-inferred types (use
  `console.log` or assertions). Include the
  `{ parse: Number, default: "3000" }` regression case
- [ ] Add 2 changesets via `bunx changeset`:
  - `@crustjs/core`: minor — new `url`/`path`/`json` types + `parse`
    escape hatch
  - `@crustjs/plugins`: patch — completion templates emit file
    completion for `path`

### Step 8: Documentation & Delivery

- [ ] Verify `built-in-types.mdx` and `recipes.mdx` render correctly:
  `bun run build --filter=docs`
- [ ] All "Must Update" docs modified
- [ ] All "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md

## Test Coverage Requirements

The PROMPT.md requires tests for at minimum every scenario below. Workers
may add more; they may NOT skip these.

**Built-in coercers** (one test per scenario, in `coercers.test.ts`):
- `coerceUrl("https://example.com")` → `URL` instance with the right
  `href`
- `coerceUrl("not-a-url")` throws `CrustError("PARSE", ...)` with a hint
  about the missing protocol
- `coercePath("./foo")` → absolute path resolved against `process.cwd()`
- `coercePath("~/foo")` → expanded against `os.homedir()`
- `coercePath("")` throws `CrustError("PARSE", "...empty path...")`
- `coerceJson('{"k":1}')` → `{ k: 1 }`
- `coerceJson("not json")` throws `CrustError("PARSE", ...)`

**`parse` escape hatch** (in `parser.test.ts`):
- Basic: `{ type: "string", parse: (s) => Number(s) }` → runtime `number`
- Multi-value: `{ type: "string", multiple: true, parse: (s) => Number(s) }`
  → runtime `number[]` (per-element)
- With `required: true`: TS-level test that the parsed value type is
  non-optional
- With `default` + argv **absent**: **regression test for oracle C bug** —
  `{ type: "string", parse: (s) => Number(s), default: "3000" }` returns
  `3000` (number) when argv is absent, NOT `"3000"` (string)
- With `default` + argv **present**: `parse` runs on the argv value;
  `default` is ignored
- Async parse rejection:
  `{ type: "string", parse: async (s) => fetch(s) }` throws
  `CrustError("CONFIG", ...)` at command setup (NOT at parse time)
- `parse` + `choices`: choices validates raw input first; e.g.
  `{ type: "string", choices: ["1","2"], parse: Number }` accepts
  `"1"` (becomes `1`), rejects `"3"` with the choices error before
  `parse` runs
- Error path: a `parse` function that throws produces a
  `CrustError("PARSE", ...)` with the flag name attached

**Type-level (compile-only) tests** (in `types.test.ts`):
- `InferFlags<{ x: { type: "url" } }>` includes `x: URL | undefined`
- `InferFlags<{ x: { type: "path", default: "/tmp" } }>` includes
  `x: string` (no `undefined`, has default)
- `InferFlags<{ x: { type: "string", parse: (s) => new URL(s) } }>`
  includes `x: URL | undefined`
- `InferFlags<{ x: { type: "string", multiple: true, parse: (s) => Number(s) } }>`
  includes `x: number[] | undefined`
- `// @ts-expect-error` — `parse` set on `type: "number"` is a TS error
- `// @ts-expect-error` — `parse` set on `type: "url"` is a TS error

**Completion templates** (in the existing test files):
- Walker emits the path hint for `type: "path"` on both flags and
  ArgDef
- Bash template emits `compgen -f` for path flags
- Zsh template emits `_files` for path flags
- Fish template uses `__fish_complete_path` for path flags
- Existing snapshot tests still pass (no regression for non-path flags)

## Documentation Requirements

**Must Update:**
- `apps/docs/content/docs/guide/built-in-types.mdx` (NEW) — quick-reference
  table + per-type deep dives + `parse` escape hatch + common pitfalls
- `apps/docs/content/docs/guide/recipes.mdx` (NEW) — at least 10 recipes
- `packages/core/README.md` — add a section listing the new types and the
  `parse` escape hatch
- `apps/docs/content/docs/api/types.mdx` (or whichever API page documents
  `FlagDef`/`ArgDef`/`ValueType`) — add the new types and `parse` field

**Check If Affected:**
- `apps/docs/content/docs/guide/flags.mdx` — update if it enumerates
  `ValueType` members
- `apps/docs/content/docs/guide/arguments.mdx` — same
- `apps/docs/content/docs/modules/plugins/completion.mdx` — note that
  `path` now emits file completion
- `packages/plugins/README.md` — note completion's new `path` handling

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing (full suite green)
- [ ] Build green (`bun run build`)
- [ ] Docs build green (`bun run build --filter=docs`)
- [ ] Two changesets added (`@crustjs/core` minor,
  `@crustjs/plugins` patch)
- [ ] All six "Critical Correctness Requirements" verifiable by tests

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All
commits for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-012): complete Step N — description`
- **Bug fixes:** `fix(TP-012): description`
- **Tests:** `test(TP-012): description`
- **Hydration:** `hydrate: TP-012 expand Step N checkboxes`

## Do NOT

- Do NOT add `date`, `duration`, `port`, `regex`, `count`, `bytes`,
  `bigint`, `hex`, `base64`, `file`, `dir`, `email`, `uuid`, `ip`, or
  `enum` types in this task — all deferred to recipes or rejected by
  design. Stick to `url`/`path`/`json`.
- Do NOT name the field `coerce` — it must be `parse`. Internal helper
  function names (`coerceUrl`, `coercePath`, `coerceJson`) are fine
  because they're not user-facing field names.
- Do NOT allow `parse` on non-string variants — TypeScript-level
  enforcement via `parse?: never` on every other variant.
- Do NOT support async `parse` — runtime check rejects async functions
  at command setup time with a `CrustError("CONFIG", ...)`.
- Do NOT skip the default-coercion bug fix — when `parse` is present
  and argv is absent, `parse` MUST run on the default value.
- Do NOT plumb consolidation through `@crustjs/validate` (deferred per
  CONTEXT.md tech debt).
- Do NOT switch to a factory pattern (`Flags.url()`); deferred to
  post-1.0 architectural review.
- Do NOT change existing `string` / `number` / `boolean` semantics —
  this task is purely additive.
- Do NOT remove the deprecation alias `autoCompletePlugin` (TP-008's
  concern).
- Do NOT modify the `@crustjs/validate` package or its types.
- Do NOT walk the command tree at completion-plugin `setup()` time —
  TP-010 walks lazily inside `run()`; preserve that behavior.
- Do NOT expand task scope — add tech debt to
  `taskplane-tasks/CONTEXT.md` instead.
- Do NOT skip tests.
- Do NOT modify framework/standards docs without explicit user approval.
- Do NOT load docs not listed in "Context to Read First".
- Do NOT commit without the `TP-012` prefix in the commit message.

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
