# TP-005: `@crustjs/utils` package + `resolveSourceDir` dedup — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution (blocked on TP-003 + TP-004)
**Last Updated:** 2026-04-29
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] TP-003 changes present (private resolver in `packages/skills/src/bundle.ts`)
- [ ] TP-004 changes present
- [ ] `bun install` clean
- [ ] All existing tests pass
- [ ] No existing `packages/utils/` directory

---

### Step 1: Plan checkpoint — lock public surface, version, and framing
**Status:** ⬜ Not Started

- [ ] Public surface confirmed (1 export: `resolveSourceDir`)
- [ ] Private internals confirmed (`findNearestPackageRoot`)
- [ ] Resolution rules locked (mirrors `@crustjs/create`)
- [ ] Initial version `0.0.1` confirmed
- [ ] Pre-stability framing + audience confirmed
- [ ] Out-of-scope deferrals documented
- [ ] Plan review APPROVE recorded in `.reviews/`

---

### Step 2: Stand up the package skeleton
**Status:** ⬜ Not Started

- [ ] `package.json`, `tsconfig.json`, `bunup.config.ts` created
- [ ] `bun install` registers the workspace package
- [ ] Empty-source build pipeline ready

---

### Step 3: Implement `resolveSourceDir` and private `findNearestPackageRoot`
**Status:** ⬜ Not Started

- [ ] `src/source.ts` implements both functions with TSDoc
- [ ] `src/index.ts` exports only `resolveSourceDir`
- [ ] Build passes
- [ ] Type-check passes

---

### Step 4: Test suite
**Status:** ⬜ Not Started

- [ ] All three resolution modes covered with success cases
- [ ] All three failure modes covered with thrown-error assertions
- [ ] Edge cases covered
- [ ] Tests pass

---

### Step 5: Migrate `@crustjs/create`
**Status:** ⬜ Not Started

- [ ] Workspace dep added
- [ ] Private resolver deleted from `scaffold.ts`
- [ ] Imports `resolveSourceDir` from `@crustjs/utils`
- [ ] Existing tests pass

---

### Step 6: Migrate `@crustjs/skills`
**Status:** ⬜ Not Started

- [ ] Workspace dep added
- [ ] Private resolver (added in TP-003) deleted from `bundle.ts`
- [ ] Imports `resolveSourceDir` from `@crustjs/utils`
- [ ] Existing tests pass

---

### Step 7: Update CONTEXT.md and add new tech-debt entries
**Status:** ⬜ Not Started

- [ ] TP-003 dedup entry marked complete
- [ ] Three new tech-debt entries appended (`findNearestPackageRoot` public, `readPackageJson`, `parseSemver`)

---

### Step 8: README, docs site, and root package list
**Status:** ⬜ Not Started

- [ ] `packages/utils/README.md` with pre-stability banner
- [ ] `apps/docs/content/docs/modules/utils.mdx` with pre-stability banner
- [ ] `meta.json` updated
- [ ] Root `README.md` package list updated
- [ ] Root `CONTRIBUTING.md` updated if applicable

---

### Step 9: Code review checkpoint
**Status:** ⬜ Not Started

- [ ] Public surface verified (one export only)
- [ ] `findNearestPackageRoot` not exported (verified via built `.d.ts`)
- [ ] Behavior parity sample verified across both migrations
- [ ] No new runtime deps
- [ ] CONTEXT.md updates verified
- [ ] Pre-stability banner present in both docs surfaces
- [ ] Code review APPROVE recorded in `.reviews/`

---

### Step 10: Add changesets
**Status:** ⬜ Not Started

- [ ] `@crustjs/utils` — patch (initial release)
- [ ] `@crustjs/create` — patch (internal dedup)
- [ ] `@crustjs/skills` — patch (internal dedup)

---

### Step 11: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing
- [ ] Lint passing
- [ ] Type-check passing
- [ ] Build passing

---

### Step 12: Documentation & Delivery
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
| 2026-04-29 | Task staged | PROMPT.md and STATUS.md created; depends on TP-003 + TP-004; resolves TP-003's dedup tech-debt entry |

---

## Blockers

- **TP-003** must merge first (introduces second copy of resolver in `packages/skills/src/bundle.ts`)
- **TP-004** must merge first (user-requested ordering — utils package lands after full skill-plugin work)

---

## Notes

*Reserved for execution notes — Step 1 design summary will be recorded here before implementation begins.*
