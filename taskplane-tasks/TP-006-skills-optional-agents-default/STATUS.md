# TP-006: Optional `agents` default in `@crustjs/skills` — Status

**Current Step:** ✅ Delivered (PR #114, merged 2026-05-03)
**Status:** ✅ Complete
**Last Updated:** 2026-05-03 (post-merge cleanup by supervisor)
**Review Level:** 1
**Review Counter:** 1
**Iteration:** 1
**Size:** S

> **Note (supervisor):** This task was delivered via PR #114 against `main`.
> The orch branch's full STATUS update never reached `taskplane` because the
> manual PR recovery only carried user-visible files (per established
> repo pattern from PR #113). This top-of-file marker is the canonical
> delivery record; the step-by-step checkboxes below are stale and have
> not been retroactively filled.

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] `bun install` clean
- [ ] Existing `@crustjs/skills` tests pass
- [ ] No additional public entrypoint requires `agents` beyond the three listed

---

### Step 1: Plan checkpoint — lock default-resolution semantics
**Status:** ⬜ Not Started

- [ ] Optional applied to all three entrypoints
- [ ] Default value confirmed
- [ ] Explicit empty-array preservation confirmed
- [ ] Centralized `resolveAgents` helper signature confirmed
- [ ] Behavior change (filesystem probe on default) documented in plan
- [ ] Plugin paths verified unaffected
- [ ] No new public exports
- [ ] Out-of-scope items recorded
- [ ] Plan review APPROVE recorded in `.reviews/`

---

### Step 2: Update types
**Status:** ⬜ Not Started

- [ ] `GenerateOptions.agents` → optional
- [ ] `UninstallOptions.agents` → optional
- [ ] `StatusOptions.agents` → optional
- [ ] TSDoc updated on all three
- [ ] Type-check passes

---

### Step 3: Implement default-resolution helper + wire into all three entrypoints
**Status:** ⬜ Not Started

- [ ] Private `resolveAgents` helper added
- [ ] `generateSkill` calls it
- [ ] `uninstallSkill` calls it
- [ ] `skillStatus` calls it
- [ ] No other behavior changes in any function body
- [ ] Type-check passes

---

### Step 4: Tests
**Status:** ⬜ Not Started

- [ ] Default-resolution test for `generateSkill`
- [ ] Default-resolution test for `uninstallSkill`
- [ ] Default-resolution test for `skillStatus`
- [ ] Explicit empty-array preserved for all three
- [ ] Explicit-list path preserved for all three (sanity check)
- [ ] All targeted tests pass

---

### Step 5: Documentation
**Status:** ⬜ Not Started

- [ ] `skills.mdx` example replaced (minimal + power-user blocks)
- [ ] Filesystem-probe note added
- [ ] Stale hardcoded `universalAgents` array removed
- [ ] README scanned and fixed if applicable

---

### Step 6: Add changeset
**Status:** ⬜ Not Started

- [ ] `bunx changeset` (minor for `@crustjs/skills`)
- [ ] Body covers optional fields, default, probe note, migration example

---

### Step 7: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing
- [ ] Lint passing
- [ ] Type-check passing
- [ ] Build passing

---

### Step 8: Documentation & Delivery
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
| 2026-04-29 | Task staged | PROMPT.md and STATUS.md created; addresses stale skills.mdx example + DX friction in lower-level primitives |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes — Step 1 design summary will be recorded here before implementation begins.*
