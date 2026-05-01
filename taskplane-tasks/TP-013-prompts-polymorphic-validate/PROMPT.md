# Task: TP-013 — Make `@crustjs/prompts` `validate` field polymorphic (function OR Standard Schema)

**Created:** 2026-05-02
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Additive change to the public API of a published package
(`@crustjs/prompts`). The existing function-shape `validate?: ValidateFn<string>`
still works unchanged; the new schema-shape extends `input()` and `password()`
to return the schema's parsed output type. Plan review locks the type-overload
strategy and the runtime dispatch on `~standard.vendor`. No security or data
model concerns.
**Score:** 3/8 — Blast radius: 1, Pattern novelty: 1 (polymorphic-typed slot is new in this codebase), Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-013-prompts-polymorphic-validate/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Today, `input()` and `password()` from `@crustjs/prompts` always return
`Promise<string>`. Users who want a typed/transformed value (e.g. a number
from a numeric prompt) must validate inline AND re-parse afterwards via
`parsePromptValue` from `@crustjs/validate` — two passes, schema repeated.

Make the existing `validate?:` slot **polymorphic**: it accepts either today's
function (`ValidateFn<string>`, returns `true | string`) **or** a Standard
Schema v1 object. When a Standard Schema is provided, the prompt:

1. Validates inline by calling `schema['~standard'].validate(submitValue)` on Enter.
2. Renders only the **first** issue's `message` inline on rejection (single line).
3. On valid submit, returns the schema's transformed output (`InferOutput<S>`)
   instead of the raw `string`.

End state for users:

```ts
// Function shape — unchanged
input({ message: "Name?", validate: (v) => v.length > 0 || "required" });
//    ^? Promise<string>

// Schema shape — NEW
input({ message: "Port?", validate: z.coerce.number().int().min(1) });
//    ^? Promise<number>
```

This is **additive**: existing function-shape consumers are unaffected. The
new schema-shape eliminates the two-pass `validate + parsePromptValue` pattern
that motivated the alignment work.

## Dependencies

- **None**

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `packages/prompts/src/prompts/input.ts` — current `input()` implementation; validate runs on Enter (lines 60–79)
- `packages/prompts/src/prompts/password.ts` — current `password()` implementation; same validation pattern as input
- `packages/prompts/src/core/types.ts` — `ValidateFn<T>` and `ValidateResult` definitions (lines 83–105)
- `packages/prompts/src/core/renderer.ts` — error rendering integration (`physicalLineCount` correctly handles multi-line errors but we will only render single-line)
- `packages/prompts/src/index.ts` — public re-exports
- `packages/prompts/package.json` — to be modified: add `@standard-schema/spec` as a regular dependency (~5 KB, type + minimal runtime)
- `apps/docs/content/docs/modules/prompts.mdx` — public docs to update

## Environment

- **Workspace:** `packages/prompts/` (primary), `apps/docs/`
- **Services required:** None

## File Scope

**Modified:**
- `packages/prompts/src/prompts/input.ts` (polymorphic validate slot, generic over schema output)
- `packages/prompts/src/prompts/password.ts` (same change as input)
- `packages/prompts/src/core/types.ts` (export a small `StandardSchemaV1`-discriminated union helper if useful)
- `packages/prompts/src/index.ts` (re-export any new types)
- `packages/prompts/src/prompts/input.test.ts` (add schema-path tests)
- `packages/prompts/src/prompts/password.test.ts` (add schema-path tests)
- `packages/prompts/package.json` (add `@standard-schema/spec` dependency; bump to `0.2.0`)
- `packages/prompts/README.md` (add schema usage section)
- `apps/docs/content/docs/modules/prompts.mdx` (add schema usage section)
- `.changeset/*.md` (new — minor bump for `@crustjs/prompts`)

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes.
> Workers expand steps when runtime discoveries warrant it.

### Step 0: Preflight

- [ ] Required files and paths exist (`packages/prompts/src/prompts/input.ts`, `password.ts`, `core/types.ts`)
- [ ] `bun install` succeeds from a clean `bun.lock`
- [ ] Existing test suites pass before any edits: `bun run --cwd packages/prompts test`

