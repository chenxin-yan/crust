# Task: TP-002 — Depth-aware color fallback for `@crustjs/style`

**Created:** 2026-04-29
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds a new capability tier (`resolveColorDepth`) and changes
how `fg` / `bg` choose their output ANSI format. Plan review locks the depth
resolution rules and the standalone-vs-instance gating behavior; code review
verifies escape correctness across all three depths and that no capability
regressions slip into `createStyle`.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-002-depth-aware-color-fallback/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Resolve the depth-fallback tech debt deferred from TP-001. Today, after TP-001
lands, `fg` / `bg` always emit 24-bit truecolor (`ansi-16m`) regardless of
terminal capability. On terminals that support color but not truecolor, this
either renders incorrectly or relies on the terminal's own approximation. This
task adds a `resolveColorDepth` capability function that returns one of
`"truecolor" | "256" | "16" | "none"`, and updates both the standalone `fg` /
`bg` exports and the `style.fg` / `style.bg` instance methods to emit the
correct `Bun.color()` format for the resolved depth. The standalone exports
become capability-aware (Option β from the TP-002 plan) — fixing today's
inconsistency where `style.*` honors capability but the top-level functions do
not. Detection follows the existing `NO_COLOR` / `COLORTERM` / `TERM`
conventions; no new env vars are introduced. Closes the tech-debt item from
`taskplane-tasks/CONTEXT.md`.

## Dependencies

- **Task:** TP-001 (must merge before this task — TP-002 modifies files TP-001 creates and modifies)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `packages/style/src/capability.ts` — existing `resolveColorCapability`, `resolveTrueColorCapability` to extend / wrap
- `packages/style/src/capability.test.ts` — existing capability tests; pattern to follow
- `packages/style/src/color.ts` — created by TP-001; needs depth threading
- `packages/style/src/color.test.ts` — extend with depth-fallback coverage
- `packages/style/src/createStyle.ts` — current binary `trueColorEnabled ? fn : noop` gate to replace
- `packages/style/src/createStyle.test.ts` — extend with mixed-depth coverage
- `packages/style/src/types.ts` — extend with `ColorDepth` type
- `packages/style/src/index.ts` — re-export new `ColorDepth` type and `resolveColorDepth`
- `packages/style/README.md` — short auto-fallback note
- `apps/docs/content/docs/modules/style.mdx` — short auto-fallback note
- Bun.color reference: https://bun.com/docs/runtime/color (`"ansi-16m"`, `"ansi-256"`, `"ansi-16"` formats)

## Environment

- **Workspace:** `packages/style/` (primary), `apps/docs/` (docs only)
- **Services required:** None

## File Scope

- `packages/style/src/capability.ts` (modify)
- `packages/style/src/capability.test.ts` (extend)
- `packages/style/src/color.ts` (modify)
- `packages/style/src/color.test.ts` (extend)
- `packages/style/src/createStyle.ts` (modify)
- `packages/style/src/createStyle.test.ts` (extend)
- `packages/style/src/types.ts` (modify — add `ColorDepth`)
- `packages/style/src/index.ts` (modify — add `ColorDepth` type and `resolveColorDepth` exports)
- `packages/style/src/runtimeExports.ts` (review only — should not need changes)
- `packages/style/README.md` (modify — auto-fallback note)
- `apps/docs/content/docs/modules/style.mdx` (modify — auto-fallback note)
- `taskplane-tasks/CONTEXT.md` (modify — mark depth-fallback tech-debt item complete)
- `.changeset/*.md` (new — patch bump)

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] TP-001 changes are present on the working branch (verify `packages/style/src/color.ts` exists and old `dynamicColors.ts` does not)
- [ ] `bun install` completes cleanly
- [ ] Existing capability tests pass: `cd packages/style && bun test src/capability.test.ts`

### Step 1: Plan checkpoint — lock depth resolution rules

> **Review override: plan review** — verify the capability resolution table and gating model before writing code.

Produce a short design note (in STATUS.md Notes section) confirming:

- [ ] `ColorDepth` union: `"truecolor" | "256" | "16" | "none"` (in `types.ts`)
- [ ] `resolveColorDepth(mode, overrides)` resolution table:
  - `mode === "never"` → `"none"`
  - `mode === "always"` → `"truecolor"` (consistent with `resolveTrueColorCapability("always")`)
  - `mode === "auto"`:
    - Not a TTY OR `NO_COLOR` set non-empty → `"none"`
    - `COLORTERM` ∈ `{"truecolor", "24bit"}` (case-insensitive) → `"truecolor"`
    - `TERM` ends with `-direct` OR contains `truecolor` / `24bit` → `"truecolor"`
    - `TERM` contains `256color` → `"256"`
    - `TERM === "dumb"` → `"none"`
    - Any other TTY value → `"16"`
