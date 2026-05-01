# TP-007: `@crustjs/validate` single entry + vendor dispatch — Status

**Current Step:** Complete
**Status:** ✅ Complete (merged to main via PR #113 — `feat(validate): single Standard Schema entry point + vendor-dispatch introspection`)
**Last Updated:** 2026-05-02
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
- [ ] All existing tests pass before any changes
- [ ] **Spec sanity probe** — confirmed exact runtime values for all four assertions
- [ ] Resolved `effect` and `zod` versions recorded
- [ ] Verified zero internal-package source consumers
- [ ] Verified `tests/cross-target-integration.test.ts` is the only in-repo test importing per-library subpaths

---

### Step 1: Plan checkpoint — lock final API + introspection contract
**Status:** ⬜ Not Started

- [ ] Public export list locked
- [ ] `arg()` / `flag()` signatures confirmed
- [ ] `ArgOptions` / `FlagOptions` shapes confirmed against today's interfaces
- [ ] Vendor-dispatch registry contract locked
- [ ] Inferred fields per vendor enumerated and parity with current behavior verified
- [ ] Effect peer-dep floor `^3.14.0` justified
- [ ] New-root Effect wrap requirement documented
- [ ] Deprecated `/effect` auto-wrap shim scope locked (~50 LoC)
- [ ] Validation behavior preservation list confirmed
- [ ] Behavior intentionally removed list confirmed (changeset honest)
- [ ] Deprecated alias policy locked through 1.0.0
- [ ] Out-of-scope items recorded
- [ ] Plan review APPROVE recorded in `.reviews/`

---

### Step 2: Move and consolidate the standard/ core to top-level
**Status:** ⬜ Not Started

- [ ] All `standard/*.ts` and tests relocated to `src/`
- [ ] `standard/types.ts` folded into `src/types.ts`
- [ ] All internal imports updated
- [ ] All moved tests pass

---

### Step 3: Build the introspection registry
**Status:** ⬜ Not Started

- [ ] `src/introspect/registry.ts` dispatches on `~standard.vendor`
- [ ] `src/introspect/zod.ts` ports current Zod logic
- [ ] `src/introspect/effect.ts` ports current Effect logic, reading `.ast` off the wrapper
- [ ] `src/introspect/registry.test.ts` covers Zod + Effect happy paths and unknown-vendor fallback
- [ ] Type-check passes

---

### Step 4: Implement new top-level `arg()`, `flag()`, `commandValidator()`
**Status:** ⬜ Not Started

- [ ] `src/schema.ts` exports `arg()` / `flag()` accepting any Standard Schema with optional metadata
- [ ] Inferred + user-supplied options merged correctly (user wins)
- [ ] Unknown-vendor + missing required field → clear `CrustError("DEFINITION")`
- [ ] `[VALIDATED_SCHEMA]` brand applied for strict-mode `never` check
- [ ] `src/command.ts` exports unified `commandValidator()` working with both vendors through one path
- [ ] `src/index.ts` exports the locked Step 1 surface and nothing more
- [ ] Type-check passes

---

### Step 5: Delete obsolete library-specific source
**Status:** ⬜ Not Started

- [ ] `src/zod/{schema,command,types,command.test}.ts` deleted
- [ ] `src/effect/{schema,command,types,command.test}.ts` deleted
- [ ] `resolve-options.ts` trimmed or deleted
- [ ] `middleware.ts` simplified to single-marker form
- [ ] Type-check passes

---

### Step 6: Consolidate command tests
**Status:** ⬜ Not Started

- [ ] New `src/command.test.ts` covers ~94 surviving behavior tests across Zod + Effect through one entry point
- [ ] Effect fixtures wrapped at fixture setup
- [ ] Introspection-conflict tests deleted with rationale recorded in Discoveries
- [ ] All tests pass

---

### Step 7: Rewrite `tests/cross-target-integration.test.ts`
**Status:** ⬜ Not Started

- [ ] Direct internal subpath imports replaced
- [ ] Effect fixtures wrap explicitly for new-root tests
- [ ] At least one test per deprecated barrel exercises the alias
- [ ] All tests pass

---

### Step 8: Build the deprecated alias barrels
**Status:** ⬜ Not Started

- [ ] `src/zod/index.ts` pure re-export with `@deprecated` TSDoc
- [ ] `src/standard/index.ts` pure re-export with `@deprecated` TSDoc
- [ ] `src/effect/index.ts` re-export + auto-wrap shim with `@deprecated` TSDoc
- [ ] Minimal smoke tests for all three barrels
- [ ] All tests pass

---

### Step 9: Update package.json
**Status:** ⬜ Not Started

- [ ] Single `.` export + three deprecated subpath exports
- [ ] Version bumped to `0.1.0`
- [ ] `zod` in devDeps only
- [ ] `effect` peerDep floor `^3.14.0`
- [ ] `bun install` clean

---

### Step 10: Update package README
**Status:** ⬜ Not Started

- [ ] Full rewrite with single-entry framing
- [ ] Quick-start sections for Zod, Effect, other Standard Schema
- [ ] Migration section + deprecation timeline through 1.0.0
- [ ] Old Architecture/Target-Matrix tables removed

---

### Step 11: Update docs site and cross-package READMEs
**Status:** ⬜ Not Started

- [ ] `validate.mdx` rewritten
- [ ] `prompts.mdx`, `store.mdx`, `index.mdx` updated
- [ ] `packages/store/README.md` updated
- [ ] Repo-wide grep confirms no stale subpath imports outside deprecated barrels and CHANGELOG

---

### Step 12: Code review checkpoint
**Status:** ⬜ Not Started

- [ ] Public exports match Step 1 list exactly
- [ ] Vendor-dispatch registry verified for both vendors + unknown fallback
- [ ] Effect introspection reads from `.ast` on wrapper (new-root path)
- [ ] Deprecated `/effect` still accepts raw schemas via auto-wrap
- [ ] All deprecated barrels carry `@deprecated` TSDoc
- [ ] Test parity verified or deletion rationale recorded
- [ ] `package.json` shape correct
- [ ] README + validate.mdx examples spot-checked end-to-end
- [ ] Code review APPROVE recorded in `.reviews/`

---

### Step 13: Add changeset
**Status:** ⬜ Not Started

- [ ] `bunx changeset` (minor for `@crustjs/validate`)
- [ ] Headline + what's new + deprecation policy + Effect floor + removed-behavior + migration + why all present

---

### Step 14: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing
- [ ] Lint passing
- [ ] Type-check passing
- [ ] Build passing
- [ ] Docs build passing

---

### Step 15: Documentation & Delivery
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
| 2026-04-29 | Task staged | PROMPT.md and STATUS.md created. Design X locked: single root entry, deprecated subpath aliases through 1.0.0, vendor-dispatch introspection (Zod + Effect via `~standard.vendor`), Effect peer floor `^3.14.0` for AST-through-wrapper access. |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes — Step 0 spec sanity probe results, Step 1 design summary, deleted-behavior list, and any vendor-adapter divergences from current introspection will be recorded here before implementation begins.*
