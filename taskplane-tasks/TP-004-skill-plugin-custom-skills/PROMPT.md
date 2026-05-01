# Task: TP-004 — Add `customSkills` to `skillPlugin` for hand-authored bundles

**Created:** 2026-04-29
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Extends the public `SkillPluginOptions` shape and changes the
plugin's lifecycle (`setup`, `autoUpdateSkills`) and interactive command
behavior to manage multiple skills (one auto-generated, N hand-authored
bundles). Plan review locks the multiselect UX and reconciliation rules; code
review verifies that single-skill behavior is unchanged when `customSkills`
is omitted.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-004-skill-plugin-custom-skills/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Resolve the higher-level half of [issue #110](https://github.com/chenxin-yan/crust/issues/110):
extend `skillPlugin` so a CLI can register hand-authored skill bundles
alongside the auto-generated command-reference skill. A new `customSkills`
option on `SkillPluginOptions` accepts an array of `{ meta, sourceDir, scope?,
installMode? }` entries. Each entry is managed through the same plugin
lifecycle as the main skill — auto-update on version change, surface in the
interactive `skill` subcommand multiselect, support uninstall via the same
toggle UX, and respect `autoUpdate: false` and `--all` non-interactive mode.
The plugin uses `installSkillBundle` (from TP-003) for the bundle path and
`generateSkill` for the main path, sharing the canonical `.crust/skills/`
store. When `customSkills` is omitted or empty, plugin behavior is byte-
identical to today.

## Dependencies

- **Task:** TP-003 (introduces `installSkillBundle`, the entrypoint this task wraps)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- Issue body: https://github.com/chenxin-yan/crust/issues/110
- `packages/skills/src/plugin.ts` — current plugin shape and interactive command
- `packages/skills/src/plugin.test.ts` — existing test patterns
- `packages/skills/src/types.ts` — `SkillPluginOptions` to extend
- `packages/skills/src/generate.ts` — `generateSkill`, `skillStatus`, `uninstallSkill`
- `packages/skills/src/bundle.ts` — `installSkillBundle` (created in TP-003)
- `packages/skills/README.md` — current plugin docs
- `apps/docs/content/docs/modules/skills.mdx` — module reference page

## Environment

- **Workspace:** `packages/skills/` (primary), `apps/docs/` (docs only)
- **Services required:** None

## File Scope

- `packages/skills/src/plugin.ts` (modify)
- `packages/skills/src/plugin.test.ts` (extend)
- `packages/skills/src/types.ts` (modify — `CustomSkillConfig`, extend `SkillPluginOptions`)
- `packages/skills/src/index.ts` (modify — export `CustomSkillConfig`)
- `packages/skills/tests/fixtures/` (extend — additional bundle fixtures may be needed for plugin-level integration tests)
- `packages/skills/README.md` (modify — `customSkills` section)
- `apps/docs/content/docs/modules/skills.mdx` (modify)
- `taskplane-tasks/CONTEXT.md` (modify — mark plugin-integration follow-up complete)
- `.changeset/*.md` (new — minor)

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] TP-003 changes are present on the working branch (`installSkillBundle` is exported from `@crustjs/skills`)
- [ ] `bun install` clean
- [ ] Existing plugin tests pass: `cd packages/skills && bun test src/plugin.test.ts`

### Step 1: Plan checkpoint — lock UX + reconciliation contract

> **Review override: plan review** — verify the option shape, multiselect UX, and reconciliation rules before writing code.

Produce a short design note (in STATUS.md Notes section) confirming:

- [ ] **`CustomSkillConfig` shape** finalized:
  - `meta: SkillMeta`
  - `sourceDir: string | URL` — same three-mode resolution as TP-003's `installSkillBundle` (URL with `file:` protocol, absolute string path, or relative string resolved from the nearest `package.json` walking up from `process.argv[1]`). The canonical form for plugin authors is the bare relative string `"skills/<name>"`.
  - `scope?: Scope` (default: inherits plugin's `defaultScope` resolution)
  - `installMode?: SkillInstallMode` (default: inherits plugin's `installMode`)
- [ ] **`SkillPluginOptions.customSkills?: CustomSkillConfig[]`** added; default `[]`
- [ ] **Validation at `setup()`**:
  - Each `customSkills[].meta.name` must satisfy `isValidSkillName`
  - `customSkills[].meta.name` must not collide with the main skill's name (derived from root command meta)
  - `customSkills[].meta.name` must be unique within the array
  - `sourceDir` type-check (must be `string` or `URL`) runs at setup; resolution-time errors (non-`file:` URL, missing `process.argv[1]`, no `package.json` walking up, missing directory, missing `SKILL.md`) defer to the `installSkillBundle` invocation and surface there with descriptive messages
  - All setup-time validation failures throw at `setup()` with descriptive messages
- [ ] **`autoUpdateSkills` extension**:
  - Existing main-skill loop runs first, unchanged
  - Then loop each `customSkills` entry: call `skillStatus` against per-entry resolved scope; if installed and outdated, call `installSkillBundle` to update
  - Per-entry scope resolution: `entry.scope ?? options.defaultScope ?? "global"` (mirrors today's main-skill resolution; never prompts in autoUpdate)
  - Skipped entirely when `options.autoUpdate === false`
  - Skipped entirely when the user is invoking the `skill` subcommand itself (matches today's main-skill behavior)
- [ ] **Interactive `skill` command UX (chosen approach)**:
  - **Sequential per-skill multiselect prompts.** Run the existing main-skill multiselect first; then for each `customSkills` entry, run an equivalent multiselect with that bundle's name in the prompt message (e.g. `"Select agents to install skills for [ecommerce-funnel-builder]"`).
  - Each prompt is independent: pre-selection reflects that skill's installed state; toggle reconciles only that skill.
  - Trade-off accepted: `N+1` prompts when `N` custom skills are present. A future task can investigate a unified single-prompt UX (logged as tech debt at end of task).
- [ ] **`--all` non-interactive mode**:
  - Installs all detected agents for the main skill AND each `customSkills` entry without prompting (mirrors today's `--all` for main)
- [ ] **`skill update` subcommand extension**:
  - Same loop pattern as `autoUpdateSkills`: update main, then update each bundle
  - Output formatting reuses existing helpers; bundle entries include the bundle name in the heading line
- [ ] **Error handling**:
  - Per-entry failures during `autoUpdateSkills` are logged but do not abort other entries (mirrors today's per-agent resilience for the main skill)
  - In the interactive command, a single-entry failure aborts that entry only; subsequent entries still run
  - `SkillConflictError` (including `kindMismatch` from TP-003) surfaces to the user with the same overwrite-confirm UX used today
- [ ] **Out of scope:** unified single-prompt multi-skill UX, bundle scaffolding command, per-bundle `autoUpdate` override, per-bundle interactive scope prompt (bundles inherit the resolved scope of the multiselect session)

**Do not start Step 2 until plan review verdict is APPROVE.**

### Step 2: Extend types

- [ ] Add `CustomSkillConfig` to `packages/skills/src/types.ts` with full TSDoc
- [ ] Add `customSkills?: CustomSkillConfig[]` to `SkillPluginOptions` with TSDoc covering: when to use, default behavior when omitted, version-compare behavior, multiselect UX expectation
- [ ] Export `CustomSkillConfig` from `index.ts`

### Step 3: Add setup-time validation

- [ ] In `skillPlugin.setup`, before any other work: validate each `customSkills` entry per the rules from Step 1
- [ ] Add a small helper `validateCustomSkillsConfig(mainName, customSkills)` (private to `plugin.ts`) returning normalized config or throwing
- [ ] Targeted test pass: `cd packages/skills && bun test src/plugin.test.ts` (extend in Step 7)

### Step 4: Extend `autoUpdateSkills`

- [ ] After the existing main-skill loop, iterate `customSkills`:
  - [ ] Resolve per-entry scope
  - [ ] Call `skillStatus({ name: entry.meta.name, agents, scope })`
  - [ ] Compute `needsUpdate` per agent (mirrors today's logic: installed but version differs)
  - [ ] If any needs update, call `installSkillBundle({ meta: entry.meta, sourceDir: entry.sourceDir, agents: agentsToUpdate, scope, installMode })`
  - [ ] Format output using the existing `formatAgentLabels` / `formatInstallOutput` helpers (extend if necessary to include the bundle name)
- [ ] Wrap each entry in try/catch; log errors with the entry name and continue

### Step 5: Extend the interactive `skill` command

- [ ] After the main-skill multiselect + reconciliation block, add an analogous block per `customSkills` entry:
  - [ ] Use the same `skillStatus` → choices → multiselect → diff → install/uninstall pipeline
  - [ ] Replace `generateSkill` calls with `installSkillBundle` for bundle entries
  - [ ] Replace prompt message with `"Select agents to install skills for [<bundle-name>]"`
  - [ ] Pre-selection reflects only that bundle's installed state
- [ ] `--all` path: extend to fan out across all skills (main + customSkills) using the same agent set
- [ ] Reuse existing `SkillConflictError` overwrite-confirm UX; verify `kindMismatch` errors render readable messages (the existing handler should already work but spot-check)
- [ ] Refactor opportunity (optional, only if it does not balloon scope): factor the per-skill reconciliation block into a private helper `reconcileSkill({ name, install, agents, status, ... })` that both main and bundle paths call. Keep the refactor narrow.

### Step 6: Extend `skill update` subcommand

- [ ] Locate `buildSkillUpdateCommand` (referenced from `skillPlugin.setup`)
- [ ] Mirror the `autoUpdateSkills` loop: main first, then each bundle
- [ ] Output one line per skill summarizing the update outcome
- [ ] Targeted test pass: `cd packages/skills && bun test src/plugin.test.ts`

### Step 7: Plugin test suite

- [ ] Extend `plugin.test.ts` with:
  - [ ] Setup validation: accepts `URL`, absolute string, and relative string (defers to `installSkillBundle`); rejects collisions with main name; rejects duplicate bundle names; rejects non-string/non-URL types
  - [ ] `autoUpdateSkills` updates only outdated bundles; up-to-date bundles produce no FS writes
  - [ ] `autoUpdateSkills` continues after a per-bundle error (one bundle fails → others still process)
  - [ ] Interactive command: bundle prompt appears after main prompt; selecting/deselecting reconciles correctly; `--all` skips both prompts and installs everything
  - [ ] `skill update` subcommand updates main + bundles
  - [ ] Plugin behavior with `customSkills: []` is byte-identical to today (existing tests must continue to pass)
  - [ ] Plugin with `autoUpdate: false` skips both main and bundle auto-update
- [ ] Use a fixture bundle (TP-003's fixture under `packages/skills/tests/fixtures/bundle/` should suffice; create a second fixture only if needed for collision tests)

### Step 8: Code review checkpoint

> **Review override: code review** — verify implementation matches the plan from Step 1.

The reviewer must confirm:

- [ ] When `customSkills` is omitted, every existing plugin test passes unchanged
- [ ] No new runtime dependencies added
- [ ] Per-skill reconciliation logic does not silently leak state between skills (separate `skillStatus` calls, separate diffs)
- [ ] Setup-time validation catches all four invalid-config cases (bare relative path, name collision with main, duplicate names, invalid name)
- [ ] `--all` mode does not prompt for any skill
- [ ] Per-entry errors during auto-update are logged with the bundle name and never abort other entries

### Step 9: Documentation

- [ ] `packages/skills/README.md`: extend the plugin section with a `customSkills` subsection. Use the canonical bare-relative `sourceDir` form (`sourceDir: "skills/funnel-builder"`) in the primary example to mirror `@crustjs/create`'s `scaffold` docs. Include a note that bundles share scope/installMode resolution with the main skill.
- [ ] `apps/docs/content/docs/modules/skills.mdx`: equivalent section. Verify cross-links from existing plugin examples still resolve.
- [ ] `taskplane-tasks/CONTEXT.md`: mark the plugin-integration tech-debt item (added by TP-003 Step 8) as complete; append a new tech-debt entry for the unified single-prompt multi-skill UX:
  > - [ ] **Unified multi-skill prompt** — Today's `customSkills` UX runs `N+1` sequential multiselect prompts. Investigate a single grouped multiselect (with skill names as section headers) once user feedback indicates the sequential flow is friction. (Deferred from TP-004.)

### Step 10: Add changeset

- [ ] Run `bunx changeset` and select `@crustjs/skills` with a **minor** bump
- [ ] Body must:
  - [ ] State the new `customSkills` plugin option and its purpose
  - [ ] Show the canonical example (CLI + bundle entry)
  - [ ] Reference issue #110 and TP-003

### Step 11: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] Run FULL test suite: `bun run test`
- [ ] Run lint: `bun run check`
- [ ] Run type-check: `bun run check:types`
- [ ] Run build: `bun run build`
- [ ] Fix all failures

### Step 12: Documentation & Delivery

- [ ] "Must Update" docs modified (verified in Step 9)
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `packages/skills/README.md` — `customSkills` plugin subsection
- `apps/docs/content/docs/modules/skills.mdx` — equivalent
- `taskplane-tasks/CONTEXT.md` — mark plugin-integration tech-debt complete; add unified-prompt follow-up

**Check If Affected:**
- `packages/skills/CHANGELOG.md` — auto-updated by Changesets; do **not** hand-edit
- `apps/docs/content/docs/modules/meta.json` — only if pages were added/removed
- Any guide page that documents `skillPlugin` and would benefit from a cross-link to `customSkills`

## Completion Criteria

- [ ] All steps complete
- [ ] `bun run check && bun run check:types && bun run test && bun run build` all pass
- [ ] Plan-review APPROVE before Step 2; code-review APPROVE before Step 10
- [ ] Changeset present in `.changeset/`
- [ ] CONTEXT.md updates applied

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-004): complete Step N — description`
- **Bug fixes:** `fix(TP-004): description`
- **Tests:** `test(TP-004): description`
- **Hydration:** `hydrate: TP-004 expand Step N checkboxes`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message
- Add a YAML parser or any new runtime dependency to `@crustjs/skills`
- Implement a unified single-prompt multi-skill UX — logged as tech debt only
- Implement bundle scaffolding (`crust skill scaffold <name>`) — already deferred from TP-003
- Add per-bundle `autoUpdate` overrides — bundles share the plugin-level setting
- Modify `installSkillBundle` itself — that is TP-003's surface
- Change behavior when `customSkills` is omitted — existing tests must pass unchanged
- Hand-edit `CHANGELOG.md` files

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
