# Execution Workflow — Crust Taskplane Backlog

**For the operator running `/orch` (human + assistant). Workers do not read this.**

> **Status (2026-05-03): SUPERSEDED by [`PR-PLAN.md`](./PR-PLAN.md).**
>
> The current live PR grouping, dependency wave order, and per-task status
> are tracked in `PR-PLAN.md`. That file reflects the post-merge reality
> (TP-001/2/7/8 merged, TP-016 added mid-flight) and the current 8-PR + PR-I
> plan. The original 5-PR plan below is kept for historical context only.
>
> Per-task authoritative state: each task's own `STATUS.md`.

---

## Goal

Ship the 12 staged tasks (TP-001..TP-012) as **5 cohesive PRs** rather than
12 tiny PRs or one mega-PR. Each PR is reviewable in isolation; PRs A–D can
sit open simultaneously; PR E lands last.

## Current state (as of 2026-05-02)

| ID | Title | Status |
|---|---|---|
| TP-001 | bun-color-redesign | ✅ Merged via PR #111 |
| TP-002 | depth-aware-color-fallback | ✅ Merged via PR #111 |
| TP-003 | install-skill-bundle | Not Started |
| TP-004 | skill-plugin-custom-skills | Not Started |
| TP-005 | crustjs-utils-package | Not Started |
| TP-006 | skills-optional-agents-default | Not Started |
| TP-007 | validate-standard-schema-only | ✅ Merged via PR #113 |
| TP-008 | rename-autocomplete-to-did-you-mean | Not Started |
| TP-009 | flag-choices-and-hidden-commands | Not Started |
| TP-010 | completion-plugin-static | Not Started |
| TP-011 | consolidate-type-primitives-to-utils | Not Started |
| TP-012 | extend-valuetype-with-parse-escape-hatch | Not Started |
| TP-013 | prompts-polymorphic-validate | Not Started (Round 2) |
| TP-014 | validate-api-alignment | Not Started (Round 2) |
| TP-015 | dx-alignment-demo-and-docs | Blocked on TP-013 + TP-014 (Round 2) |

> When a batch finishes, update the status column above (or just rely on each
> task's `STATUS.md` — they're authoritative).

## PR groups (file-scope verified disjoint within Phase 1)

| PR | Tasks | Theme | Primary packages | Phase |
|---|---|---|---|---|
| **A** | TP-001 + TP-002 | Color / style redesign | `@crustjs/style` | 1 |
| **B** | TP-007 | Standard-Schema-only validate | `@crustjs/validate` | 1 |
| **C** | TP-003 + TP-004 + TP-005 + TP-006 | Skills hardening + utils package | `@crustjs/skills`, `@crustjs/create`, **new** `@crustjs/utils` | 1 |
| **D** | TP-008 + TP-009 + TP-010 | Shell completion feature | `@crustjs/plugins`, `@crustjs/core/types.ts` | 1 |
| **E** | TP-011 + TP-012 | Type system expansion | `@crustjs/utils`, `@crustjs/core`, `@crustjs/store`, `@crustjs/plugins` | 2 (after C+D merge) |

PR-E **must** wait for PR-C and PR-D to merge because:
- TP-011 imports from `@crustjs/utils` (created in TP-005, in PR-C)
- TP-012 uses the `choices` field (added in TP-009, in PR-D)
- TP-012 modifies completion templates (created in TP-010, in PR-D)

PR-A and PR-B are fully independent and can stay open during PR-E if needed.

---

## Phase 1 — fire off 4 parallel-reviewable PRs

Run these batches **sequentially** (orch only allows one batch at a time),
but each `orch_integrate(mode: "pr")` opens its PR without modifying the
local working branch — so all 4 PRs end up open on GitHub simultaneously.

### Batch A — Color / style

```
orch_start("taskplane-tasks/TP-001-bun-color-redesign/PROMPT.md taskplane-tasks/TP-002-depth-aware-color-fallback/PROMPT.md")
# wait for orch_status to show completed
orch_integrate(mode: "pr")
```

### Batch B — Validate

```
orch_start("taskplane-tasks/TP-007-validate-standard-schema-only/PROMPT.md")
orch_integrate(mode: "pr")
```

### Batch C — Skills + utils

```
orch_start("taskplane-tasks/TP-003-install-skill-bundle/PROMPT.md taskplane-tasks/TP-004-skill-plugin-custom-skills/PROMPT.md taskplane-tasks/TP-005-crustjs-utils-package/PROMPT.md taskplane-tasks/TP-006-skills-optional-agents-default/PROMPT.md")
orch_integrate(mode: "pr")
```