- [ ] Standalone `fg` / `bg` honor global mode via `getGlobalColorMode()`; resolve depth at call time (Option β confirmed)
- [ ] `style.fg` / `style.bg` capture depth at `createStyle()` time (consistent with how `mode` is currently locked); the binary `trueColorEnabled` gate is replaced by the depth tier
- [ ] `resolveColorCapability` and `resolveTrueColorCapability` keep their current signatures and behavior; they may be re-implemented as wrappers over `resolveColorDepth` if cleaner
- [ ] Empty-text input still short-circuits to `""` regardless of depth
- [ ] Public exports added: `resolveColorDepth`, `ColorDepth`. **No** other surface changes.

**Do not start Step 2 until plan review verdict is APPROVE.**

### Step 2: Add `ColorDepth` type + `resolveColorDepth` capability function

- [ ] Add `ColorDepth` to `packages/style/src/types.ts`
- [ ] Implement `resolveColorDepth(mode, overrides)` in `capability.ts` per the table from Step 1
- [ ] Re-implement `resolveColorCapability` and `resolveTrueColorCapability` as wrappers if it improves clarity (otherwise leave them and document parallel logic)
- [ ] Run targeted tests: `cd packages/style && bun test src/capability.test.ts` (extend in Step 3)

**Artifacts:**
- `packages/style/src/types.ts` (modified)
- `packages/style/src/capability.ts` (modified)

### Step 3: Capability tests

- [ ] Extend `capability.test.ts` with `resolveColorDepth` coverage:
  - [ ] `mode === "never"` → `"none"`
  - [ ] `mode === "always"` → `"truecolor"`
  - [ ] `auto` + non-TTY → `"none"`
  - [ ] `auto` + TTY + `NO_COLOR` set → `"none"`
  - [ ] `auto` + TTY + `COLORTERM=truecolor` → `"truecolor"`
  - [ ] `auto` + TTY + `COLORTERM=24bit` (case-insensitive) → `"truecolor"`
  - [ ] `auto` + TTY + `TERM=xterm-direct` → `"truecolor"`
  - [ ] `auto` + TTY + `TERM=xterm-256color` → `"256"`
  - [ ] `auto` + TTY + `TERM=xterm` → `"16"`
  - [ ] `auto` + TTY + `TERM=dumb` → `"none"`
- [ ] Verify existing `resolveColorCapability` / `resolveTrueColorCapability` tests still pass

### Step 4: Thread depth through `color.ts`

- [ ] Refactor `color.ts` to compute the right `Bun.color()` format string from a depth value (`"truecolor" → "ansi-16m"`, `"256" → "ansi-256"`, `"16" → "ansi-16"`, `"none" → return text unchanged`)
- [ ] Standalone `fg` / `bg`: at call time, read `getGlobalColorMode()` (default `"auto"`), call `resolveColorDepth`, emit accordingly. When depth is `"none"`, return the input text unchanged (do not throw on invalid input in this case — preserve current behavior of `throw on invalid input` for non-`"none"` depths only)
- [ ] `fgCode` / `bgCode`: keep emitting `"ansi-16m"` (these are escape-pair primitives for `composeStyles` and should be deterministic; capability gating happens at apply time)
- [ ] Run targeted tests: `cd packages/style && bun test src/color.test.ts`

**Decision to confirm during plan review:** What does standalone `fg("text", "not-a-color")` do when depth is `"none"`? Two options:
  - (A) Throw `TypeError` regardless of depth (validation always runs).
  - (B) Skip validation and return text when depth is `"none"` (treats no-color env as "do nothing").

Default in this task is **(A) — always validate**, because silent non-throws on invalid input mask user bugs.

### Step 5: Update `createStyle.ts` gating

- [ ] Replace the `const trueColorEnabled = resolveTrueColorCapability(...)` line and the binary `trueColorEnabled ? fn : noop` blocks for `fg` / `bg` with depth-aware emission:
  - [ ] Resolve depth once at `createStyle()` time
  - [ ] If depth is `"none"`, `style.fg` / `style.bg` return the input text unchanged
  - [ ] Otherwise emit using the resolved depth's Bun.color format
- [ ] Update the publicly exposed instance properties — keep `colorsEnabled`, add `colorDepth: ColorDepth` for introspection (mirrors existing `trueColorEnabled` pattern). The existing `trueColorEnabled` boolean stays for backward compatibility (it equals `colorDepth === "truecolor"`)
- [ ] Run targeted tests: `cd packages/style && bun test src/createStyle.test.ts`

