# TP-001: Redesign `@crustjs/style` dynamic colors around `Bun.color` — Status

**Current Step:** ✅ Delivered
**Status:** ✅ Complete (merged to main via PR #111)
**Last Updated:** 2026-04-30
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

> **Delivered.** TP-001 was completed in taskplane batch `20260429T220902` and
> merged to `main` as part of PR #111 (commit `075490b`). The original
> Not-Started checkboxes below are preserved for historical reference but should
> NOT be re-executed; orch should treat this task as Done.

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Required files exist (`packages/style/src/dynamicColors.ts`, `apps/docs/content/docs/modules/style.mdx`)
- [ ] `bun install` completes cleanly
- [ ] Dependencies satisfied (none)

---

### Step 1: Plan checkpoint — lock API contract before implementation
**Status:** ⬜ Not Started

- [ ] Confirm `ColorInput` union shape against Bun.color's accepted inputs
- [ ] Confirm public exports list: `fg`, `bg`, `fgCode`, `bgCode`, `ColorInput`
- [ ] Confirm `TypeError` error contract for invalid input
- [ ] Confirm output format (`ansi-16m`) and bg derivation (`38;` → `48;`)
- [ ] Confirm style-instance methods collapse to `fg` / `bg` only
- [ ] Re-grep monorepo to confirm no consumers of old names besides `apps/docs/content/docs/modules/style.mdx`
- [ ] Plan review APPROVE recorded in `.reviews/`

---

### Step 2: Implement new color module
**Status:** ⬜ Not Started

- [ ] Create `packages/style/src/color.ts` with `fg`, `bg`, `fgCode`, `bgCode`
- [ ] Add `ColorInput` to `packages/style/src/types.ts`
- [ ] Wire `Bun.color(input, "ansi-16m")` for foreground; derive background by escape rewrite
- [ ] Throw `TypeError` on `null` return

---

### Step 3: Write new test suite
**Status:** ⬜ Not Started

- [ ] Create `packages/style/src/color.test.ts`
- [ ] Cover all `ColorInput` variants for `fg` / `bg` / `fgCode` / `bgCode`
- [ ] Cover invalid-input throws and empty-text behavior
- [ ] Port nesting + composition parity scenarios from old `dynamicColors.test.ts`
- [ ] Targeted run passes: `bun test src/color.test.ts`

---

### Step 4: Remove legacy module + rewire exports
**Status:** ⬜ Not Started

- [ ] Delete `packages/style/src/dynamicColors.ts` and `dynamicColors.test.ts`
- [ ] Update `packages/style/src/index.ts` exports (remove 9, add 5)
- [ ] Update `packages/style/src/runtimeExports.ts` if affected
- [ ] Rename `style.rgb`/`style.hex`/`style.bgRgb`/`style.bgHex` → `style.fg`/`style.bg` in `createStyle.ts`
- [ ] Package tests pass: `bun test` from `packages/style/`

---

### Step 5: Update documentation
**Status:** ⬜ Not Started

- [ ] Update `packages/style/README.md` Dynamic Colors section
- [ ] Update `apps/docs/content/docs/modules/style.mdx` (lines 223 and 237 + surrounding examples)
- [ ] Append depth-fallback tech-debt entry to `taskplane-tasks/CONTEXT.md`

---

### Step 6: Code review checkpoint
**Status:** ⬜ Not Started

- [ ] All nine legacy exports gone (verified via grep)
- [ ] Escape parity proven for at least 3 sample inputs
- [ ] Capability gating still works
- [ ] No external monorepo consumers of removed names remain
- [ ] Code review APPROVE recorded in `.reviews/`

---

### Step 7: Add changeset
**Status:** ⬜ Not Started

- [ ] `bunx changeset` (minor for `@crustjs/style`)
- [ ] Body documents breaking change + migration examples + new capabilities

---

### Step 8: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing: `bun run test`
- [ ] Lint passing: `bun run check`
- [ ] Type-check passing: `bun run check:types`
- [ ] Build passing: `bun run build`

---

### Step 9: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-29 | Task staged | PROMPT.md and STATUS.md created; Next Task ID bumped to TP-002 in CONTEXT.md |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes — Step 1 design summary will be recorded here before implementation begins.*
