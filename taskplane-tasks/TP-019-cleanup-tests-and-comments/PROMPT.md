# Task: TP-019 — Lean up tests and comments across the monorepo

**Created:** 2026-05-10
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Pure cleanup task. Removes high-confidence redundant tests
(barrel-export tautologies, skipped tests, duplicated initial-value blocks
across prompts, fuzzy.test.ts duplication, smoke tautology), consolidates
14 hand-rolled builder-method immutability/mutation tests into one
parameterized suite, merges two vendor-specific help-integration files via
the existing `VendorFixtures` pattern from `command.test.ts`, and removes
six restating-the-code comments in `prompts/core/textEdit.ts`. **No published
behavior changes** — tests-only and source-comments-only. The risk is
deleting a test that turns out to cover a unique path; plan review locks
the deletion list and the consolidation shapes before the worker touches
files. Worker must run the full test + typecheck + build gates after each
step and surface any coverage drop they suspect.
**Score:** 2/8 — Blast radius: 1 (test files + 1 source file with
docs-only comments; no published API change), Pattern novelty: 0
(deletions + an existing vendor-fixture pattern), Security: 0,
Reversibility: 1 (deletions are reversible via git, but losing a load-bearing
test silently would only surface on a future regression — reviewer's gate).

## Canonical Task Folder

```
taskplane-tasks/TP-019-cleanup-tests-and-comments/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Two scout audits (recorded in `taskplane-tasks/TP-019-cleanup-tests-and-comments/.reviews/`
once delivered; summarized inline below) found that the Crust test suite
carries **~1,000 lines of low-value or duplicated tests** and the source
tree has a **healthy comment culture with 6 minor restating-the-code
comments** in a single file. This task removes that waste in **one PR**.

After this task lands:

- The test suite has **~1,000 fewer lines** with no behavioral coverage loss.
  All deletions fall into one of three categories: (1) tautological barrel
  export checks that TypeScript already validates at compile time;
  (2) skipped tests with no follow-up plan; (3) per-prompt copies of
  generic "initial-value short-circuit" / "non-TTY" patterns already covered
  by `packages/prompts/tests/integration.test.ts`.
- Two structural consolidations land alongside the deletions:
  - `packages/core/src/crust.test.ts`'s 14 hand-rolled
    "immutability + does-not-mutate" tests for `.flags()`, `.args()`,
    `.meta()`, `.command()`, `.run()`, `.preRun()`, `.postRun()`, `.use()`,
    `.sub()` are folded into a single parameterized `describe.each` suite.
    Net reduction: ~130 lines → ~25 lines.
  - `packages/validate/tests/help-integration.test.ts` (Zod) and
    `packages/validate/tests/help-integration-effect.test.ts` (Effect) are
    merged into one `help-integration.test.ts` driven by the same
    `VendorFixtures` pattern that `packages/validate/src/command.test.ts`
    already uses. Net reduction: ~80 lines.
- `packages/prompts/src/core/textEdit.ts` lines 56, 64, 71, 76, 81, 85
  drop their six restating-the-code comments above
  `if (key.name === "...")` blocks. The `if` conditions are
  self-documenting.
- **TP-\* internal-tracker footprint is scrubbed from the codebase**
  (~73 occurrences across 26 source/test/changeset files + the root
  `progress.md` scratchpad). Internal taskplane IDs like `TP-009`,
  `TP-016`, `TP-017` leak from comments, test labels, and changesets into
  what consumers see on `main` and on npm. They are kept inside
  `taskplane-tasks/` and `.pi/` but removed everywhere else — the
  *justification* in each comment is preserved by rewording, only the
  task ID is removed.
- `bun run check`, `bun run check:types`, `bun run test`, and `bun run build`
  remain green.
- A changeset entry is **NOT** required because no published package's user-
  visible behavior or API surface changes (tests are not shipped; the
  textEdit comment cleanup is non-public). The worker should still surface
  the per-package line-count delta in STATUS.md so the supervisor can
  spot-check.

This task is a **single PR** (per locked workflow decision). Commits are
per-step so reviewers can follow deletions package-by-package, but the PR
itself is one cohesive "lean up tests" change.

## Dependencies

- **None.** The targeted files exist on the current branch as listed in
  File Scope. No other TP-XXX needs to land first.

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md` — test conventions (`bun:test`, co-located,
  changeset rules, pre-flight commands)
- `AGENTS.md` (root) — Bun/Biome/test rulebook

**Tier 3 (load only if needed):**

*For the deletion list:*
- `packages/store/src/index.test.ts` — entire file is barrel-export
  tautologies (`expect(typeof createStore).toBe("function")` etc.)
- `packages/skills/src/index.test.ts` — same pattern as above
- `packages/progress/tests/integration.test.ts` lines 11–27 — barrel
  export block (the rest of the file is real integration coverage and
  must be kept)
- `packages/prompts/src/core/fuzzy.test.ts` — entire file's behavior is
  redundantly covered by `packages/prompts/tests/integration.test.ts`
  lines 198–233
- `packages/skills/src/plugin.test.ts` lines 460–486 (`it.skip("prints
  install output with Universal label", …)`) and lines 760–810
  (`it.skip("respects installMode during interactive installs", …)`) —
  two skipped tests with no follow-up; treat as dead code
- `packages/core/tests/smoke.test.ts` — entire file: a `1+1===2`
  tautology and three `typeof X === "function"` exports checks already
  guaranteed by TypeScript
- `packages/prompts/tests/integration.test.ts` — verifies the deletion
  candidates listed below are actually covered here (read lines 38–290
  before deleting prompts initial-value blocks)
- `packages/prompts/src/prompts/input.test.ts` lines 106–128 (initial
  value short-circuit)
- `packages/prompts/src/prompts/confirm.test.ts` lines 91–115 (initial
  value)
- `packages/prompts/src/prompts/select.test.ts` lines 91–120 (initial
  value)
- `packages/prompts/src/prompts/multiselect.test.ts` lines 91–119
  (initial value)
- `packages/prompts/src/prompts/password.test.ts` lines 92–116 (initial
  value)
- `packages/prompts/src/prompts/filter.test.ts` lines 91–120 (initial
  value)

*For the parameterized builder-method consolidation (Step 3):*
- `packages/core/src/crust.test.ts` lines 94–101, 103–112 (`.flags()`),
  206–212, 213–219 (`.args()`), 307–313, 314–320 (`.meta()`),
  617–623, 624–630 (`.command()`), 940–946, 947–953 (`.run()`),
  1019–1025, 1033–1039 (`.preRun()`), 1026–1032, 1040–1046
  (`.postRun()`), 1299–1305, 1307–1313 (`.use()`), 2465 (`.sub()`
  mutation test) — the 14+ tests that fold into one parameterized
  `describe.each` block

*For the help-integration vendor merge (Step 4):*
- `packages/validate/tests/help-integration.test.ts` (Zod variant)
- `packages/validate/tests/help-integration-effect.test.ts` (Effect variant)
- `packages/validate/src/command.test.ts` — read the `zodFixtures`
  / `effectFixtures` / `wrapEffect` pattern (top of file) and copy
  it verbatim for the merged help test; do **not** invent a new fixture
  shape

*For the comment cleanup (Step 5):*
- `packages/prompts/src/core/textEdit.ts` lines 56, 64, 71, 76, 81, 85 —
  the six `// Backspace — delete character before cursor` /
  `// Delete — …` / arrow-key / home/end comments above
  `if (key.name === "…")` blocks

**Reference research (already conducted; do NOT re-research):**

The two scout audits confirmed:

1. **No other source-comment cleanup is in scope.** The audit
   inspected 132 source files and found a healthy comment culture:
   decorative dividers (`// ────`) are intentional structural markers,
   `TP-XXX` archaeology comments document architecture decisions and
   must stay, all `@deprecated` JSDoc is load-bearing (changelog-
   tracked), and the two untracked `TODO(v0.1.0)` items in
   `packages/skills/src/plugin.ts:141` and
   `packages/skills/src/generate.ts:141` are **out of scope for this
   task** — they are tracked separately under "Tech Debt & Known
   Issues" via Amendment if observed by the worker, not deleted.

2. **Test files outside the deletion list are healthy.**
   `command.test.ts` (988L), `cross-target-integration.test.ts`
   (1329L), `update-notifier.test.ts` (1263L), `parser.test.ts`
   (1298L), `types.test.ts` (1300L), `store/store.test.ts` (1078L),
   `skills/generate.test.ts` (2059L), and the rest of the long-file
   set are organized by distinct scenarios with no systematic
   duplication. **Do not "tidy" them.** Out of scope.

3. **The aggressive option was rejected.** Specifically: do **not**
   collapse the duplicate `router.test.ts` describe blocks, do **not**
   extract a shared "non-TTY / no-message" helper across all 7 prompt
   test files, do **not** consolidate `prompts/core/utils.test.ts` or
   `prompts/core/theme.test.ts` or `prompts/core/renderer.test.ts`.
   Those are deferred for a future task if ever wanted.

## Environment

- **Workspace:** monorepo-wide (`packages/core`, `packages/validate`,
  `packages/prompts`, `packages/store`, `packages/skills`,
  `packages/progress`)
- **Services required:** None
- **Bun version:** as pinned in `package.json` / `bun.lock`

## File Scope

### Step 1 — Tautological / dead-code deletions (whole files or contiguous blocks)

- `packages/core/tests/smoke.test.ts` — **delete entire file** (~20 lines)
- `packages/store/src/index.test.ts` — **delete entire file** (~59 lines)
- `packages/skills/src/index.test.ts` — **delete entire file** (~78 lines)
- `packages/prompts/src/core/fuzzy.test.ts` — **delete entire file** (~156 lines)
- `packages/progress/tests/integration.test.ts` — **modify**: delete the
  barrel-export block (~lines 11–27); keep the rest of the file
- `packages/skills/src/plugin.test.ts` — **modify**: delete the two
  `it.skip(...)` blocks (lines 460–486 and 760–810, ~78 lines)

### Step 2 — Per-prompt initial-value block deletions (already covered by integration test)

- `packages/prompts/src/prompts/input.test.ts` — delete `describe("initial value", …)` block at lines 106–128
- `packages/prompts/src/prompts/confirm.test.ts` — delete `describe("initial value", …)` block at lines 91–115
- `packages/prompts/src/prompts/select.test.ts` — delete `describe("initial value", …)` block at lines 91–120
- `packages/prompts/src/prompts/multiselect.test.ts` — delete `describe("initial value", …)` block at lines 91–119
- `packages/prompts/src/prompts/password.test.ts` — delete `describe("initial value", …)` block at lines 92–116
- `packages/prompts/src/prompts/filter.test.ts` — delete `describe("initial value", …)` block at lines 91–120

### Step 3 — Parameterize builder-method immutability/mutation tests in core

- `packages/core/src/crust.test.ts` — collapse 14+ separate
  immutability/mutation tests into one parameterized `describe.each`
  block. **Net change: ~130 lines removed, ~25 lines added.**

### Step 4 — Merge help-integration vendor-specific files

- `packages/validate/tests/help-integration.test.ts` — **modify**:
  rewrite as a vendor-fixture-driven suite using the same
  `VendorFixtures` / `wrapEffect` pattern from
  `packages/validate/src/command.test.ts`. Tests run for both Zod and
  Effect.
- `packages/validate/tests/help-integration-effect.test.ts` —
  **delete entire file** (its scenarios are absorbed into the merged
  file above).

### Step 5 — Source-comment cleanup (single file, six lines)
### Step 6 — TP-* internal-tracker footprint scrub

- `packages/prompts/src/core/textEdit.ts` — remove the six restating-the-
  code single-line comments at lines 56, 64, 71, 76, 81, 85. **Do not
  touch other comments in this file or any other file.**

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes.
> Workers expand steps when runtime discoveries warrant it.

### Step 0: Preflight

- [ ] All listed files in "File Scope" exist on disk; record any
      drift (line numbers shifted, file moved) in STATUS.md Notes
- [ ] Full pre-flight is green BEFORE any deletion:
      `bun run check && bun run check:types && bun run test && bun run build`
- [ ] Record current per-package test counts in STATUS.md Notes
      (`bun test` summary line per package) so the post-cleanup delta
      is measurable
- [ ] Confirm `packages/prompts/tests/integration.test.ts` actually
      covers each "initial value short-circuit" scenario being deleted
      in Step 2 (read lines 133–174); record the integration line
      ranges that prove coverage in STATUS.md Notes
- [ ] Confirm `VendorFixtures` / `wrapEffect` pattern shape from
      `packages/validate/src/command.test.ts` (top of file) — record
      the import path and helper signatures in STATUS.md Notes

### Step 1: Delete tautological / dead-code tests

- [ ] Delete `packages/core/tests/smoke.test.ts`
- [ ] Delete `packages/store/src/index.test.ts`
- [ ] Delete `packages/skills/src/index.test.ts`
- [ ] Delete `packages/prompts/src/core/fuzzy.test.ts`
- [ ] Trim barrel-export block (lines 11–27) from
      `packages/progress/tests/integration.test.ts`; keep the rest
- [ ] Delete the two `it.skip(...)` blocks in
      `packages/skills/src/plugin.test.ts` (lines 460–486, 760–810)
- [ ] Per-package targeted tests pass for every modified package:
      `cd packages/<name> && bun test`
- [ ] Commit: `test(TP-019): delete tautological barrel-export and dead skipped tests`

**Artifacts:**
- 4 files deleted, 2 files modified (~390 lines removed)

### Step 2: Drop per-prompt initial-value duplicates

- [ ] Delete the `describe("initial value", …)` block from each of:
      `input.test.ts`, `confirm.test.ts`, `select.test.ts`,
      `multiselect.test.ts`, `password.test.ts`, `filter.test.ts`
- [ ] `cd packages/prompts && bun test` green
- [ ] Commit: `test(TP-019): drop per-prompt initial-value blocks covered by integration test`

**Artifacts:**
- 6 prompt test files modified (~160 lines removed)

### Step 3: Parameterize builder-method immutability tests in core

- [ ] In `packages/core/src/crust.test.ts`, replace the 14+
      hand-rolled immutability + mutation tests for `.flags()`,
      `.args()`, `.meta()`, `.command()`, `.run()`, `.preRun()`,
      `.postRun()`, `.use()`, `.sub()` with one parameterized
      `describe.each` (or equivalent) block of the shape:
      ```ts
      describe.each([
        { name: ".flags()",   apply: (a: Crust) => a.flags({ x: { type: "boolean" } }), node: "flags" },
        { name: ".args()",    apply: (a: Crust) => a.args({ y: { type: "string" } }),   node: "args"  },
        // …one row per builder method…
      ])("$name (immutability)", ({ apply, node }) => {
        it("returns a new instance",   () => { /* expect(...).not.toBe(app) */ });
        it("does not mutate original", () => { /* expect(app._node[node]).toEqual({}) */ });
      });
      ```
      The exact column shape (`apply` / `node` / etc.) is the
      worker's call — match what the existing tests assert. Do not
      drop any per-method assertion; if a method's mutation test
      asserts something unique (e.g., `.sub()` checks `_node.children`),
      add a per-row hook or keep that one test outside the loop.
- [ ] Run `cd packages/core && bun test` and confirm count is
      consistent with prior coverage (every method still has both
      checks)
- [ ] Commit: `test(TP-019): parameterize builder-method immutability/mutation tests`

**Artifacts:**
- `packages/core/src/crust.test.ts` modified (~130 lines removed,
  ~25 lines added)

### Step 4: Merge help-integration vendor variants

- [ ] Read `packages/validate/src/command.test.ts` to copy the
      `VendorFixtures` interface and `wrapEffect` helper pattern
      verbatim (do not invent a new shape)
- [ ] Rewrite `packages/validate/tests/help-integration.test.ts` so
      the `it("renders help for …")` blocks loop over `[zodFixtures,
      effectFixtures]` with `it(\`...[\${fixtures.name}]\`, …)`
- [ ] Verify every scenario in
      `packages/validate/tests/help-integration-effect.test.ts` is
      covered by the merged file (cross-check by name); record the
      mapping in STATUS.md Notes
- [ ] Delete `packages/validate/tests/help-integration-effect.test.ts`
- [ ] `cd packages/validate && bun test` green
- [ ] Commit: `test(TP-019): merge help-integration zod+effect variants via VendorFixtures`

**Artifacts:**
- `packages/validate/tests/help-integration.test.ts` modified
- `packages/validate/tests/help-integration-effect.test.ts` deleted
  (~80 lines net reduction)

### Step 5: Trim restating-the-code comments in textEdit.ts

- [ ] Remove the six single-line comments above the `if (key.name ===
      "…")` blocks at lines 56 (`// Backspace —…`), 64 (`// Delete
      —…`), 71 (`// Left arrow —…`), 76 (`// Right arrow —…`),
      81 (`// Home —…`), 85 (`// End —…`)
- [ ] Do **not** edit any other comment in this file or anywhere else
- [ ] `cd packages/prompts && bun test` green (no test changes
      expected; this verifies the source still compiles + behaves)
- [ ] Commit: `style(TP-019): drop restating-the-code comments in textEdit`

**Artifacts:**
- `packages/prompts/src/core/textEdit.ts` modified (6 lines removed)

### Step 6: Scrub TP-* internal-tracker footprint from non-taskplane files

**Goal:** Remove ~73 references to internal taskplane IDs (`TP-001`…`TP-019`)
from source, tests, changesets, and root scratchpads. Keep the *reasoning*
behind each comment; remove only the ID. `taskplane-tasks/` and `.pi/` are
out of scope (they own the IDs).

**Discovery command** (run first to refresh the inventory — numbers below
are a 2026-05-12 snapshot, may have drifted):

```sh
rg -n "TP-0[0-9]+" -g '!taskplane-tasks/**' -g '!.pi/**' -g '!node_modules/**' -g '!dist/**'
```

**File inventory (26 files + 1 root scratchpad, snapshot 2026-05-12):**

Packages with TP-* references in shipped source:
- `packages/core/src/crust.ts` (3 — alias-collision detection in 3 spots)
- `packages/core/src/validation.ts` (1 — alias collision policy block)
- `packages/plugins/src/help.ts` (1 — hidden subcommand filter)
- `packages/plugins/src/completion/walker.ts` (3 — choices/hidden notes)
- `packages/plugins/src/completion/index.ts` (1 — advisory-at-parse-time)
- `packages/plugins/src/completion/spec.ts` (4 — choices/aliases doc)
- `packages/plugins/src/completion/templates/bash.ts` (1 — alias dispatch)
- `packages/skills/src/bundle.ts` (1 — "TP-003 deliberately copies")
- `packages/skills/src/version.ts` (3 — legacy `crust.json` notes)
- `packages/validate/src/types.ts` (2 — re-export rationale)
- `packages/validate/src/validate.ts` (1 — schema-utils sourcing note)
- `packages/validate/src/validation.ts` (1 — path formatting note)

Packages with TP-* references in tests/test labels:
- `packages/core/src/crust.test.ts` (1)
- `packages/core/src/router.test.ts` (1)
- `packages/core/src/types.test.ts` (4)
- `packages/core/src/validation.test.ts` (1)
- `packages/man/src/mdoc.test.ts` (1)
- `packages/plugins/src/did-you-mean.test.ts` (1)
- `packages/plugins/src/plugins.test.ts` (3)
- `packages/plugins/src/completion/index.test.ts` (1)
- `packages/plugins/src/completion/walker.test.ts` (2)
- `packages/plugins/src/completion/templates/zsh.test.ts` (1)
- `packages/prompts/src/prompts/input.test.ts` (1)
- `packages/prompts/src/prompts/password.test.ts` (1)
- `packages/skills/src/generate.test.ts` (1)
- `packages/validate/src/scaffold.test.ts` (1)

Changesets (will publish to GitHub release notes):
- `.changeset/field-to-store.md` (reword inline; do not delete — it gates a real version bump)
- `.changeset/validate-api-alignment.md` (reword inline; same reason)

Root scratchpad (decide: delete vs. scrub):
- `progress.md` (31 — supervisor scratchpad with rolling status notes)

**Transformation rules:**

1. **Source comments referencing TP-* purely as a tracker ID** —
   delete the parenthetical only. Example:
   - Before: `// Mirror .command()'s eager alias collision detection (TP-016) but ...`
   - After:  `// Mirror .command()'s eager alias collision detection but ...`
2. **Comments where TP-* is the entire reason** (e.g. `// Alias collision
   policy (TP-016)` as a section heading) — reword to describe the *behavior*
   rather than the ticket. Example:
   - Before: `// Alias collision policy (TP-016)`
   - After:  `// Alias collision policy: aliases share a namespace with canonical names`
   (use the existing surrounding context to pick a 1-line description)
3. **Test `describe` / `it` labels** with `(TP-NNN)` suffix — delete the
   suffix. Test names should describe *what the test asserts*, not which
   ticket added it.
4. **Comments referencing TP-* as historical context** (e.g. "Legacy crust.json
   files written before TP-003") — reword to the *version/release* the
   change shipped in if known (e.g. "Legacy crust.json files written before
   the bundle-kind field was introduced"), or just "...written before
   `kind` was added" if the version is unclear. Never just delete — the
   *content* is real explanatory value.
5. **`.changeset/*.md`** — the changeset markdown becomes a GitHub release
   note. Reword TP-* references to the user-facing feature name. Example:
   - Before: `removes the deprecated subpath barrels introduced in TP-007`
   - After:  `removes the deprecated subpath barrels introduced in 0.1`
   (or `removes the deprecated subpath barrels introduced earlier`).
6. **`progress.md`** — read the file; if it is purely an in-flight supervisor
   scratchpad with no value once tasks ship, **delete it** and add a line to
   STATUS.md noting the deletion. If it has any reference content worth
   keeping, scrub the TP-* references inline.

**Order of work:**

- [ ] Re-run the discovery `rg` command and update the count in STATUS.md
      (Step 6 baseline) — expect ~73 across 26 files + `progress.md`
- [ ] Scrub source files in `packages/*/src/` (transformations 1, 2, 4)
- [ ] Scrub test files in `packages/*/src/` and `packages/*/tests/`
      (transformation 3)
- [ ] Scrub the two `.changeset/*.md` files (transformation 5)
- [ ] Decide and act on `progress.md` (transformation 6); record the
      decision (delete vs. scrub) in STATUS.md
- [ ] Re-run discovery `rg` — should return 0 hits outside
      `taskplane-tasks/` and `.pi/`
- [ ] `bun run check && bun run check:types && bun run test && bun run build`
      green
- [ ] Commit: `chore(TP-019): scrub internal taskplane IDs from shipped source and changesets`

**Artifacts:**
- 26 packages files modified (comment text only; no code logic touched)
- 2 `.changeset/*.md` files modified (release-note wording)
- `progress.md` deleted or scrubbed (per worker's read)

**Verification gate:** after the scrub, the only files matching
`rg "TP-0[0-9]+"` should live under `taskplane-tasks/`, `.pi/`, or this
task's own commit messages (Git history is not in scope).

### Step 7: Full verification & delivery

- [ ] FULL pre-flight green:
      `bun run check && bun run check:types && bun run test && bun run build`
- [ ] Record post-cleanup per-package line counts and test counts in
      STATUS.md Notes; show the delta vs. the Step 0 baseline
- [ ] No changeset is added (no published behavior change). Confirm
      this in STATUS.md.
- [ ] Documentation review: nothing in `apps/docs/`, package READMEs,
      or `taskplane-tasks/CONTEXT.md` needs updating (no public API or
      conventions changed). Confirm in STATUS.md.
- [ ] Verify TP-* scrub left zero hits outside `taskplane-tasks/` /
      `.pi/` via `rg "TP-0[0-9]+" -g '!taskplane-tasks/**' -g '!.pi/**'`
      (excluding this task's own commit-message footers, which are
      Git history not file content)
- [ ] Final commit on the branch boundary if any fixup edits were
      needed: `chore(TP-019): post-cleanup verification`

## Documentation Requirements

**Must Update:**
- _(none)_ — no public API or convention changes.

**Check If Affected:**
- `taskplane-tasks/CONTEXT.md` "Tech Debt & Known Issues" section: if
  the worker observes (during the cleanup) any *new* tech debt outside
  this task's scope, append a bullet there. Do **not** silently fix
  it — surface it for a future task.

## Completion Criteria

- [ ] All steps complete
- [ ] Full test suite green (`bun run test` exits 0)
- [ ] `bun run check` and `bun run check:types` clean
- [ ] `bun run build` clean
- [ ] No changeset added (none required — confirmed in STATUS.md)
- [ ] STATUS.md records baseline vs. post-cleanup line counts and
      test counts per package
- [ ] No deletions outside the explicit File Scope list
- [ ] `rg "TP-0[0-9]+" -g '!taskplane-tasks/**' -g '!.pi/**'` returns
      **zero hits** (Step 6 verification gate)

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All
commits for this task MUST include the task ID for traceability:

- **Step completion:** `test(TP-019): <step description>` (or `style(...)`
  for Step 5)
- **Bug fixes:** `fix(TP-019): <description>`
- **Hydration:** `hydrate: TP-019 expand Step N checkboxes`

## Do NOT

- Touch any test file outside the explicit File Scope. The audit
  reports listed many "healthy" long files (`command.test.ts`,
  `parser.test.ts`, `types.test.ts`, `update-notifier.test.ts`,
  `cross-target-integration.test.ts`, `store/store.test.ts`,
  `skills/generate.test.ts`, `skills/render.test.ts`, etc.) — leave
  them alone.
- Touch any source-code comment outside the six lines in
  `packages/prompts/src/core/textEdit.ts`. The decorative
  `// ──────` dividers, `TP-XXX` architecture-decision comments, and
  `@deprecated` JSDoc are **load-bearing**.
- Delete or "fix" the two untracked `TODO(v0.1.0)` items in
  `packages/skills/src/plugin.ts:141` and
  `packages/skills/src/generate.ts:141`. They are out of scope for
  this task. If they bother the worker, append a bullet to
  `taskplane-tasks/CONTEXT.md` "Tech Debt & Known Issues".
- Collapse the duplicate `router.test.ts` describe blocks (the
  user explicitly chose the "moderate" option, not "aggressive").
- Extract a shared "non-TTY / no-message" helper across prompts test
  files. Out of scope.
- Refactor `prompts/core/utils.test.ts`, `prompts/core/theme.test.ts`,
  or `prompts/core/renderer.test.ts`. Out of scope.
- Add a runtime `console.log`, biome-ignore, or new dependency.
- Add a changeset — no public package surface changes.
- Modify `CHANGELOG.md` files manually.
- Skip tests or use `it.skip` / `describe.skip` to "fix" a failing test.
- Expand task scope. Surface new findings in
  `taskplane-tasks/CONTEXT.md` "Tech Debt & Known Issues" instead.
- Commit without the `TP-019` prefix.

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->

### Amendment 1 — 2026-05-12 (post-PR #123, supervisor pre-flight)

**Issue:** PR #123 (TP-017, merged 2026-05-12) added 7 lines to
`packages/store/src/index.test.ts` (new `it("should export field")` block +
exports-array entry). The file is now 66 lines, not the ~59 the PROMPT
baseline assumes.

**Resolution:** No scope change. The file is still a tautological barrel-
export test and Step 1's "delete entire file" decision still holds; the
new `field` export test is itself tautological. Worker should record the
updated line count (66) in STATUS.md Step 0 baseline for transparency, and
**verify line ranges by grep** rather than trusting hard-coded offsets in
the rest of the PROMPT (subsequent file additions during the interval may
have shifted some immutability tests by a handful of lines without
changing shape).

### Amendment 2 — 2026-05-12 (operator request: run absolute last)

**Issue:** Earlier sequencing put TP-019 after TP-005 + TP-018 (PR-K + PR-P),
which would leave TP-011 (PR-M) and TP-012 (PR-N) to land *after* the scrub.
Those tasks will inevitably introduce new `(TP-011)` and `(TP-012)`
comments in their work — the scrub from Step 6 would be partially undone
within a day.

**Resolution:** TP-019 is repositioned to run **absolute last**, after
PR-K, PR-P, PR-M, AND PR-N have all landed. The Step 6 file inventory
baseline (~73 occurrences across 26 files) will grow before TP-019 runs:

- TP-005 (PR-K) will likely add a handful of `(TP-005)` comments in
  `packages/utils/` and at the deleted call sites in `packages/skills/`
  and `packages/create/`.
- TP-018 (PR-P) will add `(TP-018)` comments in `packages/store/`.
- TP-011 (PR-M) will add `(TP-011)` comments wherever `ValueType` /
  coercion helpers are migrated.
- TP-012 (PR-N) will add `(TP-012)` comments around the new `ValueType`
  variants, `parse?:` escape hatch, and completion-spec path-hint.

**Worker action:** Re-run the discovery `rg` command at Step 6 start;
treat the result as the new authoritative baseline (likely 90–120
occurrences after the four upstream PRs land). The 6 transformation
rules and the verification gate (`0 hits outside taskplane-tasks/ + .pi/`)
are unchanged.
