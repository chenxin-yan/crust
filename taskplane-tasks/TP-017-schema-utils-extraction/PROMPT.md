# Task: TP-017 — Extract `@crustjs/schema-utils` package from `@crustjs/validate`

**Created:** 2026-05-07
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds a new published `@crustjs/*` package to the ecosystem and
moves load-bearing introspection logic out of `@crustjs/validate`. No behavior
change — every call site continues to receive identical inferred metadata.
Plan review locks the public surface of the new package and confirms the
`@crustjs/validate` re-export shape so TP-014's locked surface stays intact.
Code review verifies that the moved Zod/Effect adapters keep their byte-level
behavior (especially the sync default-extraction matrix) and that the
`introspect/registry.test.ts` matrix passes unchanged inside the new package.
**Score:** 5/8 — Blast radius: 2 (`@crustjs/validate` consumers transitively
depend on the new package), Pattern novelty: 1 (mirrors TP-005 `@crustjs/utils`
extraction pattern), Security: 0, Reversibility: 2 (new published package +
imports rewritten across two packages — pre-1.0 minor break only if the
re-export surface is misjudged).

## Canonical Task Folder

```
taskplane-tasks/TP-017-schema-utils-extraction/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Stand up `@crustjs/schema-utils`, a new published workspace package that
contains the **vendor-aware Standard Schema introspection layer** currently
embedded inside `@crustjs/validate`. After this task, both `@crustjs/validate`
(for command/flag/arg helpers) and `@crustjs/store` (for store-field metadata
extraction in TP-018) can depend on a single source of truth for schema
introspection without circular coupling and without forcing schema-utils to
ship validate's `arg`/`flag`/`middleware` runtime to store consumers.

The extraction is a **pure code move** — no behavior changes, no API renames,
no runtime semantic shifts. The currently-exported helpers move into
`@crustjs/schema-utils`; `@crustjs/validate` re-imports them and continues
to expose the surface its public consumers rely on through TP-014's locked
8-function root surface.

The cross-package contract is **Standard Schema v1**, not Crust-specific —
introspection here means "given any `StandardSchemaV1`, recover what a CLI
or store needs (`type`, `array`, `description`, `default`, normalized issues)
through a vendor dispatch on `~standard.vendor`". This is exactly what
`@crustjs/validate`'s `src/introspect/` directory does today; the move
decouples it from the validate package's command/flag concerns.

This task **enables** TP-018 (store schema transforms + introspection API),
which depends on schema-utils being available before store grows a
`store.fields()` introspection surface and a slim `field()` helper.

## Dependencies

- **External:** `@crustjs/validate` is at the post-TP-014 layout — single
  Standard-Schema-first root with `src/introspect/{registry,zod,effect}.ts`,
  `src/validate.ts` containing `assertStandardSchema`, `isStandardSchema`,
  `normalizeStandardIssues`, `normalizeStandardPath`, `validateStandard`,
  `validateStandardSync`, `success`, `failure`, and the locked 8-function
  root export surface from TP-014. The current branch satisfies this.
- **External:** TP-014 is merged (the post-rename validate API is the
  starting point — `arg`, `flag`, `commandValidator`, `field`, `parseValue`,
  `validateStandard`, `validateStandardSync`, `isStandardSchema`).

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `taskplane-tasks/TP-005-crustjs-utils-package/PROMPT.md` — reference pattern
  for adding a new published `@crustjs/*` package; copy bunup/tsconfig/package.json
  shape, README pre-stability framing, and docs registration steps.
- `taskplane-tasks/TP-014-validate-api-alignment/PROMPT.md` — locked
  `@crustjs/validate` surface and design constants (synchronous extraction,
  silent fallback for vendors without sync defaults). The new package must
  preserve every guarantee TP-014 documents.
- `packages/validate/src/introspect/registry.ts` — the canonical
  `inferOptions(schema, kind, label)` dispatch and `extractDefault(schema)`
  helper. **Move verbatim** to `packages/schema-utils/src/introspect.ts`
  (or split as the new package layout dictates), not rewritten.
- `packages/validate/src/introspect/zod.ts` — Zod adapter (`inferFromZod`,
  `extractZodDefault`, `resolveZodDescription`, vendor-internal walkers).
  Move verbatim.
- `packages/validate/src/introspect/effect.ts` — Effect adapter
  (`inferFromEffect`, `extractEffectDefault`, AST walkers). Move verbatim.
- `packages/validate/src/introspect/registry.test.ts` — the matrix test
  that pins per-vendor inference. Move with the code; it must pass
  inside the new package without modification.
- `packages/validate/src/validate.ts` — contains `assertStandardSchema`,
  `isStandardSchema`, `normalizeStandardIssues`, `normalizeStandardPath`,
  plus `validateStandard`/`validateStandardSync`/`success`/`failure`/
  `ValidationResult`/`ValidationIssue` types. **Split decision:**
  the assertion + issue-normalization helpers (load-bearing for both the
  command and the future store path) move into `@crustjs/schema-utils`;
  `validateStandard` / `validateStandardSync` / `success` / `failure` and
  `ValidationResult` / `ValidationIssue` types **remain in
  `@crustjs/validate`** because they're part of TP-014's locked root
  export surface and only the validate runtime consumes them.
- `packages/validate/src/types.ts` — exports `StandardSchema` /
  `InferOutput` type aliases. Schema-utils needs the same types; export
  them from schema-utils and have validate re-export from there to keep
  one source of truth.
- `packages/utils/package.json` and `packages/utils/bunup.config.ts` —
  reference shape for a small published `@crustjs/*` package created
  via TP-005.
- `packages/store/package.json` — second example of a published
  workspace package (`"type": "module"`, ESM, `exports.import` shape).
- `apps/docs/content/docs/modules/meta.json` — docs site page registration
  (add `schema-utils` page).

**Reference research (already conducted; do NOT re-research unless contradicted):**

- Standard Schema v1 spec: only `~standard.{version, vendor, validate}`
  is portable at runtime. Source: https://standardschema.dev/schema
- Vendor-neutral default fallback via `validate(undefined)` works for Zod
  with `.default(...)`, Valibot, ArkType. Effect schemas using
  `Schema.annotations({ default })` (vs `optionalWith({ default })`) do NOT
  inject defaults during decode. Source: TP-014 reference research.
- `@standard-schema/spec` is types-only (pure `.d.ts`, zero runtime JS) —
  declaring it as a runtime `dependencies` entry costs zero bundle bytes.
  Already a runtime dep of `@crustjs/validate`. The new package depends
  on it directly.

## Environment

- **Workspace:** `packages/schema-utils/` (new, primary), `packages/validate/`
  (refactor — re-export and import-rewrite), `apps/docs/` (docs registration)
- **Services required:** None

## File Scope

**New (the schema-utils package):**

- `packages/schema-utils/package.json` (new — `@crustjs/schema-utils`,
  version `0.0.1`, `"type": "module"`, ESM-only `exports`, peer
  `typescript`, runtime dep `@standard-schema/spec`, dev deps mirroring
  `packages/utils/package.json`)
- `packages/schema-utils/tsconfig.json` (new — extend
  `@crustjs/config/tsconfig` like other workspace packages)
- `packages/schema-utils/bunup.config.ts` (new — mirror
  `packages/utils/bunup.config.ts` shape)
- `packages/schema-utils/README.md` (new — pre-stability framing matching
  `@crustjs/utils`'s 0.0.1 README; document the 4 helper groups +
  `StandardSchema`/`InferOutput` types; point readers at
  `@crustjs/validate` and `@crustjs/store` as the primary consumers)
- `packages/schema-utils/src/index.ts` (new — barrel re-exports)
- `packages/schema-utils/src/introspect.ts` (new — `inferOptions`,
  `InferredOptions`, `extractDefault`, `ExtractedDefault`; merged from
  the moved `registry.ts`)
- `packages/schema-utils/src/zod.ts` (new — moved verbatim from
  `packages/validate/src/introspect/zod.ts`)
- `packages/schema-utils/src/effect.ts` (new — moved verbatim from
  `packages/validate/src/introspect/effect.ts`)
- `packages/schema-utils/src/issues.ts` (new — `normalizeStandardIssues`,
  `normalizeStandardPath`, plus `ValidationIssue` type if it relocates;
  see Step 3 split decision)
- `packages/schema-utils/src/assertions.ts` (new — `assertStandardSchema`,
  `isStandardSchema`)
- `packages/schema-utils/src/types.ts` (new — `StandardSchema`,
  `InferOutput` type aliases; identical to current
  `packages/validate/src/types.ts`)
- `packages/schema-utils/src/introspect.test.ts` (new — moved verbatim
  from `packages/validate/src/introspect/registry.test.ts`)
- `packages/schema-utils/tests/.gitkeep` (new — match repo convention if
  package layout uses a `tests/` folder)

**Modified (validate refactor — same commit):**

- `packages/validate/package.json` (add `"@crustjs/schema-utils":
  "workspace:*"` to `dependencies`; bump to `0.3.0`; update changeset
  if validate's runtime surface changes — it does NOT, see Step 4)
- `packages/validate/src/index.ts` (rewrite the `validate.ts` /
  `introspect/registry.ts` re-exports to import from
  `@crustjs/schema-utils`; preserve the locked 8-function root export
  surface from TP-014 byte-identically)
- `packages/validate/src/validate.ts` (delete the assertion +
  issue-normalization helpers; re-export them from
  `@crustjs/schema-utils` so internal callers inside the validate
  package keep working; keep `validateStandard`,
  `validateStandardSync`, `success`, `failure`, `ValidationResult`,
  `ValidationIssue`)
- `packages/validate/src/types.ts` (re-export `StandardSchema`,
  `InferOutput` from `@crustjs/schema-utils`; do NOT define
  duplicates)
- `packages/validate/src/store.ts` (rewrite imports: pull
  `inferOptions`, `extractDefault`, `assertStandardSchema`,
  `normalizeStandardIssues` from `@crustjs/schema-utils` instead of
  in-package paths; the `field()` factory body is unchanged)
- `packages/validate/src/parse.ts` (rewrite imports: pull
  `assertStandardSchema` from `@crustjs/schema-utils`)
- `packages/validate/src/middleware.ts` (rewrite imports as needed)
- `packages/validate/src/schema.ts` (rewrite imports as needed)
- All other validate sources that previously imported from
  `./introspect/registry`, `./introspect/zod`, `./introspect/effect`,
  or the moved validate-side helpers
- `packages/validate/tests/*` (rewrite imports if any test file pulled
  internal helpers from in-package paths instead of via the public
  root export)
- `apps/docs/content/docs/modules/meta.json` (register the new
  `schema-utils` page in module navigation)
- `apps/docs/content/docs/modules/schema-utils.mdx` (new — short
  module reference page describing the four helper groups; pre-stability
  warning; primary audience: package authors building on Standard Schema)
- `README.md` (root — add `schema-utils` to the package list table if
  one exists; cross-reference is fine)
- `CONTRIBUTING.md` (add `schema-utils` to the workspace package list if
  it enumerates them)
- `.changeset/*.md` (NEW — single changeset; minor bump for
  `@crustjs/validate` if its surface changes (it shouldn't — verify), and
  `0.0.1` initial release for `@crustjs/schema-utils`)

**Deleted (from `packages/validate/src/`, post-move):**

- `packages/validate/src/introspect/registry.ts`
- `packages/validate/src/introspect/zod.ts`
- `packages/validate/src/introspect/effect.ts`
- `packages/validate/src/introspect/registry.test.ts`
- `packages/validate/src/introspect/` (empty directory)

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual file moves.
> Workers expand steps when runtime discoveries warrant it.

### Step 0: Preflight

- [ ] Required files and paths exist; current `packages/validate/src/introspect/`
      contains the four files referenced in File Scope
- [ ] Test suite green pre-edit:
      `bun run --cwd packages/validate test`
      `bun run --cwd packages/validate check:types`
- [ ] Confirm TP-014 has landed (locked surface present in
      `packages/validate/src/index.ts`)

### Step 1: Scaffold `@crustjs/schema-utils` package

> Mirror TP-005's `@crustjs/utils` extraction pattern: package.json,
> tsconfig, bunup config, README, src/index.ts. Pre-stability framing in
> README explicit (version `0.0.1`, surface unstable until 0.1.0,
> recommend pinning).

- [ ] Create `packages/schema-utils/package.json` with `name`
      `@crustjs/schema-utils`, `version` `0.0.1`, `"type": "module"`,
      ESM-only `exports`, `dependencies` including
      `@standard-schema/spec`, peer `typescript`, dev deps mirroring
      `packages/utils/package.json` (bunup, biome, etc.)
- [ ] Create `packages/schema-utils/tsconfig.json` extending the shared
      `@crustjs/config` tsconfig
- [ ] Create `packages/schema-utils/bunup.config.ts` mirroring
      `packages/utils/bunup.config.ts`
- [ ] Create `packages/schema-utils/README.md` with pre-stability framing
      matching `@crustjs/utils`; document the four helper groups
      (`introspect`, `assertions`, `issues`, `types`); link to
      `@crustjs/validate` and `@crustjs/store` as primary consumers
- [ ] Create `packages/schema-utils/src/index.ts` empty barrel
      (re-exports populated in Step 2)
- [ ] Run `bun install` to register the workspace package

**Artifacts:**
- `packages/schema-utils/package.json` (new)
- `packages/schema-utils/tsconfig.json` (new)
- `packages/schema-utils/bunup.config.ts` (new)
- `packages/schema-utils/README.md` (new)
- `packages/schema-utils/src/index.ts` (new — empty barrel)

### Step 2: Move introspection sources verbatim

> Move the four files from `packages/validate/src/introspect/` into
> `packages/schema-utils/src/`. **Verbatim** — no logic changes, no
> renames, no API shifts. Tests must pass byte-for-byte after the
> import paths are rewritten.

- [ ] Move `packages/validate/src/introspect/registry.ts` →
      `packages/schema-utils/src/introspect.ts` (rename file; export
      `inferOptions`, `InferredOptions`, `extractDefault`,
      `ExtractedDefault`; rewrite internal imports of `./zod` /
      `./effect` to the new co-located paths)
- [ ] Move `packages/validate/src/introspect/zod.ts` →
      `packages/schema-utils/src/zod.ts` (rewrite type imports of
      `../types` to `./types`)
- [ ] Move `packages/validate/src/introspect/effect.ts` →
      `packages/schema-utils/src/effect.ts` (rewrite type imports
      similarly)
- [ ] Move `packages/validate/src/introspect/registry.test.ts` →
      `packages/schema-utils/src/introspect.test.ts` (rewrite
      relative test imports to point at the new co-located sources)
- [ ] Delete the now-empty `packages/validate/src/introspect/` directory
- [ ] Add `src/types.ts` with `StandardSchema` and `InferOutput` type
      aliases identical to the current
      `packages/validate/src/types.ts` definitions
- [ ] Run targeted tests:
      `bun test packages/schema-utils/src/introspect.test.ts`

**Artifacts:**
- `packages/schema-utils/src/introspect.ts` (new — moved registry)
- `packages/schema-utils/src/zod.ts` (new — moved verbatim)
- `packages/schema-utils/src/effect.ts` (new — moved verbatim)
- `packages/schema-utils/src/introspect.test.ts` (new — moved verbatim)
- `packages/schema-utils/src/types.ts` (new — type aliases)
- `packages/validate/src/introspect/` (deleted directory)

### Step 3: Move assertions and issue-normalization helpers

> Split `packages/validate/src/validate.ts` into two: schema-utils owns
> the type-guards / boundary assertions / issue normalization (used by
> any consumer of Standard Schema, including the future store path);
> `@crustjs/validate` keeps the validation-result types and
> `validateStandard` / `validateStandardSync` runtime (those live with
> the command/flag/arg helpers and the locked TP-014 root surface).

- [ ] Create `packages/schema-utils/src/assertions.ts` with the moved
      `assertStandardSchema(value, label)` and `isStandardSchema(value)`
      from validate's `validate.ts`
- [ ] Create `packages/schema-utils/src/issues.ts` with the moved
      `normalizeStandardIssues(issues)` and `normalizeStandardPath(path)`
      from validate's `validate.ts`. Carry the `ValidationIssue` type
      with these helpers if it's the simpler split (otherwise keep the
      type in `@crustjs/validate` and have schema-utils issues helpers
      return a structurally identical shape — worker decides during
      review of the split, plan-locked answer is "move the type to
      schema-utils" since command middleware also consumes it through
      the helper output)
- [ ] Update `packages/validate/src/validate.ts`: re-export
      `assertStandardSchema`, `isStandardSchema`,
      `normalizeStandardIssues`, `normalizeStandardPath` from
      `@crustjs/schema-utils` so internal callers (`store.ts`,
      `parse.ts`, `middleware.ts`, `schema.ts`) keep their imports
      working without changing every call site. Keep `validateStandard`,
      `validateStandardSync`, `success`, `failure`,
      `ValidationResult`, and (decision-pending) `ValidationIssue`
      defined here.

**Artifacts:**
- `packages/schema-utils/src/assertions.ts` (new — moved)
- `packages/schema-utils/src/issues.ts` (new — moved)
- `packages/validate/src/validate.ts` (modified — re-exports + slim
  retained surface)

### Step 4: Wire validate to depend on schema-utils

> Add the workspace dep, populate the schema-utils barrel, and rewrite
> validate's internal imports to read from `@crustjs/schema-utils`.

- [ ] Add `"@crustjs/schema-utils": "workspace:*"` to
      `packages/validate/package.json` `dependencies`
- [ ] Populate `packages/schema-utils/src/index.ts` with the public
      surface: `inferOptions`, `extractDefault`, `InferredOptions`,
      `ExtractedDefault`, `assertStandardSchema`, `isStandardSchema`,
      `normalizeStandardIssues`, `normalizeStandardPath`,
      `StandardSchema`, `InferOutput`, plus `ValidationIssue` if Step 3
      moved the type
- [ ] Rewrite `packages/validate/src/types.ts` to re-export
      `StandardSchema` and `InferOutput` from
      `@crustjs/schema-utils` (no duplicate type definitions in this
      monorepo)
- [ ] Confirm `packages/validate/src/index.ts` continues to export the
      locked TP-014 surface byte-for-byte (`arg`, `flag`,
      `commandValidator`, `field`, `parseValue`, `validateStandard`,
      `validateStandardSync`, `isStandardSchema` plus type re-exports)
- [ ] Run `bun install` to register the dependency edge
- [ ] Run targeted tests:
      `bun run --cwd packages/validate test`
      `bun run --cwd packages/validate check:types`

**Artifacts:**
- `packages/validate/package.json` (modified — workspace dep added)
- `packages/schema-utils/src/index.ts` (modified — populated)
- `packages/validate/src/types.ts` (modified — re-exports)

### Step 5: Docs registration

> Add a module reference page for `@crustjs/schema-utils` mirroring the
> shape used by `@crustjs/utils` and the other modules.

- [ ] Create `apps/docs/content/docs/modules/schema-utils.mdx` with
      a short reference: install, exports list, two example snippets
      (one calling `inferOptions(z.string().describe("hello"), "field",
      "label")`, one calling `extractDefault(z.number().default(3000))`),
      and a pre-stability warning matching `@crustjs/utils`
- [ ] Register the page in `apps/docs/content/docs/modules/meta.json`
- [ ] Update `README.md` (root) package list to include
      `@crustjs/schema-utils` if a list exists
- [ ] Update `CONTRIBUTING.md` workspace package list to include
      `@crustjs/schema-utils` if it enumerates them

**Artifacts:**
- `apps/docs/content/docs/modules/schema-utils.mdx` (new)
- `apps/docs/content/docs/modules/meta.json` (modified)
- `README.md` (modified — if list exists)
- `CONTRIBUTING.md` (modified — if list exists)

### Step 6: Changeset

- [ ] Run `bunx changeset` and produce a single changeset that:
      - Bumps `@crustjs/schema-utils` to `0.0.1` (initial release)
      - Bumps `@crustjs/validate` to a minor (`0.3.0` from `0.2.x`)
        with a brief note explaining the introspection layer moved
        to a sibling package — "no observable API change for
        `@crustjs/validate` consumers; published runtime surface
        unchanged from TP-014; one new transitive dependency
        (`@crustjs/schema-utils`) is added"
- [ ] Commit the changeset markdown alongside the code change

**Artifacts:**
- `.changeset/<timestamped>.md` (new)

### Step 7: Testing & Verification

> ZERO test failures allowed. This step runs the FULL suite as a quality
> gate. Earlier steps used targeted `--changed` runs.

- [ ] FULL test suite passing: `bun run test`
- [ ] Lint clean: `bun run check`
- [ ] Types clean: `bun run check:types`
- [ ] Build clean: `bun run build`
- [ ] Manual sanity: in a quick scratch script, `import { field } from
      "@crustjs/validate"` and call `field(z.string().describe("x"))`,
      assert `def.description === "x"` (proves the schema-utils
      introspection still reaches validate's call sites)
- [ ] Fix all failures before proceeding

### Step 8: Documentation & Delivery

- [ ] "Must Update" docs modified (see Documentation Requirements)
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md
- [ ] Final commit at step boundary

## Documentation Requirements

**Must Update:**

- `packages/schema-utils/README.md` — full first-version README; pre-stability
  framing; document each helper group with one example
- `apps/docs/content/docs/modules/schema-utils.mdx` — module reference page,
  registered in `meta.json`
- `apps/docs/content/docs/modules/meta.json` — register the new page
- `apps/docs/content/docs/modules/validate.mdx` — add a one-line note in the
  intro that introspection helpers live in `@crustjs/schema-utils`; consumers
  of validate's locked surface do not need to import schema-utils directly
- `packages/validate/README.md` — same one-line note; cross-link to
  schema-utils

**Check If Affected:**

- `taskplane-tasks/CONTEXT.md` — if a tech-debt entry references
  "introspection inside validate", clear or update it
- `apps/docs/content/docs/guide/*.mdx` — search for "introspect" and
  update any explanatory cross-links if they exist

## Completion Criteria

- [ ] `@crustjs/schema-utils` exists at `packages/schema-utils/` with
      version `0.0.1`, builds cleanly via `bun run build`, and ships
      via the workspace catalog
- [ ] `@crustjs/validate` consumes `@crustjs/schema-utils` for
      introspection and assertion / issue helpers; its public surface
      from TP-014 is unchanged
- [ ] `packages/validate/src/introspect/` directory deleted
- [ ] All four moved files exist at their new home with byte-identical
      logic; `introspect.test.ts` passes inside schema-utils unchanged
- [ ] FULL test suite + check + check:types + build pass at the repo root
- [ ] Single changeset committed (`@crustjs/schema-utils` 0.0.1,
      `@crustjs/validate` minor bump with no API change)
- [ ] Docs updated; module page registered

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-017): complete Step N — description`
- **Bug fixes:** `fix(TP-017): description`
- **Tests:** `test(TP-017): description`
- **Hydration:** `hydrate: TP-017 expand Step N checkboxes`

## Do NOT

- Change any introspection logic during the move — this is a pure code
  move; behavior must be byte-identical. Any improvement belongs in a
  follow-up task with its own changeset entry.
- Touch `@crustjs/store` in this task. The store integration is TP-018.
- Rename any of the moved exports. `inferOptions` stays `inferOptions`;
  `extractDefault` stays `extractDefault`; etc.
- Introduce new vendor adapters. The set is Zod + Effect today; expansion
  is out of scope.
- Modify `@crustjs/validate`'s public root exports — TP-014 locked them.
  Any visible surface change must be flagged immediately and lifted to
  the user before continuing.
- Hand-edit `CHANGELOG.md`. Use `bunx changeset`.
- Commit without the `TP-017` prefix in the commit message.

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
