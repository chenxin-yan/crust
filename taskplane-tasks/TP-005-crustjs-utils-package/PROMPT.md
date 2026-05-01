# Task: TP-005 — Create `@crustjs/utils` package and dedupe `resolveSourceDir`

**Created:** 2026-04-29
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds a brand-new published package to the ecosystem, even if
the initial version is `0.0.1` and the surface is one function. Plan review
locks the public API contract and pre-stability framing; code review verifies
that both migrated call sites (`@crustjs/create`, `@crustjs/skills`) keep
their previous behavior byte-for-byte.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-005-crustjs-utils-package/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Stand up `@crustjs/utils`, a new published workspace package whose primary
purpose is internal de-duplication of small primitives shared across the Crust
ecosystem. The first public surface is a single helper, `resolveSourceDir`,
which mirrors the three-mode source-directory resolution that `@crustjs/create`
already implements privately (`scaffold({ template })`) and that `@crustjs/skills`
will implement privately during TP-003 (`installSkillBundle({ sourceDir })`).
After this task, both packages import `resolveSourceDir` from `@crustjs/utils`
and the private copies are deleted. The package is published at version
`0.0.1` to signal explicit pre-stability — the README states that the surface
is unstable until `0.1.0` and recommends pinning. The package is intended to
be useful to plugin authors as a secondary audience, but no stability promises
are made until a future task formally graduates the surface.

Resolves the dedup tech-debt entry that TP-003 logs in
`taskplane-tasks/CONTEXT.md`.

## Dependencies

- **Task:** TP-003 (introduces the second copy of the resolver in `@crustjs/skills/src/bundle.ts`; this task replaces both copies in one pass)
- **Task:** TP-004 (skill plugin extension; user requested TP-005 land after the full skill-plugin work is complete)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `packages/create/src/scaffold.ts` — reference implementation of `findNearestPackageRoot` + `resolveTemplateDir` (the canonical resolution behavior to mirror)
- `packages/create/package.json` — workspace dep + bunup config patterns
- `packages/create/bunup.config.ts` — bundle config to mirror
- `packages/create/tsconfig.json` — TypeScript config to mirror
- `packages/store/package.json` — second example of a published `@crustjs/*` workspace package
- `packages/skills/src/bundle.ts` — the second migration target (created by TP-003)
- `apps/docs/content/docs/modules/meta.json` — docs site page registration
- `README.md` and `CONTRIBUTING.md` (root) — package-list updates
- `taskplane-tasks/TP-003-install-skill-bundle/PROMPT.md` Step 8 — references the dedup tech-debt entry this task resolves

## Environment

- **Workspace:** `packages/utils/` (new, primary), `packages/create/` and `packages/skills/` (migrations), `apps/docs/` (docs)
- **Services required:** None

## File Scope

- `packages/utils/package.json` (new)
- `packages/utils/tsconfig.json` (new)
- `packages/utils/bunup.config.ts` (new)
- `packages/utils/README.md` (new)
- `packages/utils/src/index.ts` (new)
- `packages/utils/src/source.ts` (new — `resolveSourceDir` + private `findNearestPackageRoot`)
- `packages/utils/src/source.test.ts` (new)
- `packages/utils/tests/.gitkeep` (new — match repo convention if other packages have a `tests/` folder)
- `packages/create/src/scaffold.ts` (modify — delete private resolver, import from `@crustjs/utils`)
- `packages/create/package.json` (modify — add `@crustjs/utils: workspace:*` to `dependencies`)
- `packages/skills/src/bundle.ts` (modify — delete private resolver added in TP-003, import from `@crustjs/utils`)
- `packages/skills/package.json` (modify — add `@crustjs/utils: workspace:*` to `dependencies`)
- `apps/docs/content/docs/modules/utils.mdx` (new)
- `apps/docs/content/docs/modules/meta.json` (modify — register the new page)
- `README.md` (root, modify — list new package)
- `CONTRIBUTING.md` (root, modify — only if it lists current packages)
- `.changeset/*.md` (3 new):
  - `@crustjs/utils` — patch (initial release at 0.0.1)
  - `@crustjs/create` — patch (internal dedup, no API change)
  - `@crustjs/skills` — patch (internal dedup, no API change)

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] TP-003 changes are present on the working branch (`packages/skills/src/bundle.ts` exists with a private resolver)
- [ ] TP-004 changes are present on the working branch
- [ ] `bun install` clean
- [ ] All existing tests pass: `bun run test`
- [ ] No existing `packages/utils/` directory (avoid name collision)

