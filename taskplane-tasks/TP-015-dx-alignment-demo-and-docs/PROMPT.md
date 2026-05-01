# Task: TP-015 — Update cross-package docs to use the aligned validate APIs

**Created:** 2026-05-02
**Size:** XS

## Review Level: 1 (Plan Only)

**Assessment:** Pure docs update — no public API changes. The docs in three
modules (`validate`, `store`, `prompts`) cross-reference helpers
renamed/added/removed in TP-013 and TP-014. Plan review locks which
examples migrate to which new shape. Code review is unnecessary because
the only verifications are (a) the docs site builds without broken links
and (b) per-package `bun run check:types` stays clean.
**Score:** 1/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-015-dx-alignment-demo-and-docs/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

After TP-013 and TP-014 land, the public APIs for `@crustjs/prompts` and
`@crustjs/validate` are aligned with `@crustjs/core`'s command DSL: every
helper takes a Standard Schema and produces a typed value. The
cross-package docs in `apps/docs/content/docs/modules/{validate,store,prompts}.mdx`
and the per-package READMEs still demonstrate the old 0.1.x shapes
(verbose `field()` calls, `parsePromptValue`, two-pass `validate + parse`
for prompts).

This task is the **visible payoff** of the alignment work: rewrite the
cross-package docs so every example matches the post-alignment API.
Show the line-count drop where it applies (typically 4 lines → 1 line per
field, two-pass → one-pass for prompts).

> **Note:** This task originally also rewrote a runnable demo at
> `apps/demo-validate/`. That demo never made it onto any branch and was
> dropped (operator decision 2026-05-03); scope is docs-only.

## Dependencies

- **Task:** TP-013 (prompts polymorphic `validate:` slot must be merged)
- **Task:** TP-014 (validate API alignment must be merged — `field(schema, opts?)`, `parseValue`, deletions)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `apps/docs/content/docs/modules/validate.mdx` — should be largely rewritten by TP-014's docs step; this task verifies cross-links
- `apps/docs/content/docs/modules/store.mdx` — store-side examples that reference `field(schema)` still work (the function name didn't change, but its return shape did — examples must be updated)
- `apps/docs/content/docs/modules/prompts.mdx` — should be largely updated by TP-013's docs step; this task verifies the `parseValue` cross-link references resolve
- `packages/store/README.md` — examples still use the validator-only `field(z.…)` pattern; rewrite to use the new `field(schema)` factory
- `packages/validate/README.md` and `packages/prompts/README.md` — verify migration sections describe the post-alignment API

## Environment

- **Workspace:** `apps/docs/`, `packages/{validate,store,prompts}/`
- **Services required:** None

## File Scope

**Modified:**
- `apps/docs/content/docs/modules/validate.mdx` (verify links resolve; tighten examples touched by TP-014)
- `apps/docs/content/docs/modules/store.mdx` (rewrite all `field(...)` examples to the new factory shape)
- `apps/docs/content/docs/modules/prompts.mdx` (verify cross-links; ensure the `validate: schema` examples are present per TP-013)
- `packages/store/README.md` (rewrite `field(...)` examples)
- `packages/validate/README.md` (verify migration section matches post-alignment API)
- `packages/prompts/README.md` (verify migration section matches post-alignment API)
- `.changeset/*.md` (if a docs site change requires one — typically not for app-level changes)

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes.
> Workers expand steps when runtime discoveries warrant it.

### Step 0: Preflight

- [ ] Verify TP-013 and TP-014 have both merged into the working branch
  - [ ] `rg "parsePromptValue|promptValidator|fieldSync" packages/` returns no hits (TP-014 acceptance)
  - [ ] `packages/prompts/src/prompts/input.ts` exports the polymorphic `validate?:` slot (TP-013 acceptance)
- [ ] Test suite green pre-edit: `bun run test`

### Step 1: Update cross-package docs

- [ ] `packages/store/README.md`: rewrite every `field(z.…)` example to the new `field(schema)` factory shape. Ensure store's docs do NOT imply a runtime dep on `@crustjs/validate` (the structural-typing decoupling stays).
- [ ] `apps/docs/content/docs/modules/store.mdx`: same rewrite as `packages/store/README.md`. Verify the `#store-field-validation` anchor still resolves and matches what `validate.mdx` cross-links to.
- [ ] `apps/docs/content/docs/modules/validate.mdx`: TP-014 should have already done the heavy rewrite. Verify all "See also" anchors back to `store.mdx` and `prompts.mdx` still resolve.
- [ ] `apps/docs/content/docs/modules/prompts.mdx`: TP-013 should have already added the schema-validation section. Verify the `parseValue` cross-link (if any) points to `validate.mdx#parsevalue` or equivalent.
- [ ] `packages/validate/README.md` and `packages/prompts/README.md`: verify migration sections describe the post-alignment API (no leftover `parsePromptValue` / `promptValidator` / `fieldSync` examples).

**Artifacts:**
- `packages/store/README.md` (modified)
- `apps/docs/content/docs/modules/store.mdx` (modified)
- `apps/docs/content/docs/modules/validate.mdx` (verified, possibly minor edits)
- `apps/docs/content/docs/modules/prompts.mdx` (verified, possibly minor edits)
- `packages/validate/README.md`, `packages/prompts/README.md` (verified)

### Step 2: Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] `bun run check` clean
- [ ] `bun run check:types` clean across the workspace
- [ ] `bun run test` full suite green
- [ ] `apps/docs/` build (whichever script the docs app exposes — typically `bun run build`) finishes with zero broken links
- [ ] Final cross-monorepo `rg "parsePromptValue|promptValidator|parsePromptValueSync|fieldSync"` returns no hits anywhere

### Step 3: Documentation & Delivery

- [ ] All "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md (esp. any docs site build issues, broken anchors, or remaining stale references found via `rg`)
- [ ] Changeset added only if a published package's README change warrants one per repo convention

## Documentation Requirements

**Must Update:**
- `packages/store/README.md` — rewrite `field(...)` examples
- `apps/docs/content/docs/modules/store.mdx` — rewrite `field(...)` examples

**Check If Affected:**
- `apps/docs/content/docs/modules/validate.mdx` — TP-014 owns the rewrite; verify links resolve here
- `apps/docs/content/docs/modules/prompts.mdx` — TP-013 owns the rewrite; verify links resolve here
- `packages/validate/README.md`, `packages/prompts/README.md` — verify migration sections

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Docs site builds without broken links
- [ ] No remaining stale helper references anywhere in the monorepo

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-015): complete Step N — description`
- **Bug fixes:** `fix(TP-015): description`
- **Docs:** `docs(TP-015): description`
- **Tests:** `test(TP-015): description`

## Do NOT

- Modify `packages/prompts/` or `packages/validate/` source — those are owned
  by TP-013 and TP-014 respectively. Only docs/README updates here.
- Re-introduce any of the deleted helpers (`parsePromptValue`,
  `parsePromptValueSync`, `promptValidator`, `fieldSync`).
- Recreate `apps/demo-validate/` or any runnable demo as part of this task.
  A new runnable demo is a separate follow-up task if desired.
- Add a runtime `@crustjs/validate` dep to `@crustjs/store` or
  `@crustjs/prompts`. The structural-typing boundary is preserved.
- Expand task scope — log tech debt to `taskplane-tasks/CONTEXT.md#tech-debt--known-issues` instead.
- Modify framework/standards docs without explicit user approval
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
