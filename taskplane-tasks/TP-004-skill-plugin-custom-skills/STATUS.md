# TP-004: `customSkills` plugin extension — Status

**Current Step:** ✅ Delivered (PR #121, merged 2026-05-09)
**Status:** ✅ Complete (merged to main via PR #121 — commit `2de97e2`)

> **Note (supervisor):** Merged 2026-05-09 as
> `feat(skills): skillPlugin accepts customSkills for hand-authored bundles`.
> Unblocks TP-005 (resolveSourceDir dedup).
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
**Status:** ✅ Complete (merged)

- [ ] TP-003 changes present (`installSkillBundle` exported)
- [ ] `bun install` clean
- [ ] Existing plugin tests pass

---

### Step 1: Plan checkpoint — lock UX + reconciliation contract
**Status:** ✅ Complete (merged)

- [ ] `CustomSkillConfig` shape confirmed
- [ ] `customSkills` option default + validation rules confirmed
- [ ] `autoUpdateSkills` extension behavior confirmed
- [ ] Sequential per-skill multiselect UX confirmed (with `--all` skip-prompt path)
- [ ] `skill update` subcommand extension confirmed
- [ ] Error-handling rules confirmed
- [ ] Plan review APPROVE recorded in `.reviews/`

---

### Step 2: Extend types
**Status:** ✅ Complete (merged)

- [ ] `CustomSkillConfig` added to `types.ts`
- [ ] `SkillPluginOptions.customSkills?` added with TSDoc
- [ ] `CustomSkillConfig` exported from `index.ts`

---

### Step 3: Add setup-time validation
**Status:** ✅ Complete (merged)

- [ ] Validation helper implemented
- [ ] All four invalid-config cases throw with descriptive messages
- [ ] Helper unit-tested via `plugin.test.ts`

---

### Step 4: Extend `autoUpdateSkills`
**Status:** ✅ Complete (merged)

- [ ] Per-bundle scope resolution
- [ ] Per-bundle `skillStatus` + version comparison
- [ ] `installSkillBundle` invoked for outdated bundles
- [ ] Per-entry try/catch with name in error log

---

### Step 5: Extend the interactive `skill` command
**Status:** ✅ Complete (merged)

- [ ] Sequential per-skill multiselect prompts
- [ ] Per-skill diff + reconciliation
- [ ] `--all` fans out across all skills
- [ ] `SkillConflictError` overwrite-confirm flow verified for bundle path

---

### Step 6: Extend `skill update` subcommand
**Status:** ✅ Complete (merged)

- [ ] Main + per-bundle update loop
- [ ] One output line per skill

---

### Step 7: Plugin test suite
**Status:** ✅ Complete (merged)

- [ ] Setup validation cases covered
- [ ] `autoUpdateSkills` extension covered (outdated, up-to-date, error continuation)
- [ ] Interactive command covered (sequential prompts, `--all`)
- [ ] `skill update` extension covered
- [ ] Empty `customSkills` byte-identical behavior verified
- [ ] `autoUpdate: false` short-circuits both main + bundles

---

### Step 8: Code review checkpoint
**Status:** ✅ Complete (merged)

- [ ] Existing plugin tests pass with no changes when `customSkills` is omitted
- [ ] No new runtime dependencies
- [ ] No state leakage between per-skill loops
- [ ] Setup validation matches plan
- [ ] `--all` non-interactive across all skills
- [ ] Per-entry errors do not abort other entries
- [ ] Code review APPROVE recorded in `.reviews/`

---

### Step 9: Documentation
**Status:** ✅ Complete (merged)

- [ ] `packages/skills/README.md` updated
- [ ] `apps/docs/content/docs/modules/skills.mdx` updated
- [ ] CONTEXT.md plugin-integration tech-debt marked complete
- [ ] CONTEXT.md unified-prompt follow-up appended

---

### Step 10: Add changeset
**Status:** ✅ Complete (merged)

- [ ] `bunx changeset` (minor for `@crustjs/skills`)
- [ ] Body covers `customSkills`, canonical example, references #110 + TP-003

---

### Step 11: Testing & Verification
**Status:** ✅ Complete (merged)

- [ ] FULL test suite passing
- [ ] Lint passing
- [ ] Type-check passing
- [ ] Build passing

---

### Step 12: Documentation & Delivery
**Status:** ✅ Complete (merged)

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
| 2026-04-29 | Task staged | PROMPT.md and STATUS.md created; depends on TP-003; closes plugin-integration half of issue #110 |

---

## Blockers

- **TP-003** must merge first (`installSkillBundle` is the entrypoint this task wraps)

---

## Notes

*Reserved for execution notes — Step 1 design summary will be recorded here before implementation begins.*