### Batch D — Shell completion

```
orch_start("taskplane-tasks/TP-008-rename-autocomplete-to-did-you-mean/PROMPT.md taskplane-tasks/TP-009-flag-choices-and-hidden-commands/PROMPT.md taskplane-tasks/TP-010-completion-plugin-static/PROMPT.md")
orch_integrate(mode: "pr")
```

After Batch D's PR is opened, **stop**. Wait for PR-C and PR-D to be merged
on GitHub (review + merge button). PR-A and PR-B can still be open during
Phase 2.

---

## Phase 2 — type system expansion (after C+D merge)

```
git checkout main
git pull                    # pulls TP-001..010 into local main
git status                  # confirm clean

orch_start("taskplane-tasks/TP-011-consolidate-type-primitives-to-utils/PROMPT.md taskplane-tasks/TP-012-extend-valuetype-with-parse-escape-hatch/PROMPT.md")
orch_integrate(mode: "pr")
```

---

## Between-batch checklist

Before starting the next batch:

```sh
orch_status                 # must show "no batch running" or "completed"
git status                  # working branch should be clean
                            #   (mode:"pr" never touches local working branch)
git log --oneline -5        # confirm you're on the expected commit
```

For Phase 2 only: also verify `git pull` brought in TP-005 (utils package)
and TP-009/TP-010 work — check that `packages/utils/` exists and
`packages/plugins/src/completion/` exists.

## Recovery — what to do if a batch fails

### A single task in the batch fails
```
orch_status                 # shows which task failed
read_lane_logs(lane: N)     # inspect error
orch_retry_task("TP-XXX")   # if transient (context pressure, flake)
orch_skip_task("TP-XXX")    # if unfixable; will unblock dependents
orch_resume(force: true)    # continue
```

### Mixed-outcome wave (some succeeded, some failed on same lane)
```
orch_force_merge(skipFailed: true)  # auto-skip failures, merge succeeded ones
orch_resume(force: true)
```

### Batch is genuinely broken
```
orch_abort                  # graceful — preserves worktrees for inspection
# investigate, fix the PROMPT.md or task, then:
orch_resume(force: true)
```

### A PR is opened but the code is wrong
- Comment on the PR with the issue
- Either: push a manual fix to the orch branch, or close the PR + abort,
  unstick the relevant task's STATUS, and re-run that batch
- Do NOT cherry-pick into main without re-running the affected task

## Mode reference

| Mode | When to use |
|---|---|
| `orch_integrate(mode: "pr")` | **Default for this workflow** — each batch becomes its own PR |
| `orch_integrate(mode: "fast-forward")` | Solo work, no review gate, want changes on local working branch immediately |
| `orch_integrate(mode: "merge")` | Same as fast-forward but with a merge commit (preserves batch boundary in history) |

For TP-001..012 we use **`mode: "pr"` exclusively**.

## Why this order (not strictly dependency order)

Topological sort of dep graph would be:
```
Wave 1: 001, 003, 006, 007, 008, 009  (no blockers)
Wave 2: 002, 004, 010                  (block on Wave 1)
Wave 3: 005                            (blocks on 003+004)
Wave 4: 011                            (blocks on 005)
Wave 5: 012                            (blocks on 009+010+011)
```

The 5-PR grouping batches Wave 1+2+3 into PRs A–D so review surface stays
small and cohesive. The orchestrator handles the within-batch wave order
automatically — when you pass multiple PROMPT paths to `orch_start`, it
reads each task's `## Dependencies` section and schedules waves correctly.

## What if I want to deviate?

- **One task per PR (12 PRs)**: just call `orch_start` with a single
  PROMPT.md path each time. Slow but maximum reviewability.
- **One mega-PR (1 PR)**: `orch_start("all")` → `orch_integrate(mode:"pr")`.
  Fastest to ship if you trust the agents.
- **Skip a task**: `orch_skip_task("TP-XXX")` before starting. Dependents
  unblock automatically.

## See also

- `taskplane-tasks/CONTEXT.md` — task-area metadata, tech-debt log, taskplane conventions
- `taskplane-tasks/TP-XXX-*/PROMPT.md` — per-task self-contained spec
- `taskplane-tasks/TP-XXX-*/STATUS.md` — per-task progress log (worker-authored)
- `/tmp/crust-types-final/FINAL.md` — locked spec for TP-011 + TP-012
- `/tmp/crust-completion-verification/PLAN.md` — locked spec for TP-008..010
- `/tmp/crust-types-oracle/{A,B,C,D}-*.md` — oracle reviews informing TP-011/012 design