### Step 1: Plan checkpoint — lock public surface, version, and framing

> **Review override: plan review** — verify the public API contract and pre-stability framing before any code is written.

Produce a short design note (in STATUS.md Notes section) confirming:

- [ ] **Public surface (locked at 1 export):** `resolveSourceDir(input: string | URL): string`. No other public exports in `0.0.1`.
- [ ] **Private internals (not exported):** `findNearestPackageRoot(startPath: string): string | null`. Promoted to public only when a future task identifies ≥1 standalone consumer.
- [ ] **Resolution rules** match `@crustjs/create`'s `resolveTemplateDir` exactly:
  - `URL` → must use `file:` protocol; throws with a descriptive error otherwise; resolves via `fileURLToPath()`
  - Absolute string → `path.resolve()` returned as-is
  - Relative string → `findNearestPackageRoot(process.argv[1])`, then `path.resolve(packageRoot, input)`. Throws with descriptive errors when `process.argv[1]` is unset or no `package.json` is found walking up
- [ ] **Initial version: `0.0.1`**, published. README opens with a clear pre-stability notice and pinning recommendation.
- [ ] **Audience framing:** primary audience is internal Crust packages; plugin authors are a secondary, opt-in audience with no stability promises until `0.1.0`.
- [ ] **Out of scope** (each logged in `taskplane-tasks/CONTEXT.md` Step 7):
  - `readPackageJson` — defer until ≥2 cross-package consumers
  - `findNearestPackageRoot` as public — defer until ≥1 standalone external consumer
  - `parseSemver` — defer until ≥2 consumers
  - All string/array/async/type-guard helpers — defer indefinitely

**Do not start Step 2 until plan review verdict is APPROVE.**

### Step 2: Stand up the package skeleton

- [ ] Create `packages/utils/package.json` mirroring `packages/create/package.json` structure:
  - `name: "@crustjs/utils"`
  - `version: "0.0.1"`
  - `description`: short, accurate (e.g. "Shared low-level utilities for the Crust ecosystem (pre-stable)")
  - `type: "module"`, `license: "MIT"`, `author`, `repository.directory: "packages/utils"`, `homepage`, `bugs`, `keywords`
  - `files: ["dist"]`
  - `exports`: `import` → `./dist/index.js`, `types` → `./dist/index.d.ts`
  - `publishConfig.access: "public"`
  - `scripts`: `build`, `dev`, `check:types`, `test`, `publish` — match `packages/create/package.json`
  - `devDependencies`: `@crustjs/config: workspace:*`, `bunup: catalog:`
  - `peerDependencies`: `typescript: catalog:`
  - **No runtime dependencies**
- [ ] Create `packages/utils/tsconfig.json` extending `@crustjs/config/tsconfig.base.json`, matching `packages/create/tsconfig.json`
- [ ] Create `packages/utils/bunup.config.ts` matching `packages/create/bunup.config.ts`
- [ ] Run `bun install` to register the workspace package
- [ ] Targeted check: `cd packages/utils && bun run build` succeeds (with empty src — expected to fail until Step 3, but `bun install` should resolve cleanly)

### Step 3: Implement `resolveSourceDir` and private `findNearestPackageRoot`

- [ ] Create `packages/utils/src/source.ts` with:
  - Private `findNearestPackageRoot(startPath: string): string | null` (mirrors the implementation in `packages/create/src/scaffold.ts` line ~84 verbatim, with TSDoc)
  - Public `resolveSourceDir(input: string | URL): string` (mirrors the body of `resolveTemplateDir` in `packages/create/src/scaffold.ts` line ~108 verbatim, with TSDoc that lists the three modes and the three failure modes)
  - Error messages must be descriptive and identical in spirit to the originals (mention the input, the failure mode, and a suggestion for resolution where applicable)
- [ ] Create `packages/utils/src/index.ts` re-exporting only `resolveSourceDir`
- [ ] Run targeted build: `cd packages/utils && bun run build` succeeds
- [ ] Run targeted type-check: `cd packages/utils && bun run check:types` succeeds

### Step 4: Test suite

