# Task: TP-006 — Make `agents` optional in `@crustjs/skills` core entrypoints

**Created:** 2026-04-29
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Small additive public API change touching three sibling
entrypoints. Plan-only review locks the default-resolution semantics and the
scope of the optionality. Code change is mechanical and small enough that an
extra code-review pass would not surface meaningful issues.
**Score:** 3/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-006-skills-optional-agents-default/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Make the `agents` field optional on `GenerateOptions`, `UninstallOptions`, and
`StatusOptions` in `@crustjs/skills`. When omitted, all three entrypoints
default to `[...getUniversalAgents(), ...await detectInstalledAgents()]` — the
union of always-included universal agents and additional agents detected on
the running machine. Users who want explicit control continue to pass an
explicit list. Update the public docs to teach the omitted-field form as the
primary example, removing the stale hardcoded `universalAgents` array that
currently appears in `apps/docs/content/docs/modules/skills.mdx`. The change
is purely additive — every existing call site continues to work without
modification.

## Dependencies

- **None**

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `packages/skills/src/types.ts` — `GenerateOptions`, `UninstallOptions`, `StatusOptions`
- `packages/skills/src/generate.ts` — three entrypoints to modify (`generateSkill`, `uninstallSkill`, `skillStatus`)
- `packages/skills/src/agents.ts` — `getUniversalAgents`, `detectInstalledAgents` (the building blocks of the default)
- `packages/skills/src/index.ts` — public re-exports (no changes expected)
- `packages/skills/README.md` — check for stale hardcoded examples
- `apps/docs/content/docs/modules/skills.mdx` lines ~215-265 — primary stale example to fix

## Environment

- **Workspace:** `packages/skills/` (primary), `apps/docs/` (docs)
- **Services required:** None

## File Scope

- `packages/skills/src/types.ts` (modify — three interfaces gain `?` on `agents` + TSDoc)
- `packages/skills/src/generate.ts` (modify — three signature handlers + one private helper)
- `packages/skills/src/generate.test.ts` (extend — default-resolution coverage)
- `packages/skills/README.md` (modify only if it carries the stale example pattern)
- `apps/docs/content/docs/modules/skills.mdx` (modify — replace hardcoded `universalAgents` array example)
- `.changeset/*.md` (new — minor)

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] `bun install` clean
- [ ] Existing `@crustjs/skills` tests pass: `cd packages/skills && bun test`
- [ ] Confirm no other entrypoint in the package takes `agents: AgentTarget[]` as a required field beyond the three listed

### Step 1: Plan checkpoint — lock default-resolution semantics

> **Review override: plan only** — verify the contract; code is mechanical.

Produce a short design note (in STATUS.md Notes section) confirming:

- [ ] **Optionality applied uniformly to all three entrypoints**: `GenerateOptions.agents`, `UninstallOptions.agents`, `StatusOptions.agents` all become `agents?: AgentTarget[]`.
- [ ] **Default value (identical across all three)**: `[...getUniversalAgents(), ...await detectInstalledAgents()]`. Resolved at call time inside the entrypoint (not via a `??` parameter default — must be a runtime resolution because `detectInstalledAgents` is async).
- [ ] **Explicit empty array preserved**: `agents: []` continues to mean "install/uninstall/check for nothing." Only `undefined` (or omitted) triggers the default.
- [ ] **Centralized helper**: a private `resolveAgents(provided: AgentTarget[] | undefined): Promise<AgentTarget[]>` in `generate.ts` (or a new file if cleaner) handles the resolution. All three entrypoints call it as their first action.
- [ ] **Behavior change to document**: omitting `agents` now performs filesystem detection (a `detectInstalledAgents()` call). Previously these functions did no I/O for agent resolution. The TSDoc on each interface field must call this out, and the docs site example must mention it.
- [ ] **Plugin paths unaffected**: `packages/skills/src/plugin.ts` continues to pass explicit agent lists in every call (verified at task creation; re-grep during plan review). No plugin-level changes are part of this task.
- [ ] **`AgentTarget` type unchanged**.
- [ ] **Public API surface gained**: zero new exports. (Three optionality changes only.)
- [ ] **Out of scope**:
  - No new helper exports (`resolveInstallTargets`, etc. — explicitly rejected by user)
  - No changes to interactive `skill` subcommand behavior
  - No changes to `autoUpdateSkills`
  - No changes to `getUniversalAgents` / `detectInstalledAgents` / `getAdditionalAgents` signatures

**Do not start Step 2 until plan review verdict is APPROVE.**

### Step 2: Update types

- [ ] In `packages/skills/src/types.ts`:
  - `GenerateOptions.agents` → `agents?: AgentTarget[]`
  - `UninstallOptions.agents` → `agents?: AgentTarget[]`
  - `StatusOptions.agents` → `agents?: AgentTarget[]`
- [ ] Update each TSDoc to say:
  > Agent targets to install/uninstall/check. When omitted, defaults to
  > `[...getUniversalAgents(), ...await detectInstalledAgents()]` — the union
  > of always-included universal agents and additional agents detected on
  > the current machine. Pass an explicit array (including the empty array)
  > to override.
- [ ] `cd packages/skills && bun run check:types` passes

### Step 3: Implement default-resolution helper + wire into all three entrypoints

- [ ] Add private `resolveAgents(provided: AgentTarget[] | undefined): Promise<AgentTarget[]>` in `packages/skills/src/generate.ts` (top-level, not exported). Implementation:
  ```ts
  async function resolveAgents(
    provided: AgentTarget[] | undefined,
  ): Promise<AgentTarget[]> {
    if (provided !== undefined) return provided;
    return [...getUniversalAgents(), ...await detectInstalledAgents()];
  }
  ```
