# Task: TP-016 — Add `aliases` to commands and subcommands

**Created:** 2026-05-03
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds an additive optional field on `CommandMeta` plus a new
resolution path in `resolveCommand`. Mirrors the existing `FlagDef.aliases`
pattern, so pattern novelty is low — but unlike TP-009 (`hidden`, which only
filtered help output), this task changes the **routing semantics** of the
parser: an alias must resolve to the same node as its canonical name, and
sibling alias↔name / alias↔alias collisions must throw at registration time.
That earns a code review on top of plan review.
**Score:** 4/8 — Blast radius: 1 (one feature, three packages: core, plugins,
man), Pattern novelty: 1 (mirrors `FlagDef.aliases` and the TP-009 `hidden`
shape), Security: 0, Reversibility: 2 (purely additive at the type level, but
the new lookup path becomes behaviorally load-bearing once any consumer ships
an alias — rolling back later means a breaking change for those consumers).

## Canonical Task Folder

```
taskplane-tasks/TP-016-command-aliases/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Let users define alternative names for a command or subcommand so that, for
example, an `issue` command can also be invoked as `issues` or `i`. The
feature is a small but high-leverage DX win: it shows up in nearly every
mature CLI framework (commander, oclif, cac, yargs, citty, cobra), it's been
explicitly requested for Crust, and the existing `FlagDef.aliases` pattern
gives us a precedent to mirror so the API feels familiar.

Concretely, this task:

1. Adds `aliases?: readonly string[]` to `CommandMeta` (purely additive;
   mirrors `FlagDef.aliases`).
2. Teaches `resolveCommand` (router) to resolve an alias to the canonical
   command node, while `commandPath` continues to record the canonical name
   only — so error messages, help, and downstream plugins are unaffected by
   which alias the user typed.
3. Throws a `CrustError("DEFINITION", …)` at registration time when an alias
   collides with a sibling's canonical name, another sibling's alias, or
   the parent's own canonical name. Eager registration-time errors match
   commander v12's behavior and avoid the silent-shadowing footgun cobra
   regrets (cobra issue #2185).
4. Surfaces aliases inline in `helpPlugin` next to the canonical name, e.g.
   `issue (issues, i)   Manage issues`, and includes them in
   `didYouMeanPlugin`'s suggestion candidate list (always reporting the
   canonical name as the suggestion).
5. Surfaces aliases in the man-page renderer (`@crustjs/man` `mdoc.ts`)
   alongside the canonical name in the SUBCOMMANDS section.
6. Documents the field, the conflict policy, and the help-rendering format.

Out of scope for v1, recorded so reviewers and future tasks know:
`deprecatedAliases` (oclif-style migration warnings), multi-token alias
paths (Clipanion-style), `suggestFor` (cobra-style non-similar suggestions),
and inheriting aliases through a subcommand chain. Each can be added as a
follow-up task without breaking changes to this v1 surface.

## Dependencies

- **TP-009** (`hidden?: boolean` on `CommandMeta`). This task assumes
  the `hidden` field already exists and adds tests that combine
  `hidden: true` with `aliases`. Until TP-009 lands (PR-F per
  `PR-PLAN.md`), the `hidden`-related steps below are gated.

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `packages/core/src/types.ts` — defines `CommandMeta` (around line 553) and
  `FlagDef.aliases` (around line 100) which is the precedent we mirror.
- `packages/core/src/node.ts` — `CommandNode { meta, subCommands, ... }`;
  read to confirm `subCommand.meta.aliases` is the access path used by
  consumers.
- `packages/core/src/router.ts` — `resolveCommand` is the routing function
  being extended; the exact-match line is around `router.ts:67`
  (`if (candidate in subCommands && subCommands[candidate])`).
- `packages/core/src/crust.ts` — `.command(name, cb)` and `.command(builder)`
  overloads (around lines 579–696) are where the registration-time
  collision check must be added. Existing duplicate-name check is at
  ~`crust.ts:616`.
- `packages/core/src/validation.ts` — `validateCommandTree` is where any
  late-added (plugin-installed) subcommand aliases should also be checked.
- `packages/plugins/src/help.ts` — `formatCommandsSection` (around
  lines 121–131) is the function rendering the COMMANDS list.
- `packages/plugins/src/did-you-mean.ts` — `didYouMeanPlugin`'s middleware
  (around lines 73–120) consumes `details.available` from the routing
  error; that list must include aliases.
- `packages/man/src/mdoc.ts` — iterates `Object.keys(root.subCommands)`
  around lines 125 / 193–198 to render the SUBCOMMANDS section.

## Environment

- **Workspace:** `packages/core/`, `packages/plugins/`, `packages/man/`,
  `apps/docs/`
- **Services required:** None

## File Scope

- `packages/core/src/types.ts` — add `aliases?: readonly string[]` to
  `CommandMeta`
- `packages/core/src/router.ts` — extend `resolveCommand` to resolve aliases
  to the canonical node; include aliases in the `available` list of
  `COMMAND_NOT_FOUND` errors
- `packages/core/src/crust.ts` — add registration-time collision detection
  in the `.command(name, cb)` and `.command(builder)` paths
- `packages/core/src/validation.ts` — extend `validateCommandTree` to detect
  alias collisions across the subcommand tree (catches plugin-installed
  subcommands that bypass `.command()`)
- `packages/core/src/router.test.ts` — alias resolution tests, collision
  surfacing in `details.available`, canonical-path preservation
- `packages/core/src/crust.test.ts` — builder-level alias tests, eager
  collision throwing, `meta({ aliases: [...] })` plumbing
- `packages/core/src/validation.test.ts` (or wherever validation tests
  live — grep first; co-locate if none exists) — alias collision detection
  via `validateCommandTree`
- `packages/plugins/src/help.ts` — render aliases inline next to canonical
  name in `formatCommandsSection`
- `packages/plugins/src/did-you-mean.ts` — include aliases in the
  candidate list passed to `findSuggestions`; the suggested string in the
  output must be the canonical name, not the alias matched against
- `packages/plugins/src/plugins.test.ts` (or `help.test.ts` /
  `did-you-mean.test.ts` — grep first to match existing test layout) —
  regression tests for help rendering and did-you-mean alias behavior
- `packages/man/src/mdoc.ts` — render aliases alongside canonical name in
  the SUBCOMMANDS section
- `packages/man/src/mdoc.test.ts` — regression test that aliases appear in
  rendered roff output
- `apps/docs/content/docs/api/types.mdx` (or whichever API page documents
  `CommandMeta` — grep first) — document the new `aliases` field with an
  example and the conflict policy
- `apps/docs/content/docs/guide/subcommands.mdx` (or whichever guide page
  introduces `.command()` — grep first) — show a worked example of a
  command with aliases
- `.changeset/*-core-command-aliases.md` — NEW changeset, **minor** for
  `@crustjs/core`
- `.changeset/*-plugins-aliases-render.md` — NEW changeset, **minor** for
  `@crustjs/plugins`
- `.changeset/*-man-aliases-render.md` — NEW changeset, **minor** for
  `@crustjs/man`

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] Verify all "Tier 3" files in **Context to Read First** exist; record
      the actual line numbers of `CommandMeta`, the alias-match line in
      `resolveCommand`, the duplicate-name check in `.command()`, and the
      `formatCommandsSection` body in STATUS.md Notes
- [ ] Confirm via grep where alias collision detection currently lives
      for **flags** (`packages/core/src/parser.ts` `validateAliasCollisions`,
      `packages/core/src/types.ts` `ValidateFlagAliases`) — these are the
      precedents to mirror, not duplicate
- [ ] Confirm `@crustjs/man` and `@crustjs/plugins` are both in scope of
      this task by grepping for `meta.name` and `subCommands` in each
      package (the scout report says yes; reconfirm before editing)
- [ ] `bun install` clean
- [ ] All existing tests pass before any changes: `bun run test`

### Step 1: Add `aliases` to `CommandMeta` and write a plan note

> **Review override: plan review** — this step's outcome is what plan
> review locks: the field name + cardinality, the conflict policy wording,
> the help-rendering format, and what stays out of v1. Hold for plan
> approval before moving to Step 2.

- [ ] In `packages/core/src/types.ts`, add `aliases?: readonly string[]`
      to the `CommandMeta` interface, immediately after the existing
      `hidden?: boolean` field
- [ ] JSDoc must state, in this order:
  1. What the field does — alternative names that resolve to the same
     command, e.g. `aliases: ["issues", "i"]` makes those equivalent to
     the canonical `name`.
  2. The conflict policy — alias strings must not collide with the
     canonical name or any sibling's name/alias; collisions throw a
     `CrustError("DEFINITION", …)` at registration time.
  3. The display contract — help renders `name (a, b, c)` inline; the
     canonical name is what appears in error messages, `commandPath`, and
     suggestions from `didYouMeanPlugin`.
  4. One-line example: `meta: { name: "issue", aliases: ["issues", "i"] }`.
- [ ] Add type-level test that `meta: { name: "x", aliases: ["y", "z"] as const }`
      is accepted (extend the existing `CommandMeta`/`hidden` types test
      from TP-009 — grep for `hidden` in `*.test.ts` to find it)
- [ ] Run targeted tests: `cd packages/core && bun test`
- [ ] `cd packages/core && bun run check:types`

**Artifacts:**
- `packages/core/src/types.ts` (modified)
- `packages/core/src/types.test.ts` or co-located test (modified)

### Step 2: Resolve aliases in `resolveCommand`

- [ ] In `packages/core/src/router.ts`, extend the subcommand lookup loop
      so that when `candidate in subCommands` is `false`, the resolver
      scans the sibling map for any node whose `meta.aliases` includes
      `candidate`, and treats a match as a hit on the canonical name
- [ ] `commandPath` MUST continue to record the **canonical name**, not
      the alias the user typed. This is load-bearing: error messages,
      help titles, and downstream plugins all read `commandPath` and
      assume canonical names. Add a comment in the resolver pointing at
      this invariant.
- [ ] When throwing `COMMAND_NOT_FOUND`, the `details.available` array
      MUST include aliases as well as canonical names. Order: each
      canonical name immediately followed by its aliases, preserving
      sibling insertion order. (A flat array is fine; we do not need a
      structured `{ canonical, aliases }` shape in v1.)
- [ ] Implementation choice: a linear scan over siblings is acceptable
      for v1 since command trees are small and resolution runs once per
      invocation. If the worker prefers to build an alias→canonical map
      lazily on the parent node, that's allowed but **must not mutate
      the `CommandNode` shape** in a way that breaks consumers reading
      `meta`/`subCommands` directly. Record the decision in Discoveries.
- [ ] Add tests in `packages/core/src/router.test.ts`:
  - Single alias resolves to the same node as the canonical name
  - Multiple aliases on the same node all resolve correctly
  - Aliases work at nested depths (subcommand of a subcommand)
  - `commandPath` records the canonical name even when an alias was
    typed
  - `COMMAND_NOT_FOUND` `details.available` includes aliases when a
    user types something that matches neither
  - A `hidden: true` subcommand with an alias is still resolvable by
    both name and alias (sanity check that `hidden` and `aliases` are
    independent)
- [ ] Run targeted tests: `cd packages/core && bun test router`
- [ ] `cd packages/core && bun run check:types`

**Artifacts:**
- `packages/core/src/router.ts` (modified)
- `packages/core/src/router.test.ts` (modified)

### Step 3: Detect alias collisions at registration and validation time

> **Review override: code review** — this step encodes the conflict
> policy. Subtle ordering bugs (e.g., adding a subcommand whose alias
> conflicts with a sibling registered later) need a second pair of eyes.

- [ ] In `packages/core/src/crust.ts`, extend the `.command(name, cb)` and
      `.command(builder)` paths so that, after the existing duplicate-name
      check, they also reject:
  - aliases that match the new subcommand's own canonical name
  - aliases that match any already-registered sibling's canonical name
  - aliases that match any already-registered sibling's alias
  - aliases of any **already-registered sibling** that match the new
    subcommand's canonical name (catches the reverse-order case)
  - duplicate aliases within the new subcommand's own `aliases` array
- [ ] Errors must be `new CrustError("DEFINITION", …)` with a message
      that names both the new subcommand and the existing sibling whose
      name/alias collided, plus the offending alias string. Mirror the
      phrasing of the existing duplicate-name error at `crust.ts:616`.
- [ ] In `packages/core/src/validation.ts`, extend `validateCommandTree`
      to walk the tree and detect alias collisions across subcommands
      that bypassed `.command()` (e.g., subcommands installed by a
      plugin's `setup` hook directly into `node.subCommands`). Reuse the
      same error shape so plugins surface the same way.
- [ ] Constraints on alias strings (validate at registration; throw on
      violation):
  - Must be a non-empty string
  - Must not contain whitespace
  - Must not start with `-` (would be parsed as a flag)
  - Must not equal the command's own canonical name
  - Implementation hint: a single shared validator in `crust.ts` that
    `validateCommandTree` also calls keeps the policy in one place.
- [ ] Add tests in `packages/core/src/crust.test.ts`:
  - Registering a subcommand with `aliases: ["x"]` succeeds when no
    sibling uses `x`
  - Registering an alias that collides with a sibling's canonical name
    throws `DEFINITION`
  - Registering an alias that collides with another sibling's alias
    throws `DEFINITION`
  - Registering a subcommand whose canonical name collides with an
    earlier sibling's alias throws `DEFINITION` (reverse-order case)
  - Duplicate aliases within one subcommand's own list throw
    `DEFINITION`
  - Empty / whitespace-containing / leading-`-` aliases throw
    `DEFINITION`
- [ ] Add a test in the appropriate validation test file that
      `validateCommandTree` catches a plugin-installed alias collision
- [ ] Run targeted tests: `cd packages/core && bun test`
- [ ] `cd packages/core && bun run check:types`

**Artifacts:**
- `packages/core/src/crust.ts` (modified)
- `packages/core/src/validation.ts` (modified)
- `packages/core/src/crust.test.ts` (modified)
- Validation test file (modified or new — grep first)

### Step 4: Render aliases in `helpPlugin`

- [ ] In `packages/plugins/src/help.ts`, update `formatCommandsSection` to
      render aliases inline next to the canonical name. Format:
      `name (a, b, c)`, e.g. `issue (issues, i)`. When `aliases` is
      empty/undefined, fall back to the existing `name`-only format
      verbatim — do NOT print empty parentheses.
- [ ] Preserve existing column alignment: the alias-suffixed name should
      be measured against `COMMAND_COLUMN_WIDTH` and pad/truncate using
      the same rules. If the alias-suffixed name exceeds the column,
      let it overflow rather than truncating aliases — truncation would
      hide which aliases exist, defeating the point. Document the
      decision in code comments.
- [ ] Continue to skip subcommands with `meta.hidden === true` (TP-009
      behavior must not regress). When a hidden command is skipped, its
      aliases are also not displayed.
- [ ] Add regression tests in the existing plugins test file (grep for
      `formatCommandsSection` or `helpPlugin` to find the right one):
  - A subcommand with `aliases: ["a", "b"]` renders as
    `name (a, b)` in the COMMANDS section
  - A subcommand with no aliases renders unchanged from current
    behavior (literal string match a previously-passing assertion if
    one exists)
  - A `hidden: true` subcommand with aliases is omitted entirely
- [ ] Run targeted tests: `cd packages/plugins && bun test`
- [ ] `cd packages/plugins && bun run check:types`

**Artifacts:**
- `packages/plugins/src/help.ts` (modified)
- Plugins test file (modified)

### Step 5: Include aliases in `didYouMeanPlugin` suggestions

- [ ] `didYouMeanPlugin` reads `details.available` from the
      `COMMAND_NOT_FOUND` error thrown by `resolveCommand`. Step 2
      already populated `details.available` with aliases, so the plugin
      may already work — but the suggestion string returned in the
      `Did you mean "X"?` message MUST be the canonical name, not the
      alias that produced the closest Levenshtein match.
- [ ] Decide on a rendering strategy and implement one of:
  - **Map-back-to-canonical (preferred):** Resolve any matched alias
    back to its canonical name before producing the suggestion string.
    Requires `findSuggestions` to know which entries are aliases or
    requires the parent to expose an alias→canonical lookup. Document
    in Discoveries which way you took it.
  - **Filter aliases out before suggesting:** Cheaper but worse UX —
    `i` would never be suggested as a similar match for `is`.
- [ ] Add tests in the did-you-mean test file (grep first):
  - Typo for an alias suggests the canonical name (e.g., user types
    `iss`, alias `issues` matches via Levenshtein, suggestion is
    `issue`)
  - Typo for a canonical name still suggests the canonical name
    unchanged (no regression)
  - Suggestions never contain duplicates when an alias and a canonical
    name both match within the suggestion threshold
- [ ] Run targeted tests: `cd packages/plugins && bun test`
- [ ] `cd packages/plugins && bun run check:types`

**Artifacts:**
- `packages/plugins/src/did-you-mean.ts` (modified)
- Autocomplete test file (modified)

### Step 6: Render aliases in `@crustjs/man`

- [ ] In `packages/man/src/mdoc.ts`, extend the SUBCOMMANDS section
      renderer (around lines 125 and 193–198 per scout) to include
      aliases next to the canonical subcommand name. Match the
      `helpPlugin` inline format: `name (a, b)`. roff escaping rules
      apply — confirm that parentheses and commas don't need escaping
      in the existing format, or escape if they do.
- [ ] Continue to skip `hidden: true` subcommands (confirm whether
      `mdoc.ts` currently honors `meta.hidden`; if it does not, that's
      a TP-009 follow-up bug — record in Discoveries and DO NOT fix it
      in this task).
- [ ] Update column-width calculation (line 125 currently does
      `Math.max(max, name.length)`) to account for the alias suffix so
      alignment stays consistent.
- [ ] Add a test in `packages/man/src/mdoc.test.ts` that a subcommand
      with aliases produces a SUBCOMMANDS entry containing both the
      canonical name and the aliases.
- [ ] Run targeted tests: `cd packages/man && bun test`
- [ ] `cd packages/man && bun run check:types`

**Artifacts:**
- `packages/man/src/mdoc.ts` (modified)
- `packages/man/src/mdoc.test.ts` (modified)

### Step 7: Documentation

> ⚠️ Hydrate: which exact `.mdx` file(s) need updating depends on how
> `CommandMeta` and `.command()` are currently documented. Worker must
> `grep` `apps/docs/content/docs/` for `CommandMeta`, `subCommands`,
> `.command(`, and `aliases` before editing, then expand the checkboxes
> below to the actual files found.

- [ ] Identify the API doc page that documents `CommandMeta` (expected:
      `apps/docs/content/docs/api/types.mdx`; confirm via grep). Add an
      `aliases` entry next to `hidden` with:
  - Type: `readonly string[]`
  - Default: `undefined`
  - Description matching the JSDoc from Step 1
  - A two-line example: `meta: { name: "issue", aliases: ["issues", "i"] }`
- [ ] Identify the guide page that introduces subcommands (expected:
      `apps/docs/content/docs/guide/subcommands.mdx`; confirm via grep).
      Add a short "Aliases" subsection with a worked example showing
      `cli issue list`, `cli issues list`, and `cli i list` all
      invoking the same command.
- [ ] Document the conflict policy explicitly in the guide page — one
      paragraph stating that alias↔name and alias↔alias collisions
      throw at registration time, with a copy-pastable example of the
      error message.
- [ ] Document the `--help` rendering format with a snippet showing the
      `issue (issues, i)   Manage issues` row.
- [ ] Confirm `apps/docs/content/docs/api/meta.json` and
      `apps/docs/content/docs/guide/meta.json` need no changes (no new
      pages added). Record either way in Discoveries.
- [ ] Update `packages/core/README.md` only if it currently shows a
      `meta:` example that should mention `aliases`. Skip otherwise.

**Artifacts:**
- API doc page for `CommandMeta` (modified — exact filename hydrated)
- Subcommands guide page (modified — exact filename hydrated)

### Step 8: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a
> quality gate. (Earlier steps used targeted tests for fast feedback.)

- [ ] Run FULL: `bun run check && bun run check:types && bun run test`
- [ ] Run build: `bun run build`
- [ ] Add changesets:
  - [ ] `bunx changeset` for `@crustjs/core` — **minor** — headline:
        "Add `aliases` to `CommandMeta`". Body must state: purely
        additive on the type level; new resolver fast path; eager
        registration-time errors on alias↔name and alias↔alias
        collisions; `commandPath` continues to use canonical names.
  - [ ] `bunx changeset` for `@crustjs/plugins` — **minor** — headline:
        "`helpPlugin` and `didYouMeanPlugin` are alias-aware". Body
        notes: help renders `name (a, b)` inline; did-you-mean uses
        aliases as match candidates but reports canonical names as
        suggestions.
  - [ ] `bunx changeset` for `@crustjs/man` — **minor** — headline:
        "`mdoc` includes command aliases in SUBCOMMANDS section". Body
        notes the inline format matches `helpPlugin`.
- [ ] Confirm all three changeset files are committed alongside the
      code change

### Step 9: Documentation & Delivery

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md (especially: which doc files were
      updated, the alias-resolution implementation choice (linear scan
      vs. lazy map), the did-you-mean strategy chosen, any cross-talk
      with TP-010 completion plugin, and the bump-level decision for
      each changeset)

## Documentation Requirements

**Must Update:**
- API doc page for `CommandMeta` — document `aliases` with example and
  conflict policy (expected `apps/docs/content/docs/api/types.mdx` —
  grep first)
- Subcommands guide page — worked example, conflict policy paragraph,
  help-rendering snippet (expected
  `apps/docs/content/docs/guide/subcommands.mdx` — grep first)
- `.changeset/*-core-command-aliases.md` — new minor changeset for
  `@crustjs/core`
- `.changeset/*-plugins-aliases-render.md` — new minor changeset for
  `@crustjs/plugins`
- `.changeset/*-man-aliases-render.md` — new minor changeset for
  `@crustjs/man`

**Check If Affected:**
- `apps/docs/content/docs/modules/core.mdx`,
  `apps/docs/content/docs/modules/plugins.mdx`,
  `apps/docs/content/docs/modules/man.mdx` — update if any of them
  tabulate fields on `CommandMeta` or describe help-rendering format
- `packages/core/README.md`, `packages/plugins/README.md`,
  `packages/man/README.md` — update only if any currently shows a
  `meta:` example or a help-format snippet that should now mention
  `aliases`
- `taskplane-tasks/TP-010-completion-plugin-static/PROMPT.md` — if
  TP-010 is still open, the worker should record (in Discoveries, NOT
  in TP-010's PROMPT) that the completion walker will need to enumerate
  aliases too. Do not edit TP-010's prompt — that's its own task.

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] `bun run check`, `bun run check:types`, `bun run build` all clean
- [ ] Three changesets present: `@crustjs/core`, `@crustjs/plugins`,
      `@crustjs/man` (all minor)
- [ ] Documentation updated to describe `aliases`, the conflict policy,
      and the help/man rendering format with examples

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All
commits for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-016): complete Step N — description`
- **Bug fixes:** `fix(TP-016): description`
- **Tests:** `test(TP-016): description`
- **Hydration:** `hydrate: TP-016 expand Step N checkboxes`

## Do NOT

- Add `deprecatedAliases` (oclif-style migration warnings) in this
  task — explicitly out of scope; document as a future enhancement
  in Discoveries instead.
- Support multi-token aliases (Clipanion-style `paths: [['remote',
  'add'], ['ra']]`) in this task — out of scope.
- Add `suggestFor` (cobra-style non-similar suggestions) in this task —
  out of scope.
- Mutate `CommandNode.subCommands` to also key entries by their alias
  strings. The registry stays keyed by canonical name only; alias
  resolution is a separate code path. Mixing them risks subtle bugs
  where iteration code (help rendering, walkers, validators) double-
  counts a node.
- Make `commandPath` carry the alias the user typed. Always canonical.
- Change the public shape of `CrustError("COMMAND_NOT_FOUND")` beyond
  expanding `details.available` to include aliases. Existing consumers
  of that error must continue to work.
- Modify the parser (`packages/core/src/parser.ts`) — alias resolution
  happens in the router, before flag parsing.
- Add `aliases` to anything other than `CommandMeta` in this task.
  `FlagDef.aliases` already exists and is unrelated.
- Expand task scope — add tech debt to `taskplane-tasks/CONTEXT.md`
  instead.
- Skip tests, including the negative tests for collision detection and
  invalid alias strings.
- Modify framework/standards docs without explicit user approval.
- Load docs not listed in "Context to Read First".
- Manually edit `CHANGELOG.md` files. Use `bunx changeset`.
- Commit without the `TP-016` prefix in the commit message.

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