- [ ] Create `packages/utils/src/source.test.ts` covering:
  - **All three resolution modes succeed:**
    - `URL` with `file:` protocol → resolves to the corresponding fs path
    - Absolute string path → returned resolved as-is
    - Relative string path → resolves correctly when `process.argv[1]` is set inside a fixture package directory containing a `package.json`
  - **All three failure modes throw with descriptive messages:**
    - `URL` with non-`file:` protocol (e.g. `http:`) → throws and message names the protocol
    - Relative string with `process.argv[1]` unset → throws and message suggests using absolute path or file URL
    - Relative string but no `package.json` found walking up → throws and message names the entrypoint and the relative input
  - **Edge cases:**
    - `process.argv[1]` pointing at a file (not directory) → still resolves (function should `dirname` internally if needed; mirror current behavior)
    - Symlinked path → `findNearestPackageRoot` follows real filesystem semantics (no special handling required, but assert against expected behavior)
- [ ] Use a temporary fixture directory for relative-path tests; clean up in `afterEach`
- [ ] Run targeted test: `cd packages/utils && bun test`

### Step 5: Migrate `@crustjs/create`

- [ ] Add `@crustjs/utils: workspace:*` to `packages/create/package.json` `dependencies`
- [ ] Run `bun install`
- [ ] In `packages/create/src/scaffold.ts`:
  - Delete the private `findNearestPackageRoot` function (line ~84)
  - Delete the private `resolveTemplateDir` function (line ~108)
  - Import `resolveSourceDir` from `@crustjs/utils`
  - Replace the call site (`const templateDir = resolveTemplateDir(template);`) with `const templateDir = resolveSourceDir(template);`
- [ ] Run targeted tests: `cd packages/create && bun test` — all existing tests must pass with zero changes
- [ ] Verify behavior parity: error messages emitted by the new resolver should be functionally equivalent to the old ones; if any test asserts on exact message text, those assertions move to `packages/utils/src/source.test.ts` (where the messages are now defined) and the create tests assert only on error type / presence

### Step 6: Migrate `@crustjs/skills`

- [ ] Add `@crustjs/utils: workspace:*` to `packages/skills/package.json` `dependencies`
- [ ] Run `bun install`
- [ ] In `packages/skills/src/bundle.ts`:
  - Delete the private `resolveBundleSourceDir` function (introduced in TP-003 Step 4)
  - Delete the private `findNearestPackageRoot` (if TP-003 inlined a copy)
  - Import `resolveSourceDir` from `@crustjs/utils`
  - Replace `resolveBundleSourceDir(sourceDir)` call sites with `resolveSourceDir(sourceDir)`
- [ ] Run targeted tests: `cd packages/skills && bun test` — all tests must pass
- [ ] Same behavior-parity rule for error messages as Step 5

### Step 7: Update CONTEXT.md and add new tech-debt entries

- [ ] Mark the existing dedup tech-debt entry from TP-003 as complete (change `- [ ]` to `- [x]` and append `(resolved by TP-005)`)
- [ ] Append three new tech-debt entries under "Tech Debt & Known Issues":
  > - [ ] **Promote `findNearestPackageRoot` to public in `@crustjs/utils`** — Currently a private internal. Promote when ≥1 standalone external consumer is identified. (Logged from TP-005.)
  > - [ ] **Add `readPackageJson` to `@crustjs/utils`** — `@crustjs/crust` has three intra-package call sites today (`utils/binary-name.ts`, `commands/publish.ts`, `cli.test.ts`). Add when a second consumer package emerges, or when the intra-package dedup justifies the dep edge on its own. (Logged from TP-005.)
  > - [ ] **Add `parseSemver` to `@crustjs/utils`** — Currently a single consumer in `packages/plugins/src/update-notifier.ts`. Defer until ≥2 consumers exist. (Logged from TP-005.)

### Step 8: README, docs site, and root package list

- [ ] Author `packages/utils/README.md` with:
  - Clear pre-stability banner ("**Status: pre-stable (`0.0.1`).** Public surface may change without notice until `0.1.0`. Pin to an exact version if depending externally.")
  - Audience: "Internal de-duplication primitives for Crust packages. Plugin authors may use these at their own risk."
  - Single-function reference for `resolveSourceDir`: signature, three resolution modes, three failure modes, one canonical example per mode
  - Install snippet (`bun add @crustjs/utils`)
- [ ] Author `apps/docs/content/docs/modules/utils.mdx`:
  - Same banner, same single-function reference (mirrors README)
  - Cross-link from `apps/docs/content/docs/modules/skills.mdx` (the `installSkillBundle` section) and `apps/docs/content/docs/modules/create.mdx` (or wherever `scaffold` is documented) noting that `sourceDir` / `template` resolution is implemented via this helper