### Step 6: Style + integration tests

- [ ] Extend `color.test.ts` with depth-fallback round-trips: same input across `"truecolor"` / `"256"` / `"16"` produces the expected escape strings; `"none"` returns unchanged text
- [ ] Extend `createStyle.test.ts` with:
  - [ ] `style.fg` emits `"ansi-256"` escapes when capability is `"256"`
  - [ ] `style.fg` emits `"ansi-16"` escapes when capability is `"16"`
  - [ ] `style.fg` returns text unchanged when depth is `"none"`
  - [ ] `style.bg` parallels for backgrounds
  - [ ] The new `colorDepth` introspection property reflects the resolved depth
- [ ] Sample assertion: `Bun.color("#ff0000", "ansi-256")` should produce `\x1b[38;5;196m` — assert against Bun's actual output rather than hard-coded strings to stay tolerant of Bun version differences (use the value `Bun.color(...)` returns directly as the expectation)

### Step 7: Documentation

- [ ] `packages/style/README.md`: add a short subsection under "Dynamic Colors" titled "Color Depth & Auto-Fallback" explaining that `fg` / `bg` automatically downgrade to 256 or 16 colors based on `TERM` / `COLORTERM`, and that `setGlobalColorMode("never")` disables emission entirely
- [ ] `apps/docs/content/docs/modules/style.mdx`: add the equivalent note in the appropriate section
- [ ] Update `taskplane-tasks/CONTEXT.md`: mark the **Depth-aware color fallback** tech-debt item as complete (change `- [ ]` to `- [x]` and append `(resolved by TP-002)`)

### Step 8: Code review checkpoint

> **Review override: code review** — verify implementation matches the contract from Step 1.

The reviewer must confirm:

- [ ] `resolveColorDepth` resolution rules match the table in Step 1
- [ ] No regression in `resolveColorCapability` / `resolveTrueColorCapability` behavior
- [ ] Both standalone `fg` / `bg` AND `style.fg` / `style.bg` honor capability; standalone resolves at call time, instance resolves at construction time
- [ ] Escape strings emitted for at least one sample input across all three non-none depths are byte-identical to what `Bun.color()` produces directly
- [ ] No new public exports beyond `resolveColorDepth` and `ColorDepth`
- [ ] CONTEXT.md tech-debt item marked complete

### Step 9: Add changeset

- [ ] Run `bunx changeset` and select `@crustjs/style` with a **patch** bump
- [ ] Body must:
  - [ ] State this adds depth-aware fallback for `fg` / `bg` (no API change)
  - [ ] Note that `setGlobalColorMode` and `NO_COLOR` continue to gate emission as before
  - [ ] Mention new public `resolveColorDepth` and `ColorDepth` exports

### Step 10: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] Run FULL test suite: `bun run test`
- [ ] Run lint: `bun run check`
- [ ] Run type-check: `bun run check:types`
- [ ] Run build: `bun run build`
- [ ] Fix all failures

### Step 11: Documentation & Delivery

- [ ] "Must Update" docs modified (verified in Step 7)
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `packages/style/README.md` — add "Color Depth & Auto-Fallback" subsection
- `apps/docs/content/docs/modules/style.mdx` — equivalent note
- `taskplane-tasks/CONTEXT.md` — mark depth-fallback tech-debt item complete

**Check If Affected:**
- `packages/style/CHANGELOG.md` — auto-updated by Changesets; do **not** hand-edit
- Any other `.mdx` / `.md` in `apps/docs/` that mentions color capability or `setGlobalColorMode`

## Completion Criteria

- [ ] All steps complete
- [ ] `bun run check && bun run check:types && bun run test && bun run build` all pass
- [ ] Plan-review APPROVE before Step 2; code-review APPROVE before Step 9
- [ ] Changeset present in `.changeset/`
- [ ] CONTEXT.md depth-fallback tech-debt item marked complete

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-002): complete Step N — description`
- **Bug fixes:** `fix(TP-002): description`
- **Tests:** `test(TP-002): description`
- **Hydration:** `hydrate: TP-002 expand Step N checkboxes`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message
- Re-introduce any export removed in TP-001 (`rgb`, `hex`, `bgRgb`, `bgHex`, `parseHex`, `*Code` legacy names)
- Change the public signature of `fg` / `bg` / `fgCode` / `bgCode` — only the *output* changes based on capability
- Add new color-detection environment variables beyond `NO_COLOR`, `COLORTERM`, `TERM`
- Modify `applyStyle`, `composeStyles`, `ansiCodes.ts`, or `styleEngine.ts`
- Hand-edit `CHANGELOG.md` files

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
