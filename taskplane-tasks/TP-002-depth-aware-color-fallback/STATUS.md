# TP-002: Depth-aware color fallback for `@crustjs/style` — Status

**Current Step:** ✅ Delivered
**Status:** ✅ Complete (merged to main via PR #111)
**Last Updated:** 2026-04-30
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

> **Delivered.** TP-002 was completed in taskplane batch `20260429T220902` and
> merged to `main` as part of PR #111 (commit `075490b`), alongside TP-001. The
> original Not-Started checkboxes below are preserved for historical reference
> but should NOT be re-executed; orch should treat this task as Done.

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] TP-001 changes present on working branch (`color.ts` exists, `dynamicColors.ts` does not)
- [ ] `bun install` clean
- [ ] Existing capability tests pass

---

### Step 1: Plan checkpoint — lock depth resolution rules
**Status:** ⬜ Not Started

- [ ] `ColorDepth` union confirmed
- [ ] `resolveColorDepth` resolution table approved
- [ ] Standalone vs instance gating model confirmed (Option β)
- [ ] Decision recorded for invalid-input behavior at depth `"none"` (default: throw)
- [ ] Plan review APPROVE recorded in `.reviews/`

---

### Step 2: Add `ColorDepth` type + `resolveColorDepth` capability function
**Status:** ⬜ Not Started

- [ ] `ColorDepth` added to `types.ts`
- [ ] `resolveColorDepth` implemented in `capability.ts`
- [ ] Existing capability functions still pass

---

### Step 3: Capability tests
**Status:** ⬜ Not Started

- [ ] `resolveColorDepth` covered for all rows of the resolution table
- [ ] Existing capability tests still pass

---

### Step 4: Thread depth through `color.ts`
**Status:** ⬜ Not Started

- [ ] Format-string mapping added (truecolor / 256 / 16 / none)
- [ ] Standalone `fg` / `bg` resolve depth at call time via `getGlobalColorMode`
- [ ] `fgCode` / `bgCode` keep emitting `ansi-16m`
- [ ] `color.test.ts` updates pass

---

### Step 5: Update `createStyle.ts` gating
**Status:** ⬜ Not Started

- [ ] Binary `trueColorEnabled` gate replaced with depth-aware emission
- [ ] `colorDepth` introspection property exposed; `trueColorEnabled` retained for compat
- [ ] `style.fg` / `style.bg` return text unchanged when depth is `"none"`

---

### Step 6: Style + integration tests
**Status:** ⬜ Not Started

- [ ] `color.test.ts` round-trips across all three non-none depths
- [ ] `createStyle.test.ts` covers `style.fg` / `style.bg` at each depth
- [ ] `colorDepth` introspection property covered

---

### Step 7: Documentation
**Status:** ⬜ Not Started

- [ ] README "Color Depth & Auto-Fallback" subsection added
- [ ] `apps/docs/content/docs/modules/style.mdx` updated
- [ ] CONTEXT.md depth-fallback tech-debt item marked complete

---

### Step 8: Code review checkpoint
**Status:** ⬜ Not Started

- [ ] `resolveColorDepth` matches Step 1 table
- [ ] No regression in `resolveColorCapability` / `resolveTrueColorCapability`
- [ ] Standalone + instance gating both verified
- [ ] Sample escape parity verified across depths
- [ ] Public surface limited to `resolveColorDepth` + `ColorDepth`
- [ ] Code review APPROVE recorded in `.reviews/`

---

### Step 9: Add changeset
**Status:** ⬜ Not Started

- [ ] `bunx changeset` (patch for `@crustjs/style`)
- [ ] Body covers feature, gating preservation, new exports

---

### Step 10: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing
- [ ] Lint passing
- [ ] Type-check passing
- [ ] Build passing

---

### Step 11: Documentation & Delivery
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
| 2026-04-29 | Task staged | PROMPT.md and STATUS.md created; depends on TP-001; Next Task ID bumped to TP-003 |

---

## Blockers

- **TP-001** must merge first (modifies files this task depends on)

---

## Notes

*Reserved for execution notes — Step 1 design summary will be recorded here before implementation begins.*
