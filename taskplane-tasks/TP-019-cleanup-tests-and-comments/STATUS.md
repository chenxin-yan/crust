# TP-019: Lean up tests and comments — Status

**Current Step:** Step 0 (Preflight)
**Status:** ⬜ Not Started
**Last Updated:** 2026-05-10 (created)
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] All listed File Scope files exist; record any drift in Notes
- [ ] Full pre-flight green BEFORE deletions: `bun run check && bun run check:types && bun run test && bun run build`
- [ ] Baseline per-package test counts recorded in Notes
- [ ] Confirm `prompts/tests/integration.test.ts` lines 133–174 cover each per-prompt initial-value scenario being deleted in Step 2
- [ ] Confirm `VendorFixtures` / `wrapEffect` shape from `packages/validate/src/command.test.ts` (record import path + signatures in Notes)

---

### Step 1: Delete tautological / dead-code tests
**Status:** ⬜ Not Started

- [ ] `packages/core/tests/smoke.test.ts` deleted
- [ ] `packages/store/src/index.test.ts` deleted
- [ ] `packages/skills/src/index.test.ts` deleted
- [ ] `packages/prompts/src/core/fuzzy.test.ts` deleted
- [ ] Barrel-export block trimmed from `packages/progress/tests/integration.test.ts`
- [ ] Two `it.skip(...)` blocks removed from `packages/skills/src/plugin.test.ts`
- [ ] All affected packages' tests pass (`bun test` per package)
- [ ] Commit: `test(TP-019): delete tautological barrel-export and dead skipped tests`

---

### Step 2: Drop per-prompt initial-value duplicates
**Status:** ⬜ Not Started

- [ ] Initial-value `describe` block deleted from `input.test.ts`
- [ ] Initial-value `describe` block deleted from `confirm.test.ts`
- [ ] Initial-value `describe` block deleted from `select.test.ts`
- [ ] Initial-value `describe` block deleted from `multiselect.test.ts`
- [ ] Initial-value `describe` block deleted from `password.test.ts`
- [ ] Initial-value `describe` block deleted from `filter.test.ts`
- [ ] `cd packages/prompts && bun test` green
- [ ] Commit: `test(TP-019): drop per-prompt initial-value blocks covered by integration test`

---

### Step 3: Parameterize builder-method immutability tests in core
**Status:** ⬜ Not Started

- [ ] 14+ hand-rolled immutability/mutation tests in `crust.test.ts` collapsed into one `describe.each` (or equivalent) block
- [ ] Per-method assertion uniqueness preserved (e.g., `.sub()` children check)
- [ ] `cd packages/core && bun test` green; total test count change recorded in Notes
- [ ] Commit: `test(TP-019): parameterize builder-method immutability/mutation tests`

---

### Step 4: Merge help-integration vendor variants
**Status:** ⬜ Not Started

- [ ] `help-integration.test.ts` rewritten to use `VendorFixtures` / `wrapEffect` looping over `[zodFixtures, effectFixtures]`
- [ ] Scenario-by-scenario coverage mapping recorded in Notes (every test from `help-integration-effect.test.ts` accounted for)
- [ ] `help-integration-effect.test.ts` deleted
- [ ] `cd packages/validate && bun test` green
- [ ] Commit: `test(TP-019): merge help-integration zod+effect variants via VendorFixtures`

---

### Step 5: Trim restating-the-code comments in textEdit.ts
**Status:** ⬜ Not Started

- [ ] 6 single-line comments removed from `packages/prompts/src/core/textEdit.ts` (lines 56, 64, 71, 76, 81, 85 at PROMPT-write time)
- [ ] No other comment touched
- [ ] `cd packages/prompts && bun test` green
- [ ] Commit: `style(TP-019): drop restating-the-code comments in textEdit`

---

### Step 6: Full verification & delivery
**Status:** ⬜ Not Started

- [ ] Full pre-flight green: `bun run check && bun run check:types && bun run test && bun run build`
- [ ] Post-cleanup per-package line counts + test counts recorded with delta vs. Step 0 baseline
- [ ] No changeset added (confirmed in Notes)
- [ ] Documentation review: nothing in docs/READMEs/CONTEXT.md needs updating (confirmed in Notes)
- [ ] `.DONE` file created

---

## Notes

<!-- Workers append discoveries, baseline measurements, mapping tables, and
     amendments here as they execute. Keep entries dated. -->

### Baseline (Step 0) — to fill

| Package | Test files | Test lines | Test count |
|---------|-----------:|-----------:|-----------:|
| core    |            |            |            |
| validate|            |            |            |
| prompts |            |            |            |
| store   |            |            |            |
| skills  |            |            |            |
| progress|            |            |            |
| **Total**|           |            |            |

### Post-cleanup (Step 6) — to fill

| Package | Test files | Test lines | Test count | Δ lines | Δ tests |
|---------|-----------:|-----------:|-----------:|--------:|--------:|
| core    |            |            |            |         |         |
| validate|            |            |            |         |         |
| prompts |            |            |            |         |         |
| store   |            |            |            |         |         |
| skills  |            |            |            |         |         |
| progress|            |            |            |         |         |
| **Total**|           |            |            |         |         |

### Coverage proofs

<!-- Step 0: line ranges in prompts integration test that prove each per-prompt
     initial-value deletion is safe. Step 4: scenario mapping from help-integration-effect
     into the merged file. -->
