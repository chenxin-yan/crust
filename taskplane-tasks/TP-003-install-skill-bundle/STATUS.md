# TP-003: `installSkillBundle()` primitive — Status

**Current Step:** ✅ Delivered (PR #119, opened 2026-05-07)
**Status:** ✅ Complete (awaiting review/merge)

> **Note (supervisor):** Delivered via PR #119 against `main` as
> `feat(skills): installSkillBundle — install pre-authored skill folders`.
> Batch `20260507T032410` (single lane, 14m 27s task / 15m 6s total, $6.96)
> produced the orch branch; manual PR recovery (feat/* off origin/main)
> carried 19 user-visible files; 882 lines of worker scratchpad noise
> excluded.
>
> Closes #110.
>
> Verification gate: `bun run check` 281/0, `bun run check:types --force`
> 21/21 (no cache), `packages/skills` 297/2skip/0fail, all 10 packages
> 2,283 pass total.
>
> Tech debt deferred per Step 8: TP-005 (resolveSourceDir dedup), TP-004
> (skillPlugin customSkills integration), bundle scaffolding command.
**Last Updated:** 2026-04-29
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] `bun install` clean
- [ ] Existing `@crustjs/skills` tests pass
- [ ] No existing `bundle.ts` in `packages/skills/src/`

---

### Step 1: Plan checkpoint — lock API + safety contract
**Status:** ⬜ Not Started

- [ ] `InstallSkillBundleOptions` shape confirmed
- [ ] Return-type alias decision recorded (`InstallSkillBundleResult = GenerateResult`)
- [ ] `SkillKind` semantics + backward-compat default confirmed
- [ ] Frontmatter probe rules confirmed (no YAML parser dependency)
- [ ] File copy + exclusion rules confirmed
- [ ] Path-traversal safety rules confirmed
- [ ] Plan review APPROVE recorded in `.reviews/`

---

### Step 2: Add `SkillKind` and extend `crust.json`
**Status:** ⬜ Not Started

- [ ] `SkillKind` type added
- [ ] `readInstalledManifest` exported with backward-compat default
- [ ] `crust.json` write path always emits `kind`
- [ ] `version.test.ts` covers legacy + new format

---

### Step 3: Refactor `generate.ts` — extract install core
**Status:** ⬜ Not Started

- [ ] `installRenderedSkill(files, meta, opts, kind)` extracted
- [ ] `generateSkill` delegates and remains byte-identical for existing tests
- [ ] `SkillConflictError` extended with `kindMismatch` detail
- [ ] `generate.test.ts` extended for kind-mismatch coverage

---

### Step 4: Implement `loadBundleFiles`
**Status:** ⬜ Not Started

- [ ] `string | URL` resolution + `realpath` canonicalization
- [ ] Recursive walk with exclusion rules
- [ ] `SKILL.md` existence check
- [ ] Lightweight `name:` frontmatter probe
- [ ] Path-traversal symlink rejection
- [ ] Unit tests for `loadBundleFiles` pass

---

### Step 5: Implement `installSkillBundle`
**Status:** ⬜ Not Started

- [ ] `meta.name` validation mirrors `generateSkill`
- [ ] Files loaded + sorted + `crust.json` appended
- [ ] Delegates to `installRenderedSkill(..., "bundle")`
- [ ] Public symbols re-exported from `index.ts`

---

### Step 6: Bundle test suite
**Status:** ⬜ Not Started

- [ ] Fixture under `packages/skills/tests/fixtures/bundle/` created
- [ ] All test cases from PROMPT.md Step 6 pass

---

### Step 7: Code review checkpoint
**Status:** ⬜ Not Started

- [ ] No new runtime dependencies
- [ ] `generateSkill` behavior unchanged for existing tests
- [ ] Shared install path verified
- [ ] Path-traversal guard verified at all depths
- [ ] Public surface limited to plan
- [ ] Code review APPROVE recorded in `.reviews/`

---

### Step 8: Documentation
**Status:** ⬜ Not Started

- [ ] `packages/skills/README.md` updated
- [ ] `apps/docs/content/docs/modules/skills.mdx` updated
- [ ] CONTEXT.md scaffolding tech-debt note appended

---

### Step 9: Add changeset
**Status:** ⬜ Not Started

- [ ] `bunx changeset` (minor for `@crustjs/skills`)
- [ ] Body covers new entrypoint, `kind` field, error detail; references #110

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
| 2026-04-29 | Task staged | PROMPT.md and STATUS.md created; primitive half of issue #110; TP-004 will stack on top |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes — Step 1 design summary will be recorded here before implementation begins.*