### Step 1: Add `@standard-schema/spec` dependency to `@crustjs/prompts`

- [ ] Add `"@standard-schema/spec": "^1.1.0"` to `packages/prompts/package.json` `dependencies` (matches the version `@crustjs/validate` already pins, avoiding workspace-level version drift)
- [ ] Add `"zod": "^4.0.0"` to `packages/prompts/package.json` `devDependencies` (test fixtures only — schema-path tests in Step 4 use Zod schemas; production code path stays decoupled from any schema library)
- [ ] Run `bun install` and confirm `bun.lock` updates cleanly
- [ ] Verify the import works: a smoke `import type { StandardSchemaV1 } from "@standard-schema/spec"` should type-check from inside `packages/prompts/src/`

**Artifacts:**
- `packages/prompts/package.json` (modified — dependencies + devDependencies)
- `bun.lock` (modified)

### Step 2: Make `input()` polymorphic on `validate`

> **Locked design decisions** (from grilling session — do NOT re-litigate):
> - The existing `validate?: ValidateFn<string>` shape stays. Discrimination at runtime via `isStandardSchema(opts.validate)` (a 3-line type guard checking `value['~standard']?.version === 1`).
> - On schema rejection, render ONLY the first issue's `message` inline. **No `errorStrategy` option exposed** — single rendering rule, no toggle.
> - On schema success, submit `result.value` (the parsed/transformed output), NOT the raw `submitValue`.
> - Schema validate may return a `Promise` per spec — `await` it.
> - If schema returns issues with empty message strings (rare), fall back to `"Validation failed"`.

- [ ] Make `InputOptions<T = string>` generic
- [ ] Add overloaded signature: when `validate: StandardSchemaV1<unknown, T>`, return type is `Promise<T>`. When `validate?: ValidateFn<string>` (or omitted), return type stays `Promise<string>`. Use TypeScript function overloads, not conditional types — the maintenance story is clearer.
- [ ] Inside `createHandleKey()`, detect schema vs function via inline `isStandardSchema(validate)` helper (define locally — do NOT import from `@crustjs/validate` to keep the dependency boundary). When schema: `await schema['~standard'].validate(submitValue)`. On `result.issues`, set `state.error = result.issues[0]?.message ?? "Validation failed"`. On success, submit `result.value`.
- [ ] Preserve all existing behavior for the function-shape path (no regressions).

**Artifacts:**
- `packages/prompts/src/prompts/input.ts` (modified)
- `packages/prompts/src/core/types.ts` (modified — may export the `StandardSchemaV1`-aware option type)

### Step 3: Apply the same change to `password()`