- [ ] In `generateSkill`: at the start of the function (after destructuring), call `const agents = await resolveAgents(options.agents);` and use `agents` everywhere `options.agents` was previously referenced.
- [ ] In `uninstallSkill`: same pattern.
- [ ] In `skillStatus`: same pattern.
- [ ] Verify the three function bodies still pass their existing logic — only the source of `agents` changes.
- [ ] `cd packages/skills && bun run check:types` passes

### Step 4: Tests

- [ ] Extend `packages/skills/src/generate.test.ts` with these new cases:
  - [ ] `generateSkill` called without `agents`: result includes universal agents AND any agents that `detectInstalledAgents` returns from a fixture/stub
  - [ ] `generateSkill` called with `agents: []`: result has zero per-agent entries (current behavior preserved)
  - [ ] `generateSkill` called with `agents: ["claude-code"]`: only the explicit list is processed (current behavior preserved)
  - [ ] `uninstallSkill` called without `agents`: targets universal + detected
  - [ ] `uninstallSkill` called with explicit `agents: []`: no-op
  - [ ] `skillStatus` called without `agents`: returns status for universal + detected
  - [ ] `skillStatus` called with explicit `agents: []`: returns empty array
- [ ] Use the existing fixture/stub pattern from `generate.test.ts` (look for how `detectInstalledAgents` is currently exercised; mirror that)
- [ ] If `detectInstalledAgents` is not currently stubbable in the test environment, use the `commandChecker` option (visible in `agents.ts:357`) to inject a deterministic detection function
- [ ] Run targeted tests: `cd packages/skills && bun test`

### Step 5: Documentation — fix the stale example and teach the new default

- [ ] In `apps/docs/content/docs/modules/skills.mdx`:
  - Replace the existing lower-level-primitives example (currently lines ~215-265) with two examples:
    - **Minimal default example** (no hardcoded agent list, no manual composition):
      ```ts
      import { generateSkill, skillStatus, uninstallSkill } from "@crustjs/skills";

      // Install — defaults to universal + detected additional agents
      const result = await generateSkill({
        command: rootCommand,
        meta: { name: "my-cli", description: "My CLI", version: "1.0.0" },
        scope: "global",
      });

      // Status uses the same default
      const status = await skillStatus({ name: "my-cli" });

      // Uninstall uses the same default
      const removed = await uninstallSkill({ name: "my-cli" });
      ```
    - **Power-user explicit example** (showing how to override):
      ```ts
      import {
        detectInstalledAgents,
        getUniversalAgents,
        generateSkill,
        isValidSkillName,
      } from "@crustjs/skills";

      isValidSkillName("my-cli"); // true

      const universal = getUniversalAgents();
      const additional = await detectInstalledAgents();

      await generateSkill({
        command: rootCommand,
        meta: { name: "my-cli", description: "My CLI", version: "1.0.0" },
        agents: [...universal, ...additional],   // explicit form
        scope: "global",
      });
      ```
  - Add a one-sentence callout above the minimal example noting that omitting `agents` performs a filesystem probe via `detectInstalledAgents()`
  - Remove the stale hardcoded `universalAgents` array entirely
- [ ] In `packages/skills/README.md`: scan for any equivalent stale example and apply the same fix. If none, leave untouched.
- [ ] Cross-link: ensure the new docs paragraph mentions that `getUniversalAgents()` and `detectInstalledAgents()` are still exported for callers who want fine-grained control.

### Step 6: Add changeset

- [ ] Run `bunx changeset` and select `@crustjs/skills` with a **minor** bump
- [ ] Body must:
  - [ ] State that `agents` is now optional on `generateSkill`, `uninstallSkill`, and `skillStatus`
  - [ ] Document the default: `[...getUniversalAgents(), ...await detectInstalledAgents()]`
  - [ ] Note the new implicit filesystem probe
  - [ ] Confirm that all existing callers continue to work without modification
  - [ ] Show a one-line before/after migration example

### Step 7: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] Run FULL test suite: `bun run test`
- [ ] Run lint: `bun run check`
- [ ] Run type-check: `bun run check:types`
- [ ] Run build: `bun run build`
- [ ] Fix all failures

### Step 8: Documentation & Delivery

- [ ] "Must Update" docs modified (verified in Step 5)
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `apps/docs/content/docs/modules/skills.mdx` — replace stale lower-level example
- `packages/skills/README.md` — same fix if applicable

**Check If Affected:**
- `packages/skills/CHANGELOG.md` — auto-updated by Changesets; do **not** hand-edit
- Any guide page in `apps/docs/content/docs/guide/` that references the same pattern
- Any AGENTS.md / CONTRIBUTING.md examples that show explicit agent lists

## Completion Criteria

- [ ] All steps complete
- [ ] `bun run check && bun run check:types && bun run test && bun run build` all pass
- [ ] Plan-review APPROVE before Step 2
- [ ] Changeset present in `.changeset/`

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-006): complete Step N — description`
- **Bug fixes:** `fix(TP-006): description`
- **Tests:** `test(TP-006): description`
- **Hydration:** `hydrate: TP-006 expand Step N checkboxes`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message
- Add a new public helper export (e.g. `resolveInstallTargets`) — explicitly rejected
- Change the signature of `getUniversalAgents`, `getAdditionalAgents`, `detectInstalledAgents`, or `isUniversalAgent`
- Change interactive `skill` subcommand behavior or `autoUpdateSkills`
- Change `AgentTarget` type
- Hand-edit `CHANGELOG.md` files
- Make `agents` optional on any other public interface beyond the three listed

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
