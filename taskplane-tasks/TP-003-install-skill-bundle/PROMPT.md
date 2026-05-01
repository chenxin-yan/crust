# Task: TP-003 — Add `installSkillBundle()` primitive to `@crustjs/skills`

**Created:** 2026-04-29
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** New public API entrypoint that touches the canonical install
pipeline shared with `generateSkill`. Plan review locks the API shape, the
`SkillKind` semantics on `crust.json`, and the frontmatter-probe rules; code
review verifies the refactor preserves existing `generateSkill` behavior and
that bundle-specific safety checks (path traversal, name mismatch, kind
mismatch) are exercised.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-003-install-skill-bundle/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Resolve the lower-level half of [issue #110](https://github.com/chenxin-yan/crust/issues/110):
add a `installSkillBundle()` entrypoint to `@crustjs/skills` that installs a
hand-authored skill directory (with `SKILL.md` + arbitrary supporting files)
through the same Crust skill plumbing used by `generateSkill` — canonical
`.crust/skills/` storage, agent symlinks/copies, `crust.json` ownership and
version tracking, conflict detection, install-mode handling. The `generateSkill`
path is refactored so both entrypoints share a single private install core; no
behavior change for existing callers. A new `SkillKind` field is added to
`crust.json` so generated and bundle skills cannot accidentally overwrite each
other. Plugin integration (`skillPlugin({ customSkills: [...] })`) is intentionally
out of scope and is tracked as TP-004.

## Dependencies

- **None**

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- Issue body: https://github.com/chenxin-yan/crust/issues/110
- `packages/skills/src/generate.ts` — current `generateSkill`, `uninstallSkill`, `skillStatus`; the install pipeline to refactor
- `packages/skills/src/version.ts` — `crust.json` read/write; gets a new `kind` field
- `packages/skills/src/errors.ts` — `SkillConflictError`; gets an optional `kindMismatch` detail
- `packages/skills/src/types.ts` — public types
- `packages/skills/src/index.ts` — public re-exports
- `packages/skills/src/agents.ts` — `resolveAgentPath`, `resolveCanonicalSkillPath`
- `packages/skills/src/render.ts` — sole reference for the SKILL.md frontmatter shape Crust emits (used to mirror the bundle probe)
- `packages/skills/README.md` — current install/uninstall docs
- `apps/docs/content/docs/modules/skills.mdx` — module reference page
- `packages/create/src/scaffold.ts` — reference implementation for `string | URL` source resolution; `findNearestPackageRoot` + `resolveTemplateDir` to be mirrored in `bundle.ts`

## Environment

- **Workspace:** `packages/skills/` (primary), `apps/docs/` (docs only)
- **Services required:** None

## File Scope

- `packages/skills/src/bundle.ts` (new — `installSkillBundle`, `loadBundleFiles`)
- `packages/skills/src/bundle.test.ts` (new)
- `packages/skills/tests/fixtures/bundle/` (new — fixture skill bundle for tests)
- `packages/skills/src/generate.ts` (modify — extract `installRenderedSkill` core; route generated path through it)
- `packages/skills/src/generate.test.ts` (extend — kind-mismatch + back-compat coverage)
- `packages/skills/src/version.ts` (modify — read/write `kind` field with backward-compat default)
- `packages/skills/src/version.test.ts` (extend)
- `packages/skills/src/errors.ts` (modify — `kindMismatch` detail on `SkillConflictError`)
- `packages/skills/src/types.ts` (modify — `SkillKind`, `InstallSkillBundleOptions`, `InstallSkillBundleResult`)
- `packages/skills/src/index.ts` (modify — export new symbols)
- `packages/skills/README.md` (modify — new section)
- `apps/docs/content/docs/modules/skills.mdx` (modify — new section)
- `apps/docs/content/docs/api/*.mdx` (review — update only if a public-API page exists for skills)
- `taskplane-tasks/CONTEXT.md` (append — bundle-scaffolding follow-up tech debt)
- `.changeset/*.md` (new — minor)

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] `bun install` clean
- [ ] Existing `@crustjs/skills` tests pass: `cd packages/skills && bun test`
- [ ] No existing `bundle.ts` (avoid filename collision)

### Step 1: Plan checkpoint — lock API + safety contract

> **Review override: plan review** — verify the API shape and safety rules before any code is written.

Produce a short design note (in STATUS.md Notes section) confirming:

- [ ] **`InstallSkillBundleOptions` shape** finalized:
  - `meta: SkillMeta` (reuses existing type)
  - `sourceDir: string | URL` (resolution rules below)
  - `agents: AgentTarget[]`
  - `scope?: Scope` (default `"global"`)
  - `installMode?: SkillInstallMode` (default `"auto"`)
  - `clean?: boolean` (default `true`)
  - `force?: boolean` (default `false`)
- [ ] **`sourceDir` resolution** (mirrors `@crustjs/create`'s `scaffold({ template })` precisely):
  - `URL` → must use `file:` protocol (else throw with clear message); resolved via `fileURLToPath()`
  - Absolute string path → used as-is via `path.resolve()`
  - Relative string path → resolved from the **nearest `package.json` directory walking up from `process.argv[1]`** (so a published CLI can write `"skills/funnel-builder"` and Crust finds it under the package root). Throws with a clear message if `process.argv[1]` is unset or no `package.json` is found walking up.
  - The README example uses the bare relative form as canonical: `sourceDir: "skills/funnel-builder"`
- [ ] **Return type:** `InstallSkillBundleResult` is a type alias for `GenerateResult` (same `agents` array shape)
- [ ] **`SkillKind` semantics:**
  - Type: `"generated" | "bundle"`
  - Stored in `crust.json` as a top-level `kind` field
  - Backward-compat: missing `kind` is treated as `"generated"` when reading legacy crust.json
  - Mismatch handling: if existing `crust.json` has a different `kind` than the attempted install, throw `SkillConflictError` with `kindMismatch: { existing, attempted }` detail. `force: true` bypasses (and overwrites the kind).
- [ ] **Frontmatter probe rules:**
  - Required: `SKILL.md` exists at `<sourceDir>/SKILL.md`
  - Lightweight name probe: scan the first 50 lines for a top-level `name:` key inside the frontmatter block (between the first two `---` lines). If present and ≠ `meta.name`, throw with a clear error. If absent, accept silently.
  - Crust does **not** parse or rewrite the rest of the frontmatter; no new YAML parser dependency
- [ ] **File copy rules:**
  - Recursive copy of `sourceDir` contents into the canonical bundle (`SKILL.md` and any subdirectories)
  - Excluded: `node_modules/`, `.git/`, `.DS_Store`, any pre-existing `crust.json` at the source root, any dotfile at the source root (e.g. `.editorconfig`, `.gitignore`); subdirectory dotfiles **are** copied (only the root is filtered)
  - Crust regenerates `crust.json` after copy — never copies a stale one
- [ ] **Path-traversal safety:**
  - After resolution above, `realpath(resolvedDir)` is used to obtain a canonical root
  - Symlinks **inside** the bundle are followed, but the resolved target must remain inside the canonical root (reject any escape with a clear error)
  - Reject if the resolved path is not a directory
- [ ] **No public surface beyond:** `installSkillBundle`, `InstallSkillBundleOptions`, `InstallSkillBundleResult`, `SkillKind`, and the new `kindMismatch` field on `SkillConflictError.details`
- [ ] **Out of scope:** plugin integration (`customSkills`), bundle scaffolding command, frontmatter rewriting, license/allowed-tools injection

**Do not start Step 2 until plan review verdict is APPROVE.**

### Step 2: Add `SkillKind` and extend `crust.json`

- [ ] Add `SkillKind` to `packages/skills/src/types.ts`
- [ ] Update `version.ts`: `readInstalledVersion` continues to return version, but expose a new `readInstalledManifest(dir)` that returns `{ version, kind } | null`. Keep `readInstalledVersion` as a thin wrapper for backward compatibility.
- [ ] When reading: if parsed object lacks `kind`, default to `"generated"`. Document this default explicitly in the function doc.
- [ ] When writing `crust.json` (in the install pipeline): always include `kind`.
- [ ] Update `version.test.ts`: cover legacy crust.json (no `kind` field) + new format both round-trip correctly.
- [ ] Targeted test pass: `cd packages/skills && bun test src/version.test.ts`

### Step 3: Refactor `generate.ts` — extract install core

- [ ] Extract a private `installRenderedSkill(files, meta, opts, kind)` function. It performs everything `generateSkill` does after the manifest is rendered: canonical-store write, agent fan-out, conflict detection (now including kind mismatch), `crust.json` emission with the `kind` field.
- [ ] Update `generateSkill` to build the file list and delegate to `installRenderedSkill(files, resolvedMeta, opts, "generated")`.
- [ ] Update `SkillConflictError` (in `errors.ts`) and `errors.test.ts` (if exists) to include the new optional `kindMismatch` detail.
- [ ] Existing `generate.test.ts` must continue to pass with zero changes.
- [ ] Targeted test pass: `cd packages/skills && bun test src/generate.test.ts`

### Step 4: Implement `loadBundleFiles`

- [ ] Add a private `resolveBundleSourceDir(sourceDir: string | URL): string` helper to `bundle.ts` that mirrors `@crustjs/create`'s `resolveTemplateDir` (see `packages/create/src/scaffold.ts` for the reference implementation; copy with attribution). It implements the three-mode resolution from Step 1.
- [ ] Add `loadBundleFiles(sourceDir, meta)` to `bundle.ts`:
  - Call `resolveBundleSourceDir(sourceDir)` to obtain the absolute path
  - `realpath` the resolved path; reject with a clear error if not a directory
  - Recursively walk; for each file, read into memory as UTF-8 string and produce a `RenderedFile` with the path relative to the bundle root
  - Apply exclusion rules from Step 1
  - Verify `SKILL.md` is present in the result; throw with a clear error if missing
  - Run the lightweight name probe; if `name:` is present in the SKILL.md frontmatter and ≠ `meta.name`, throw
  - During the walk, `realpath` each entry and reject any path that escapes the canonical root
- [ ] Add unit tests for `loadBundleFiles` and `resolveBundleSourceDir` (separate from the integration tests in Step 6) covering:
  - All three resolution modes (URL, absolute string, relative string with `process.argv[1]` set inside a fixture package)
  - Non-`file:` URL → throws
  - Relative string with no `process.argv[1]` → throws with helpful message
  - Relative string with no walkable `package.json` → throws with helpful message
  - Missing SKILL.md, name mismatch, name match, excluded files, dotfile filtering at root only, path-traversal symlink rejection

### Step 5: Implement `installSkillBundle`

- [ ] Add `installSkillBundle(options)` to `bundle.ts`:
  - Validate `meta.name` against `isValidSkillName` (mirror `generateSkill`'s validation)
  - Call `loadBundleFiles(sourceDir, meta)` to get `RenderedFile[]`
  - Append the `crust.json` rendered file (using a shared helper extracted in Step 3 or a parallel call site)
  - Sort files for deterministic output (mirror `generateSkill`)
  - Delegate to `installRenderedSkill(files, meta, opts, "bundle")`
- [ ] Export `installSkillBundle`, `InstallSkillBundleOptions`, `InstallSkillBundleResult`, `SkillKind` from `index.ts`.

### Step 6: Bundle test suite

- [ ] Create a fixture under `packages/skills/tests/fixtures/bundle/` with at least: `SKILL.md` (valid frontmatter with `name`), one supporting markdown file, one nested directory, one excluded file at root (e.g. `.gitignore`).
- [ ] `bundle.test.ts` covers:
  - [ ] Fresh install: writes canonical bundle, fans out to specified agents, returns correct `GenerateResult`
  - [ ] Update path: same name, bumped version → `status: "updated"` with `previousVersion` populated
  - [ ] Up-to-date: same name + same version → `status: "up-to-date"`
  - [ ] Kind mismatch: pre-install via `generateSkill`, then attempt `installSkillBundle` with same name → throws `SkillConflictError` with `kindMismatch: { existing: "generated", attempted: "bundle" }`. With `force: true` → succeeds and overwrites kind.
  - [ ] Reverse mismatch: pre-install via `installSkillBundle`, then `generateSkill` → throws unless `force`
  - [ ] Missing `SKILL.md` → throws with descriptive error
  - [ ] Frontmatter `name` mismatch → throws
  - [ ] Path traversal via symlink escape → throws
  - [ ] Excluded files (`node_modules/`, `.git/`, root dotfiles, stale `crust.json`) are not copied
  - [ ] Nested dotfiles **are** copied (verify a `subdir/.config` from fixture survives)
  - [ ] All `installMode` values (`"auto"`, `"symlink"`, `"copy"`) round-trip correctly

### Step 7: Code review checkpoint

> **Review override: code review** — verify implementation matches the contract from Step 1.

The reviewer must confirm:

- [ ] No new runtime dependencies added to `@crustjs/skills`
- [ ] `generateSkill` behavior is byte-identical to before the refactor for existing test cases (legacy `crust.json` without `kind` still updates cleanly)
- [ ] `installSkillBundle` shares the canonical-store + agent fan-out path with `generateSkill`
- [ ] All thrown errors carry actionable messages identifying the failing path / file / field
- [ ] Path-traversal guard cannot be bypassed by symlinks at any depth
- [ ] No internal type or function escapes the public surface beyond what the plan locked in

### Step 8: Documentation

- [ ] `packages/skills/README.md`: add a new section "Installing Hand-Authored Bundles" with:
  - When to use `installSkillBundle` vs `generateSkill`
  - Minimal usage example (mirrors the issue's example)
  - Note that bundles and generated skills cannot share a name unless the existing one is removed first (or `force` is used)
- [ ] `apps/docs/content/docs/modules/skills.mdx`: equivalent section. Verify `meta.json` does not need updates (no new pages added).
- [ ] If `apps/docs/content/docs/api/skills.mdx` exists, update it with the new symbols. If it does not exist, do not create it as part of this task (out of scope).
- [ ] Append to `taskplane-tasks/CONTEXT.md` under "Tech Debt & Known Issues":
  > - [ ] **Bundle scaffolding helper** — Add a `crust skill scaffold <name>` command (or `scaffoldSkillBundle()` helper) that generates a starter bundle directory with a valid `SKILL.md` template. (Deferred from TP-003.)
  > - [ ] **Extract `resolveTemplateDir` / `findNearestPackageRoot` into a shared util** — `@crustjs/create` and `@crustjs/skills` both implement the same three-mode path resolution (URL / absolute / relative-from-package-root). Move into `@crustjs/config` (or a new shared internal package) and update both call sites. (Logged from TP-003.)

### Step 9: Add changeset

- [ ] Run `bunx changeset` and select `@crustjs/skills` with a **minor** bump
- [ ] Body must:
  - [ ] State the new `installSkillBundle` entrypoint and its purpose
  - [ ] Note the additive `kind` field on `crust.json` and its backward-compat default
  - [ ] Note the new `kindMismatch` detail on `SkillConflictError`
  - [ ] Reference issue #110

### Step 10: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] Run FULL test suite: `bun run test`
- [ ] Run lint: `bun run check`
- [ ] Run type-check: `bun run check:types`
- [ ] Run build: `bun run build`
- [ ] Fix all failures

### Step 11: Documentation & Delivery

- [ ] "Must Update" docs modified (verified in Step 8)
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `packages/skills/README.md` — add "Installing Hand-Authored Bundles" section
- `apps/docs/content/docs/modules/skills.mdx` — equivalent section
- `taskplane-tasks/CONTEXT.md` — append bundle-scaffolding follow-up

**Check If Affected:**
- `packages/skills/CHANGELOG.md` — auto-updated by Changesets; do **not** hand-edit
- `apps/docs/content/docs/api/skills.mdx` — update if it exists; do not create otherwise
- `apps/docs/content/docs/modules/meta.json` — only if pages were added/removed
- Any guide page that references `generateSkill` and would benefit from a cross-link

## Completion Criteria

- [ ] All steps complete
- [ ] `bun run check && bun run check:types && bun run test && bun run build` all pass
- [ ] Plan-review APPROVE before Step 2; code-review APPROVE before Step 9
- [ ] Changeset present in `.changeset/`
- [ ] CONTEXT.md tech-debt note added

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-003): complete Step N — description`
- **Bug fixes:** `fix(TP-003): description`
- **Tests:** `test(TP-003): description`
- **Hydration:** `hydrate: TP-003 expand Step N checkboxes`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message
- Add a YAML parser or any new runtime dependency to `@crustjs/skills`
- Parse or rewrite user-authored frontmatter beyond the lightweight `name:` probe
- Inject `meta.license` / `meta.allowedTools` / `meta.compatibility` into the bundle's `SKILL.md`
- Implement `skillPlugin({ customSkills: [...] })` — that is TP-004's scope
- Implement bundle scaffolding (`crust skill scaffold <name>`) — logged as tech debt only
- Change the existing `generateSkill` signature, default behavior, or error contracts
- Hand-edit `CHANGELOG.md` files

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->

### Amendment 1 — 2026-05-03 (supervisor pre-flight)
**Issue:** PROMPT references the helper as `resolveAgents()` (introduced by
TP-006 in `packages/skills/src/generate.ts`). After PR #114 merged, the
actual symbol name is **`resolveGenerateAgents()`** (private function,
lines 63–84 of `generate.ts`).
**Resolution:** Worker should treat any mention of `resolveAgents()` in
this PROMPT as `resolveGenerateAgents()`. The semantics described
(default to universal + detected, preserve `agents: []` as no-op) are
unchanged. TP-003's `installSkillBundle` will receive a pre-resolved
`agents: AgentTarget[]` array (required, not optional) — the new helper
is orthogonal to the bundle install path.
**Source:** Scout verification 2026-05-03, `.pi/supervisor/scout-reports/TP-003.md`.