- [ ] Mirror Step 2 for `password.ts` — same polymorphic shape, same overloads, same dispatch.
- [ ] Confirm `confirm()` and `select()` are NOT touched (they don't have a `validate` slot today and stay unchanged).

**Artifacts:**
- `packages/prompts/src/prompts/password.ts` (modified)

### Step 4: Tests for the schema path

> Tests use Zod (added as a devDep in Step 1). Production code paths stay
> schema-library-agnostic; Zod is the test fixture only.

- [ ] Add tests in `input.test.ts`:
  - `input({ validate: z.string().min(3) })` resolves to `string` on valid input
  - `input({ validate: z.coerce.number() })` resolves to `number` (transformed) on valid string input like `"42"`
  - On invalid input, the prompt re-renders with the first issue's message and waits for retry (use the existing test harness pattern)
  - Async schema (`z.string().refine(async (v) => …)`) — the prompt awaits during validation
- [ ] Add equivalent tests in `password.test.ts` (at least: valid string, invalid string, transformed coerce-number)
- [ ] Existing function-shape tests must remain green unchanged

**Artifacts:**
- `packages/prompts/src/prompts/input.test.ts` (modified)
- `packages/prompts/src/prompts/password.test.ts` (modified)

### Step 5: Documentation

- [ ] `packages/prompts/README.md`: add a "Schema validation" subsection under the existing `validate` option docs. Include a 5-line Zod example and a 5-line Effect example. Mention that the schema's transformed output is returned (no second-pass parse needed).
- [ ] `apps/docs/content/docs/modules/prompts.mdx`: same content, formatted for the docs site. Cross-link to `validate.mdx` for the parallel concept on commands.
- [ ] Add a changeset: `bunx changeset` → minor bump for `@crustjs/prompts`. Description: "Add Standard Schema v1 support to `validate` slot on `input()` and `password()`. Schemas now produce typed/transformed return values."

**Artifacts:**
- `packages/prompts/README.md` (modified)
- `apps/docs/content/docs/modules/prompts.mdx` (modified)
- `.changeset/<auto-name>.md` (new)

### Step 6: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] `bun run check` (Biome lint+format) clean across the workspace
- [ ] `bun run check:types` (tsc) clean across all packages
- [ ] `bun run test` — full test suite green
- [ ] Manual smoke (TTY): in `apps/demo-validate` (existing), open a temporary subcommand and invoke `input({ validate: z.coerce.number() })`. Confirm the returned value is `typeof === "number"`. Discard the smoke change before commit.

### Step 7: Documentation & Delivery

- [ ] All "Must Update" docs modified (README, prompts.mdx, changeset)
- [ ] "Check If Affected" docs reviewed (validate.mdx — note that PR follow-up TP-014 will tighten cross-links)
- [ ] Discoveries logged in STATUS.md (e.g. any unexpected interaction between schema validation and the renderer's `state.error` clearing on next keystroke)

## Documentation Requirements

**Must Update:**
- `packages/prompts/README.md` — add Schema validation section
- `apps/docs/content/docs/modules/prompts.mdx` — add Schema validation section
- `.changeset/*.md` — minor bump for `@crustjs/prompts`

**Check If Affected:**
- `apps/docs/content/docs/modules/validate.mdx` — its "See also" anchors to prompts.mdx may need refresh in TP-015

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing (workspace-wide)
- [ ] Documentation updated
- [ ] Changeset created (minor bump)

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-013): complete Step N — description`
- **Bug fixes:** `fix(TP-013): description`
- **Tests:** `test(TP-013): description`
- **Hydration:** `hydrate: TP-013 expand Step N checkboxes`

## Do NOT

- Add `@crustjs/validate` as a dependency to `@crustjs/prompts`. The dependency
  boundary stays clean. Use `@standard-schema/spec` directly.
- Add an `errorStrategy` option to `InputOptions` / `PasswordOptions`. The
  single-rule "first issue, single line" rendering is locked. Multi-issue
  rendering is out of scope (and the helper that previously enabled it,
  `promptValidator`, is being removed in TP-014).
- Touch `confirm()`, `select()`, `multiselect()`, `filter()` — they don't have
  `validate` slots today and stay unchanged.
- Modify `@crustjs/validate` in this PR. The validate-side cleanup (renames,
  helper deletions, new `field()`) is owned by TP-014.
- Modify `apps/demo-validate/`. The demo rewrite is owned by TP-015 and
  depends on both this task and TP-014 having merged.
- Expand task scope — log tech debt to `taskplane-tasks/CONTEXT.md#tech-debt--known-issues` instead.
- Skip tests
- Modify framework/standards docs without explicit user approval
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->

### Amendment 1 — 2026-05-03 (supervisor pre-flight)
**Issue:** PROMPT references a manual smoke test in `apps/demo-validate`
("existing"). The demo app has been deleted from the repo and dropped
from scope (see TP-015 Amendment 1).

**Resolution:** When performing the optional manual TTY smoke test, do **not**
use `apps/demo-validate`. Instead, create a temp directory with a minimal
script (`/tmp/tp-013-smoke/test.ts`) that imports `input` from
`@crustjs/prompts` and a Standard Schema (`zod` is fine) and invokes
`input({ validate: z.coerce.number() })`. Run it with `bun run` and
confirm the returned value is `typeof === "number"`. Discard the temp
directory after. The smoke test remains optional — the polymorphic
branch is fully covered by the test additions in `input.test.ts` and
`password.test.ts`, so this is just a sanity check on real TTY input.

**Source:** Operator decision 2026-05-03, see TP-015 amendment for context.
