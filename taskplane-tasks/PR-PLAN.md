# PR Plan — 12 Pending Tasks → 8 PRs (+1 added mid-flight)

**Created:** 2026-05-02
**Last updated:** 2026-05-07 (post-TP-014 merge + recheck audit)
**Status:** In progress

Groups the 12 not-started Taskplane tasks into 8 logically cohesive
pull requests. Tracks are mostly independent and can land in parallel.
TP-016 (`command-aliases`, M-sized, no deps) was added 2026-05-03 — see PR-I below.

## Progress

| PR | Status | Result |
|----|--------|--------|
| **PR-A** | ✅ Merged | [#114](https://github.com/chenxin-yan/crust/pull/114) (TP-006) |
| **PR-E** | ✅ Merged | [#115](https://github.com/chenxin-yan/crust/pull/115) (TP-008) |
| **PR-I** | ✅ Merged | [#116](https://github.com/chenxin-yan/crust/pull/116) (TP-016) |
| **PR-H₁** | ✅ Merged | [#117](https://github.com/chenxin-yan/crust/pull/117) (TP-013) |
| **PR-H₂** | ✅ Merged | [#118](https://github.com/chenxin-yan/crust/pull/118) (TP-014) + follow-up commit `1678945` (docs cleanup) — also subsumed TP-015 |
| PR-B, C, D, F, G | ⏸ Pending | — |

> **Note (2026-05-07):** PR-H was split into PR-H₁ (TP-013, #117) and PR-H₂
> (TP-014 + TP-015, #118). PR #118 carried the cross-package docs/demo
> sweep that TP-015 was originally scoped to do, so TP-015 is now marked
> `TASK_OBSOLETE` (verified by 2026-05-07 audit at
> `.pi/supervisor/scout-reports/post-pr118-tp015.md`).

### Staleness audit 2026-05-06 (post-PR-I)

Four parallel scouts re-checked the 10 pending PROMPTs against current `main`. Findings:

| Track | Tasks | Result | Action taken |
|-------|-------|--------|--------------|
| Skills | TP-003, TP-004, TP-005 | ✅ No staleness (existing Amendment 1 in TP-003 covers `resolveAgents` rename) | None needed |
| Plugins | TP-009, TP-010 | ⚠️ TP-016 changed `formatCommandsSection`, `findSuggestions` signature, added `CommandMeta.aliases` | Added Amendment 1 to both PROMPTs (preserve `formatCommandLabel`, alias-aware completion spec) |
| Refactor | TP-011, TP-012 | ✅ No code staleness; blocked only by upstream deps | None needed |
| Validate | TP-013, TP-014, TP-015 | ⚠️ TP-014 already has Amendment 1 from prior pre-flight | None needed |

Audit reports archived under `.pi/supervisor/scout-reports/tp-track-*.md`.

---

## PR Table

| PR | Tasks | Theme | Stacks on | Notes |
|----|-------|-------|-----------|-------|
| ~~**PR-A**~~ | ~~TP-006~~ | ~~`@crustjs/skills` — `agents` optional default~~ | — | ✅ **Merged** ([#114](https://github.com/chenxin-yan/crust/pull/114)) |
| **PR-B** | TP-003 + TP-004 | Skill bundles (closes [#110](https://github.com/chenxin-yan/crust/issues/110)) | — | L+L. TP-004 is the only consumer of TP-003's new API; ship together. |
| **PR-C** | TP-005 | New `@crustjs/utils` package (+ `resolveSourceDir` dedup) | PR-B | M. Dedups the resolver copy introduced by PR-B. |
| **PR-D** | TP-011 | Move `ValueType` / coercion primitives → `@crustjs/utils` | PR-C | M. Pure refactor across `core` + `store`. |
| ~~**PR-E**~~ | ~~TP-008~~ | ~~Rename `autoCompletePlugin` → `didYouMeanPlugin` (alias)~~ | — | ✅ **Merged** ([#115](https://github.com/chenxin-yan/crust/pull/115)) |
| **PR-F** | TP-009 + TP-010 | `completionPlugin` (with `choices` / `hidden` foundation) | PR-E | M+L. TP-009 fields exist solely for TP-010. |
| **PR-G** | TP-012 | `ValueType: url \| path \| json` + `parse?:` escape hatch | PR-D + PR-F | L. Cross-track bottleneck — needs both utils + completion. |
| ~~**PR-H₁**~~ | ~~TP-013~~ | ~~Polymorphic `validate:` slot on `input()` / `password()`~~ | — | ✅ **Merged** ([#117](https://github.com/chenxin-yan/crust/pull/117)) |
| ~~**PR-H₂**~~ | ~~TP-014 (+ subsumed TP-015)~~ | ~~`@crustjs/validate` API alignment + docs/demo~~ | PR-H₁ | ✅ **Merged** ([#118](https://github.com/chenxin-yan/crust/pull/118)) |
| **PR-I** | TP-016 | Add `aliases` to commands and subcommands | — | M. Plan + code review (Level 2). Touches `core`, `plugins`, `man`. Standalone — added 2026-05-03. |

---

## Landing Tracks

```
Skills:    PR-A ──┐  (✅ merged)
           PR-B ──→ PR-C ──→ PR-D ─┐
                                    │
Plugins:   PR-E ──→ PR-F ───────────┼──→ PR-G    (PR-E ✅ merged)
                                    │
Validate:  PR-H ────────────────────┘ (independent)
Aliases:   PR-I  (✅ merged)
```

**Parallel-launchable now:** PR-B, PR-F, PR-H

**Bottleneck:** PR-G — the only PR with cross-track dependencies.

---

## Grouping Rationale

### Where multi-task PRs are justified

- **PR-B (TP-003+TP-004)** — same GitHub issue. TP-004 is the *only* caller of
  the public API TP-003 introduces. Shipping TP-003 alone leaves a dangling
  public entrypoint and produces a confusing two-line changelog.
- **PR-F (TP-009+TP-010)** — TP-009's additive `core` fields (`choices`,
  `hidden`) exist *purely* to feed TP-010. Decoupling exposes public types
  that no shipped code consumes.
- **PR-H (TP-013+TP-014+TP-015)** — coordinated "schema-in / typed-value-out"
  alignment across `validate` + `prompts`. PROMPTs explicitly frame TP-015 as
  "the visible payoff" of the alignment work. Splitting risks intermediate
  states where docs/demo don't match the shipped API.

### Where dependency chains are kept as separate PRs

- **PR-C separated from PR-B** — PR-B is already L+L with Plan-and-Code
  review on both halves. Adding a new published package would triple blast
  radius across 3 packages.
- **PR-D separated from PR-C** — PR-D mutates `core` + `store` public
  re-export surfaces. Different review concern than "create new package".

---

## Execution Notes

- Each PR's tasks should be batched together via `orch_start` and integrated
  via `orch_integrate mode=pr`.
- Independent PRs (A, B, E, H) can run as concurrent batches if desired,
  but Crust is a single-worktree repo — running them serially is simpler.
- Stacked PRs (B→C→D, E→F, then G) require the parent PR to merge to `main`
  before the child batch starts so `main` reflects the dep.

---

### Staleness recheck 2026-05-07 (post-TP-013 / PR #117 merge)

After PR #117 landed, audited the 9 remaining PROMPTs against the merged code:

- **TP-003, TP-004, TP-005, TP-009, TP-010, TP-011, TP-012:** no `packages/prompts` references. Unaffected.
- **TP-014:** explicitly references TP-013's polymorphic slot as a verification target. The 4 predictions in TP-014's PROMPT (lines 187, 331, 361, 382) all hold against the merged code:
  1. ✅ `packages/prompts/src/` has zero `@crustjs/validate` runtime imports
  2. ✅ `packages/prompts/package.json` declares `@standard-schema/spec ^1.1.0`
  3. ✅ `isStandardSchema` is inline in `packages/prompts/src/core/types.ts:142` (not imported)
  4. ✅ `apps/docs/content/docs/modules/prompts.mdx` documents the polymorphic shape (lines 15, 84, 105)
- **TP-015:** docs/demo task; references TP-013 acceptance only. No amendments needed.

**Verdict:** no staleness amendments needed. PR-H₂ (TP-014 → TP-015) can run as written. TP-014 is recommended as the next solo batch (largest remaining, has prior Amendment 1).

---

### Staleness recheck 2026-05-07 (post-TP-014 / PR #118 merge + follow-up `1678945`)

After PR #118 landed, audited the 8 remaining-on-paper PROMPTs:

- **TP-003, TP-004, TP-005** (skills track) — `NO_AMENDMENT_NEEDED`. Zero references to validate APIs; `@crustjs/skills` has no validate dep.
- **TP-009, TP-010** (plugins track) — `NO_AMENDMENT_NEEDED`. Pure core/plugins work; no validate touching.
- **TP-011** (refactor) — `NO_AMENDMENT_NEEDED`. The PROMPT explicitly defers validate's third `ValueType` copy; added Amendment 1 (2026-05-07) noting validate's new copy at `schema-types.ts:30` is in scope of a future cleanup task, not TP-011.
- **TP-012** (refactor) — `NO_AMENDMENT_NEEDED`. Explicit "Do NOT touch validate" already in scope.
- **TP-015** (docs/demo) — `TASK_OBSOLETE`. PR #118 already executed every Step 1 deliverable: `field()` factory examples in both `validate.mdx` and `store.mdx`; clean migration sections in both READMEs; no leftover `parsePromptValue`/`promptValidator`/`fieldSync` refs in any production doc; cross-links resolve. `.DONE` marker created with `disposition: TASK_OBSOLETE`.

**Net result:** PR-H₂ is fully closed (PR #118 alone). 7 pending PROMPTs remain (TP-003, TP-004, TP-005, TP-009, TP-010, TP-011, TP-012) split across 5 PRs (B, C, D, F, G). No source amendments needed for any of them.

Full audit reports archived under `.pi/supervisor/scout-reports/post-pr118-{skills,plugins,refactor,tp015}.md`.