## Doc maintenance

When a batch ships:
1. Update the "Current state" table above (mark tasks Done)
2. If a PR is opened but not yet merged, note the PR URL next to the batch
3. After all 12 ship: archive this file (`mv WORKFLOW.md WORKFLOW-archived-2026-XX.md`)
   and write a fresh one for the next planning round.

---

# Round 2 — DX Alignment (TP-013 / TP-014 / TP-015)

**Added:** 2026-05-02
**Goal:** Align `@crustjs/prompts` and `@crustjs/validate` so every helper
follows the same "schema in, typed value out" model as `@crustjs/core`'s
command DSL. Ships as a coordinated `0.2.0` release across two packages.

## Tasks

| ID | Title | Size | Review | Package | Phase |
|---|---|---|---|---|---|
| TP-013 | prompts-polymorphic-validate | S | 1 (Plan) | `@crustjs/prompts` | additive |
| TP-014 | validate-api-alignment | M | 2 (Plan+Code) | `@crustjs/validate` | breaking |
| TP-015 | dx-alignment-demo-and-docs | S | 1 (Plan) | `apps/demo-validate`, `apps/docs`, `packages/store/README` | consumer-side |

## Dependency graph

```
TP-013  (prompts schema slot)        ───┐
                                          ├──> TP-015  (demo + docs)
TP-014  (validate cleanup + field()) ───┘
```

TP-013 and TP-014 are **fully independent** — they touch different packages.
TP-015 depends on both having merged.

## Release shape: one coordinated `0.2.0`

User's call: **one minor version release**, but PRs can be separate. So:

- TP-013 lands as PR-A  →  bumps `@crustjs/prompts` to `0.2.0`
- TP-014 lands as PR-B  →  bumps `@crustjs/validate` to `0.2.0`
- TP-015 lands as PR-C  →  no version bump (consumer-side only)
- All three PRs land in the same release window; changesets coalesce into
  one set of release notes per package via `bunx changeset version`

## Locked design decisions (from grilling session)

These are reproduced in each task's PROMPT.md — listed here as a single index.
**Workers should NOT re-litigate these in `## Amendments`.**

1. **`field()` shape:** `field(schema, opts?)` mirrors `arg(name, schema, opts?)`
   and `flag(schema, opts?)`. `FieldOptions = { type, default, description, array }`.
   No `validate` key (refinements live inside the schema).
2. **Prompt error rendering:** First issue, single line, no toggle. The
   `errorStrategy` concept is dropped entirely.
3. **Public surface trim:** Drop `parsePromptValue*`, `promptValidator`,
   `fieldSync`, old `field`. Rename `parsePromptValue` → `parseValue`.
   Final surface: `validateStandard`, `validateStandardSync`, `parseValue`,
   `field` (new shape), `isStandardSchema`, plus unchanged `arg`/`flag`/
   `commandValidator`.
4. **Effect annotation defaults:** Silent fallback when `validate(undefined)`
   doesn't recover the default. Users supply `field(schema, { default: x })`
   explicitly when needed. No warn, no throw.
5. **Layered validation:** None. All validation flows through the schema.
   Extra checks go via `.refine()` / `Schema.filter()` on the schema itself.
6. **Prompts polymorphic validate:** Accepts `StandardSchema` OR `ValidateFn<string>`.
   `@crustjs/prompts` gains `@standard-schema/spec` as a dep (not
   `@crustjs/validate`). Inline 3-line `isStandardSchema()` discriminator.
7. **Implementation approach:** Direct, sequential, no orchestrator workers
   for execution — the user supervises commit-by-commit. (This was the
   in-session decision; tasks are still staged here so a future operator
   could run them via `/orch` if context is recovered.)

## Suggested batches

```
# Wave 1: PR-A and PR-B in parallel (independent packages)
orch_start("taskplane-tasks/TP-013-prompts-polymorphic-validate/PROMPT.md taskplane-tasks/TP-014-validate-api-alignment/PROMPT.md")
orch_integrate(mode: "pr")

# Wait for PR-A and PR-B to merge

# Wave 2: PR-C (consumer-side, depends on the above)
orch_start("taskplane-tasks/TP-015-dx-alignment-demo-and-docs/PROMPT.md")
orch_integrate(mode: "pr")
```