- [ ] Update `apps/docs/content/docs/modules/meta.json` to register the new page in the appropriate position (alphabetical or by package precedence — match existing convention)
- [ ] Update root `README.md` package list to include `@crustjs/utils` with the same row format as the other packages
- [ ] Update root `CONTRIBUTING.md` if it enumerates current packages

### Step 9: Code review checkpoint

> **Review override: code review** — verify implementation matches the plan from Step 1.

The reviewer must confirm:

- [ ] Public surface of `@crustjs/utils@0.0.1` is exactly one export: `resolveSourceDir`. No incidental re-exports.
- [ ] `findNearestPackageRoot` is not exported (verify by grepping the built `.d.ts`)
- [ ] Behavior parity: at least one before/after test from each migrated package's existing suite passes byte-identical
- [ ] No new runtime dependencies on `@crustjs/utils` (only `@crustjs/config` devDep + `typescript` peerDep)
- [ ] `@crustjs/create` and `@crustjs/skills` have a single workspace dep added each; no other manifest changes
- [ ] CONTEXT.md tech-debt entries updated correctly (one resolved, three appended)
- [ ] README and `utils.mdx` carry the explicit pre-stability banner

### Step 10: Add changesets

- [ ] Run `bunx changeset` three separate times (or once with multi-package selection):
  - **`@crustjs/utils` — patch.** Body: "Initial release at 0.0.1. Pre-stable. First public export: `resolveSourceDir(input: string | URL): string` for three-mode source-directory resolution (file URL / absolute path / relative path resolved from `process.argv[1]`'s package root)."
  - **`@crustjs/create` — patch.** Body: "Internal: source-directory resolution moved to `@crustjs/utils`. No public API change."
  - **`@crustjs/skills` — patch.** Body: "Internal: source-directory resolution moved to `@crustjs/utils`. No public API change. Resolves the dedup tech-debt note from `installSkillBundle`'s introduction."

### Step 11: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] Run FULL test suite: `bun run test`
- [ ] Run lint: `bun run check`
- [ ] Run type-check: `bun run check:types`
- [ ] Run build: `bun run build`
- [ ] Fix all failures

### Step 12: Documentation & Delivery

- [ ] "Must Update" docs modified (verified in Step 8)
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `packages/utils/README.md` — new
- `apps/docs/content/docs/modules/utils.mdx` — new
- `apps/docs/content/docs/modules/meta.json` — register new page
- `README.md` (root) — list new package
- `CONTRIBUTING.md` (root) — only if it enumerates current packages
- `taskplane-tasks/CONTEXT.md` — resolve TP-003 dedup tech-debt entry; append three new tech-debt entries

**Check If Affected:**
- `packages/create/CHANGELOG.md` and `packages/skills/CHANGELOG.md` — auto-updated by Changesets; do **not** hand-edit
- `apps/docs/content/docs/modules/create.mdx` — add cross-link to utils if useful
- `apps/docs/content/docs/modules/skills.mdx` — add cross-link to utils if useful
- Any guide page that documents `scaffold({ template })` or `installSkillBundle({ sourceDir })` — note the shared helper

## Completion Criteria

- [ ] All steps complete
- [ ] `bun run check && bun run check:types && bun run test && bun run build` all pass
- [ ] Plan-review APPROVE before Step 2; code-review APPROVE before Step 10
- [ ] Three changesets present in `.changeset/`
- [ ] CONTEXT.md updated (one resolved, three appended)

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-005): complete Step N — description`
- **Bug fixes:** `fix(TP-005): description`
- **Tests:** `test(TP-005): description`
- **Hydration:** `hydrate: TP-005 expand Step N checkboxes`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message
- Export `findNearestPackageRoot` from `@crustjs/utils@0.0.1` — keep private
- Add `readPackageJson`, `parseSemver`, or any other helper to `@crustjs/utils@0.0.1` — strict scope
- Change the public signature or error contract of `scaffold`, `installSkillBundle`, or any other entrypoint in the migrated packages
- Add a runtime dependency to `@crustjs/utils` — none required
- Hand-edit `CHANGELOG.md` files
- Mark `@crustjs/utils` as `private: true` in package.json — it must be published
- Set the initial version to anything other than `0.0.1`
- Drop the pre-stability banner from README or `utils.mdx` — pre-stability framing is a contract

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
