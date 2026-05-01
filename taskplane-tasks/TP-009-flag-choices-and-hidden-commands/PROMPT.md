# Task: TP-009 — Add `choices` to `FlagDef`/`ArgDef` and `hidden` to `CommandMeta`

**Created:** 2026-04-29
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Two purely-additive optional fields on `@crustjs/core` public
types, plus a small filter in `helpPlugin`. The design is locked, but a plan
review locks the exact set of `FlagDef` variants that gain `choices`, the
JSDoc framing ("hint for tooling, not enforced at parse time"), and the
default-on filter behavior in `helpPlugin`. Code review is unnecessary —
the change surface is small and behavior-preserving for existing callers.
**Score:** 3/8 — Blast radius: 1 (one package, but `@crustjs/core` public
types propagate), Pattern novelty: 1 (additive optional fields, simple
filter), Security: 0, Reversibility: 1 (purely additive).

## Canonical Task Folder

```
taskplane-tasks/TP-009-flag-choices-and-hidden-commands/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Lay the `@crustjs/core` foundation needed for TP-010's shell-completion
plugin by adding two purely additive fields to the public type surface:

1. **`choices?: readonly string[]`** on `FlagDef` (and `ArgDef`) — a static
   enum of valid values for a flag/positional. The completion plugin will
   emit these as static value-completion candidates; research showed this
   covers ~80% of real-world completion needs without runtime callbacks.
   **Completion-only in this task** — no runtime validation. Validation
   hookup is deferred to a future task.

2. **`hidden?: boolean`** on `CommandMeta` — marks a subcommand as hidden
   from `--help` output. Required so future internal commands like
   `__complete` (TP-010 / a future v2 dynamic-completion task) don't
   pollute help output. `helpPlugin.formatCommandsSection` is updated to
   filter `hidden: true` subcommands by default.

Both fields are minor-bump additive changes to `@crustjs/core` public API.
The `helpPlugin` filter is also a minor (or patch) bump for `@crustjs/plugins`.

## Dependencies

- **None**

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `packages/core/src/types.ts` — defines `ArgDef`, `FlagDef`, **and `CommandMeta`** (the task spec referred to `node.ts`, but `CommandMeta` actually lives here at ~line 575; `node.ts` only imports it). All three additive fields land in this file.
- `packages/core/src/node.ts` — defines `CommandNode { meta: CommandMeta; ... }`; read to confirm `subCommand.meta.hidden` is the correct access path used by `helpPlugin`.
- `packages/plugins/src/help.ts` — `formatCommandsSection` at lines ~121-131 currently iterates `Object.entries(command.subCommands)` with NO filtering. This is the function being updated.

## Environment

- **Workspace:** `packages/core/`, `packages/plugins/`, `apps/docs/`
- **Services required:** None

## File Scope

- `packages/core/src/types.ts` — add `choices?: readonly string[]` to string-typed `FlagDef` variants and the string `ArgDef` variant; add `hidden?: boolean` to `CommandMeta`
- `packages/core/src/types.test.ts` (or the appropriate existing types-level test in this package — grep first; create co-located if none exists) — type-level tests confirming `choices` and `hidden` are accepted
- `packages/plugins/src/help.ts` — update `formatCommandsSection` to filter `subCommand.meta.hidden === true`
- `packages/plugins/src/plugins.test.ts` — add regression test that `helpPlugin` skips hidden subcommands
- `apps/docs/content/docs/api/types.mdx` (or whichever API page documents `FlagDef` / `ArgDef` / `CommandMeta` — grep first) — document the new fields
- `apps/docs/content/docs/guide/flags.mdx` and/or `apps/docs/content/docs/guide/arguments.mdx` and/or `apps/docs/content/docs/guide/subcommands.mdx` — brief mention of the new fields where they're already discussing flag/arg/command definition
- `.changeset/*-core-choices-and-hidden.md` — NEW changeset, **minor** for `@crustjs/core`
- `.changeset/*-plugins-help-hidden.md` — NEW changeset, **minor** (or patch — see Step 5) for `@crustjs/plugins`

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] Verify `packages/core/src/types.ts`, `packages/core/src/node.ts`, `packages/plugins/src/help.ts` exist
- [ ] Confirm via grep where `CommandMeta` is **defined** (expected: `packages/core/src/types.ts`) and where `FlagDef` / `ArgDef` discriminated unions live; record exact line numbers in STATUS.md Notes
- [ ] Confirm `formatCommandsSection` in `packages/plugins/src/help.ts` still iterates `Object.entries(command.subCommands)` with no filter (sanity check before edit)
- [ ] `bun install` clean
- [ ] All existing tests pass before any changes: `bun run test`

### Step 1: Add `choices` to `FlagDef` and `ArgDef` in `@crustjs/core`

> **Review override: plan review** — this step's outcome is what plan review locks (final variant list, JSDoc wording).

- [ ] In `packages/core/src/types.ts`, add `choices?: readonly string[]` to:
  - The string-typed `FlagDef` single-value variant (`StringFlagDef`)
  - The string-typed `FlagDef` multi-value variant (`StringMultiFlagDef`)
  - The string `ArgDef` variant (`StringArgDef`)
- [ ] **Do NOT** add `choices` to number/boolean variants in this task. If the worker concludes there's a defensible reason to add `choices` to `NumberFlagDef` / `NumberArgDef`, surface it in Discoveries and **stop** for plan-review confirmation rather than adding it.
- [ ] JSDoc on each new `choices` field: explicitly state that `choices` is a hint for tooling (shell completion, future opt-in validation) and is **NOT** enforced at parse time in this version. Include a one-line example.
- [ ] Add type-level tests verifying:
  - `choices: ["a", "b"] as const` is accepted on a string flag
  - `choices: ["a", "b"] as const` is accepted on a string positional arg
  - `choices` is **rejected** on a boolean flag and a number flag (negative test — `// @ts-expect-error`)
  - `choices` is **rejected** on a boolean/number arg
- [ ] Run targeted tests: `cd packages/core && bun test`
- [ ] `cd packages/core && bun run check:types`

**Artifacts:**
- `packages/core/src/types.ts` (modified)
- `packages/core/src/types.test.ts` (new or modified — grep first to find any existing types-level test)

### Step 2: Add `hidden` to `CommandMeta` in `@crustjs/core`

- [ ] In `packages/core/src/types.ts` (the actual definition site — `node.ts` only re-exports), add `hidden?: boolean` to the `CommandMeta` interface
- [ ] JSDoc: `When true, omit this command from default --help output. Used for internal/runtime commands like __complete. The command remains directly invocable by name; this flag affects help rendering only.`
- [ ] Add a type-level test that `meta: { ..., hidden: true }` is accepted (extend the same type test file as Step 1, or co-locate with the relevant existing test)
- [ ] Run targeted tests: `cd packages/core && bun test`
- [ ] `cd packages/core && bun run check:types`

**Artifacts:**
- `packages/core/src/types.ts` (modified)
- `packages/core/src/types.test.ts` (modified)

### Step 3: Update `helpPlugin` to filter hidden commands

- [ ] In `packages/plugins/src/help.ts`, update `formatCommandsSection`:
  - Filter `Object.entries(command.subCommands)` to skip entries where `subCommand.meta.hidden === true`
  - If filtering eliminates **all** subcommands, return `[]` (mirror the existing "no subcommands" early return)
  - Preserve insertion order of remaining entries
- [ ] Add a regression test in `packages/plugins/src/plugins.test.ts` that:
  - Builds a CLI with at least one visible subcommand and at least one `hidden: true` subcommand
  - Renders help via `helpPlugin` (or `renderHelp` directly — match patterns in the existing test file)
  - Asserts the visible subcommand name appears in output
  - Asserts the hidden subcommand name does NOT appear in the COMMANDS section
- [ ] Confirm a hidden subcommand is still **resolvable by direct invocation** (read `node.ts` resolution path; if there's an existing routing test, add or extend a case showing `hidden` does not affect routing). If resolution behavior is already independent of `meta.hidden`, record that in Discoveries instead of adding a redundant test.
- [ ] Run targeted tests: `cd packages/plugins && bun test`
- [ ] `cd packages/plugins && bun run check:types`

**Artifacts:**
- `packages/plugins/src/help.ts` (modified)
- `packages/plugins/src/plugins.test.ts` (modified)

### Step 4: Documentation

> ⚠️ Hydrate: which exact `.mdx` file(s) need updating depends on how
> `FlagDef` / `ArgDef` / `CommandMeta` are currently documented. Worker
> must `grep` `apps/docs/content/docs/` for `FlagDef`, `ArgDef`,
> `CommandMeta`, `subCommands`, and `meta:` examples before editing,
> then expand the checkboxes below to the actual files found.

- [ ] Identify the API doc page(s) that reference `FlagDef`, `ArgDef`, and `CommandMeta` (expected: `apps/docs/content/docs/api/types.mdx`; confirm via grep)
- [ ] Document `choices` on the flag/arg API page(s) with an example: `flag("target", { type: "string", choices: ["browser", "bun", "node"] })`. State explicitly: "Currently a hint for tooling (shell completion). Not enforced at parse time."
- [ ] Document `hidden` on the `CommandMeta` API page with a one-line example showing `meta: { name: "__complete", hidden: true, ... }` and a note that hidden commands remain invocable by name.
- [ ] Identify any guide pages that demonstrate flag definition (`apps/docs/content/docs/guide/flags.mdx`), arg definition (`arguments.mdx`), or command definition (`subcommands.mdx`) and add a brief mention that `choices` / `hidden` are available, linking to the API page. Skip a guide page only if it doesn't already cover the surface being extended.
- [ ] If `apps/docs/content/docs/api/meta.json` or `apps/docs/content/docs/guide/meta.json` need adjustment (no new pages added in this task — likely no change), confirm via inspection.

**Artifacts:**
- API doc page(s) for `FlagDef` / `ArgDef` / `CommandMeta` (modified — exact filename(s) hydrated at runtime)
- Guide page(s) (modified — exact filename(s) hydrated at runtime)

### Step 5: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.
> (Earlier steps used targeted tests for fast feedback.)

- [ ] Run FULL: `bun run check && bun run check:types && bun run test`
- [ ] Run build: `bun run build`
- [ ] Add changesets:
  - [ ] `bunx changeset` for `@crustjs/core` — **minor** — headline: "Add `choices` to `FlagDef`/`ArgDef` and `hidden` to `CommandMeta`". Body must state: purely additive, completion-only (no runtime validation), `hidden` filters help output but does not affect routing.
  - [ ] `bunx changeset` for `@crustjs/plugins` — **minor** by default; downgrade to **patch** only if the worker concludes the `helpPlugin` filter is purely a behavior fix (the prevailing repo convention favors minor for any user-visible behavior change — check 1-2 recent `.changeset/*.md` for `@crustjs/plugins` to match precedent and record the decision in Discoveries). Headline: "`helpPlugin` now omits subcommands marked `meta.hidden: true`".
- [ ] Confirm both changeset files are committed alongside the code change

### Step 6: Documentation & Delivery

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md (especially: which doc files were updated, any unexpected `choices`/`hidden` consumers found, changeset bump-level decision for `@crustjs/plugins`)

## Documentation Requirements

**Must Update:**
- `apps/docs/content/docs/api/types.mdx` (or the actual page documenting `FlagDef` / `ArgDef` / `CommandMeta` — grep first) — document `choices` and `hidden` with examples and the "completion-only / not enforced" caveat for `choices`
- `.changeset/*-core-choices-and-hidden.md` — new minor changeset for `@crustjs/core`
- `.changeset/*-plugins-help-hidden.md` — new minor (or patch) changeset for `@crustjs/plugins`

**Check If Affected:**
- `apps/docs/content/docs/guide/flags.mdx` — add a brief mention of `choices` if the page already demonstrates flag definition
- `apps/docs/content/docs/guide/arguments.mdx` — add a brief mention of `choices` if the page already demonstrates positional args
- `apps/docs/content/docs/guide/subcommands.mdx` — add a brief mention of `hidden` if the page already demonstrates subcommand definition
- `apps/docs/content/docs/modules/core.mdx` and `modules/plugins/*.mdx` — update if either tabulates the affected fields
- `packages/core/README.md` — update only if it currently shows a flag/arg/command-meta example that should now mention the new fields

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] `bun run check`, `bun run check:types`, `bun run build` all clean
- [ ] Two changesets present: `@crustjs/core` (minor) and `@crustjs/plugins` (minor or patch)
- [ ] Documentation updated to describe both new fields with examples

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-009): complete Step N — description`
- **Bug fixes:** `fix(TP-009): description`
- **Tests:** `test(TP-009): description`
- **Hydration:** `hydrate: TP-009 expand Step N checkboxes`

## Do NOT

- Implement runtime validation of `choices` — completion-only in this task. Document the deferral explicitly.
- Filter hidden commands from anywhere other than help output. They must remain resolvable via direct invocation by name. That is intentional and load-bearing for TP-010's `__complete` command.
- Modify the parser at all — `choices` is a hint, not a parse-time constraint, in this version.
- Add `choices` to non-string variants (boolean / number flags or args) without surfacing the rationale in Discoveries first and stopping for plan-review confirmation.
- Expand task scope — add tech debt to `taskplane-tasks/CONTEXT.md` instead.
- Skip tests, including the negative type-level tests for `choices` on non-string variants.
- Modify framework/standards docs without explicit user approval.
- Load docs not listed in "Context to Read First".
- Manually edit `CHANGELOG.md` files. Use `bunx changeset`.
- Commit without the `TP-009` prefix in the commit message.

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->

### Amendment 1 — 2026-05-06 (supervisor pre-flight, post PR #116)

**Issue:** PR #116 (TP-016) merged after this PROMPT was authored and
significantly modified the same files TP-009 will touch. Specifically:

1. **`packages/core/src/types.ts`** — `CommandMeta` now has an
   `aliases?: readonly string[]` field with extensive JSDoc describing the
   collision policy. The new `hidden?: boolean` field added by TP-009
   should land **next to** `aliases`, mirroring its style.
2. **`packages/plugins/src/help.ts`** — `formatCommandsSection` no longer
   sits at lines ~121-131 as the PROMPT claims. It now lives at lines
   ~107-117 and calls a new helper `formatCommandLabel(name, aliases)`
   for each subcommand. The function signature is unchanged but the
   body is structured around `formatCommandLabel`.
3. **`packages/core/src/validation.ts`** — TP-016 added
   `validateAliasString()` and `validateIncomingAliases()` (registration-
   time collision detection) plus changes to `validateCommandTree()`
   (tree-walk-time collision detection). These establish the precedent
   pattern for command-meta validation that TP-009 should mirror if it
   ever extends to validating `hidden` (currently it does not — `hidden`
   is a simple boolean — but the worker should be aware of the pattern).

**Resolution:**
- **Step 3 (helpPlugin update):** When adding the `hidden` filter to
  `formatCommandsSection`, **PRESERVE the existing `formatCommandLabel(name,
  subCommand.meta.aliases)` call**. The new code should integrate the
  hidden filter into the existing loop, not overwrite it. Failure to
  preserve `formatCommandLabel` will silently regress alias rendering.
- **Step 0 preflight:** Re-grep the actual line numbers of
  `formatCommandsSection` and `CommandMeta` on `main` and record them in
  STATUS.md Notes (PROMPT line numbers are stale).
- **Step 2 (CommandMeta.hidden):** When inserting `hidden?: boolean`,
  place it adjacent to `aliases?: readonly string[]` for grouping.
  Mirror the JSDoc style and depth of the `aliases` field.
- **Tests:** Add at least one test verifying that `hidden` filtering
  composes correctly with alias rendering (e.g., a hidden subcommand
  that also has aliases should not appear in help, and a visible
  subcommand with aliases should still render `name (a, b)`).

**Source:** Scout staleness audit 2026-05-06,
`tp-track-plugins.md`.
