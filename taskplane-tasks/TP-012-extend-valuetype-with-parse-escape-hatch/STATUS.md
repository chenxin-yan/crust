# TP-012: Extend `ValueType` with `url`/`path`/`json` + add `parse?:` escape hatch — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-29
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2–5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] TP-009, TP-010, TP-011 confirmed merged
- [ ] FINAL.md and oracle reports (C, D, B) read
- [ ] Existing core + plugins + utils tests pass on the current branch

---

### Step 1: Extend `ValueType` and TS inference machinery
**Status:** ⬜ Not Started

- [ ] Extend `ValueType`, `Resolve<T>`, add `ResolveBaseType<F>`, update
      `InferFlagValue<F>` with presence checks in
      `packages/core/src/types.ts`
- [ ] Add `UrlFlagDef`/`PathFlagDef`/`JsonFlagDef` (+ multi + ArgDef
      variants) and update the `FlagDef`/`ArgDef` discriminated unions
- [ ] Type-level tests in `packages/core/src/types.test.ts` cover the
      three new types with required/default/multiple combinations

---

### Step 2: Implement built-in coercers
**Status:** ⬜ Not Started

- [ ] `packages/core/src/coercers.ts` exports `coerceUrl`, `coercePath`,
      `coerceJson` with `CrustError("PARSE", ...)` on failure
- [ ] `packages/core/src/coercers.test.ts` covers every scenario in the
      Test Coverage section (success + each error path per coercer)

---

### Step 3: Add `parse?:` field to string variants
**Status:** ⬜ Not Started

- [ ] `parse?: (raw: string) => unknown` added to `StringFlagDef`,
      `StringMultiFlagDef`, `StringArgDef`
- [ ] `parse?: never` added to every other variant (number/boolean/
      url/path/json — single, multi, ArgDef)
- [ ] `// @ts-expect-error` tests verify rejection on non-string
      variants; positive type-level tests verify `parse` inference

---

### Step 4: Wire parser dispatch and `parse` runtime semantics
**Status:** ⬜ Not Started

- [ ] `coerceValue` dispatches on `url`/`path`/`json` to the new coercers
- [ ] Async-parse rejection at command setup time
      (`CrustError("CONFIG", ...)`)
- [ ] `parse` runtime: skip built-in coercer, per-element for
      `multiple: true`, default-value coercion (oracle C fix), choices
      validated before parse
- [ ] `parser.test.ts` covers every scenario in the Test Coverage section
      (basic, multi, required, default-absent regression, default-present,
      async rejection, choices precedence, parse-throws error path)

---

### Step 5: Update completion plugin for `path`
**Status:** ⬜ Not Started

> ⚠️ Hydrate: After reading TP-010's `walker.ts` and `spec.ts`, expand
> these checkboxes with the actual `CompletionSpec` field name used to
> carry the path-completion hint.

- [ ] Walker recognizes `url`/`path`/`json` and marks `path` entries
      with the file-completion hint (flag + ArgDef)
- [ ] Bash/zsh/fish templates emit `compgen -f` / `_files` /
      `__fish_complete_path` for `path`
- [ ] Walker + 3 template tests extended; existing snapshots still pass

---

### Step 6: Documentation
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Confirm exact MDX paths and `meta.json` conventions by
> reading `apps/docs/content/docs/guide/` before writing the new pages.
> If `meta.json` uses an explicit page list, add the two new entries.

- [ ] `apps/docs/content/docs/guide/built-in-types.mdx` created
      (quick-reference table, per-type sections, `parse` escape hatch
      section, common pitfalls)
- [ ] `apps/docs/content/docs/guide/recipes.mdx` created with ≥10
      copy-paste recipes
- [ ] `packages/core/README.md` updated with new types + `parse` section
- [ ] `apps/docs/content/docs/api/types.mdx` (or equivalent) updated
- [ ] `completion.mdx` and `packages/plugins/README.md` note new `path`
      file-completion behavior
- [ ] `flags.mdx` / `arguments.mdx` updated if they enumerate
      `ValueType`; `meta.json` adjusted only if it uses an explicit list

---

### Step 7: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing:
      `bun run check && bun run check:types && bun run test`
- [ ] `bun run build` passes
- [ ] Manual smoke test of each new built-in type and the `parse`
      escape hatch (incl. the `Number, default: "3000"` regression)
- [ ] Two changesets added (`@crustjs/core` minor,
      `@crustjs/plugins` patch)

---

### Step 8: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] `bun run build --filter=docs` passes (built-in-types.mdx and
      recipes.mdx render correctly)
- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged below

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
| 2026-04-29 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
