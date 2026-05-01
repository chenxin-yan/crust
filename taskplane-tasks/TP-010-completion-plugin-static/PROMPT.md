# Task: TP-010 — Add `completionPlugin` (pure-static, bash + zsh + fish, print + `--output-dir`)

**Created:** 2026-04-29
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** New plugin type with cross-shell template generation — a pattern
the repo has not used before, but blast radius is contained to a single new
package directory and a few re-export/doc edits. Plan review locks the
`CompletionSpec` shape and per-shell template structure before we generate
golden snapshots; code review verifies the behavioral subprocess tests
actually drive the generated scripts and that `--output-dir` writes the right
filenames.
**Score:** 4/8 — Blast radius: 1 (one package), Pattern novelty: 2 (new plugin
type + cross-shell template generation), Security: 0, Reversibility: 1
(additive feature behind a new plugin)

## Canonical Task Folder

```
taskplane-tasks/TP-010-completion-plugin-static/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Add a new `completionPlugin` to `@crustjs/plugins` that generates **real shell
tab-completion scripts** (distinct from the renamed `didYouMeanPlugin`).

The strategy is **pure-static**: when the user runs `mycli completion <shell>`,
the plugin walks the live `CommandNode` tree and emits a fully-baked completion
script for bash, zsh, or fish. No runtime callbacks, no hidden `__complete`
subcommand, no middleware bypass. This matches the pattern used by jujutsu,
mise, zellij, and the Rust `clap_complete` ecosystem and ships cleanly without
any changes to `@crustjs/core`.

Drift on CLI upgrade is mitigated by an `--output-dir` flag that lets
distributors (Homebrew, Nix, apt) regenerate completion artifacts at packaging
time. Pure-delegate dynamic completion (per-flag/per-arg `complete?:` callbacks)
is intentionally deferred to a future minor bump — adding callbacks is
non-breaking, so v1 can ship pure-static today and grow into a hybrid later.

## Dependencies

- **Task:** TP-008 (rename frees the "completion" terminology — the old
  autocomplete plugin must already be renamed to `didYouMeanPlugin` before this
  plugin can claim the `completionPlugin` name)
- **Task:** TP-009 (uses the `choices` field on `FlagDef`/`ArgDef` and the
  `meta.hidden` field on commands; both must already exist in `@crustjs/core`)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**

Repo source — required reading before writing the walker:
- `packages/core/src/node.ts` — `CommandNode` shape, `CommandMeta`, the
  `meta.hidden` field landed in TP-009, and the `effectiveFlags` accessor
  (use `effectiveFlags`, not `localFlags` — inheritance is pre-computed)
- `packages/core/src/types.ts` — `FlagDef`, `ArgDef`, the `choices` field
  landed in TP-009
- `packages/core/src/plugins.ts` — plugin contract (`CrustPlugin`,
  `SetupActions`, `addSubCommand`)
- `packages/plugins/src/help.ts` — reference pattern for a plugin that
  registers a subcommand
- `packages/plugins/src/version.ts` — simpler reference pattern for a plugin
  with `setup` + middleware

Research artifacts (already produced; consult per-shell file when implementing
that shell's template, and read the verification files before locking the
plan):
- `/tmp/crust-completion-research/bash.md` — bash completion protocol
  (`complete -F`, `COMP_WORDS`, `COMPREPLY`)
- `/tmp/crust-completion-research/zsh.md` — zsh completion protocol
  (`#compdef`, `_arguments -C`, `->state` subcommand routing)
- `/tmp/crust-completion-research/fish.md` — fish completion protocol
  (declarative `complete -c` rules with `-n` predicates)
- `/tmp/crust-completion-research/frameworks.md` — framework comparison
  (Cobra, clap_complete, oclif, Click) and the design recommendations that
  drove the pure-static decision
- `/tmp/crust-completion-research/bun-cli.md` — Bun's hybrid pattern, kept for
  reference only; **we are NOT copying this approach in v1**
- `/tmp/crust-completion-verification/external-checks.md` — fact-checked
  claims; **read the "Risks" section in particular**
- `/tmp/crust-completion-verification/distribution-patterns.md` — packaging
  recipes for the docs (Homebrew, Nix, AUR, Debian)
- `/tmp/crust-completion-verification/oracle.md` — oracle's red-team feedback
  on the design

Cobra's bash V2 init shim — copy the inline `__<name>_init_completion` fallback
so generated scripts work without the `bash-completion` package (macOS default,
Alpine, NixOS): <https://github.com/spf13/cobra/blob/main/bash_completionsV2.go>
lines 48–54.

## Environment

- **Workspace:** `packages/plugins/` (primary), `apps/docs/`
- **Services required:** None
- **Optional system tools for behavioral tests:** `bash` (always present),
  `zsh` (skip-with-note if missing), `fish` (skip-with-note if missing). CI
  install hint: `apt install fish bash-completion`.

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

**New (under `packages/plugins/src/completion/`):**
- `packages/plugins/src/completion/index.ts` — `completionPlugin()` factory +
  `CompletionPluginOptions` type
- `packages/plugins/src/completion/spec.ts` — internal `CompletionSpec` shape
  (the walker output)
- `packages/plugins/src/completion/walker.ts` — walks `CommandNode` tree to
  `CompletionSpec`
- `packages/plugins/src/completion/templates/bash.ts` — emits bash completion
  script
- `packages/plugins/src/completion/templates/zsh.ts` — emits zsh completion
  script
- `packages/plugins/src/completion/templates/fish.ts` — emits fish completion
  script
- `packages/plugins/src/completion/walker.test.ts` — unit tests for walker
- `packages/plugins/src/completion/templates/bash.test.ts` — snapshot +
  behavioral subprocess tests
- `packages/plugins/src/completion/templates/zsh.test.ts` — snapshot +
  behavioral subprocess tests (skip if zsh not available)
- `packages/plugins/src/completion/templates/fish.test.ts` — snapshot +
  behavioral subprocess tests (skip if fish not available)
- `packages/plugins/src/completion/index.test.ts` — integration test for the
  plugin (registers command, invocation prints expected script,
  `--output-dir` writes 3 files with correct names)

**Modify:**
- `packages/plugins/src/index.ts` — re-export `completionPlugin` and
  `CompletionPluginOptions`
- `packages/plugins/README.md` — add `completionPlugin` row to the plugin table

**New docs:**
- `apps/docs/content/docs/modules/plugins/completion.mdx` — full docs
  (usage, per-shell install, packaging recipes, drift handling, design notes)

**New changeset:**
- `.changeset/*.md` — `@crustjs/plugins`: minor — add `completionPlugin` for
  shell tab-completion

> Note: `apps/docs/content/docs/modules/plugins/meta.json` uses
> `"pages": ["..."]` wildcard — no edit needed.

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for
> rules.

### Step 0: Preflight

- [ ] Confirm TP-008 is merged: `didYouMeanPlugin` exists in
  `packages/plugins/src/` and the name `completionPlugin` is free
- [ ] Confirm TP-009 is merged: `choices` field present on `FlagDef`/`ArgDef`
  in `packages/core/src/types.ts`, and `meta.hidden` present on `CommandNode`
  in `packages/core/src/node.ts`
- [ ] Verify all listed Tier 3 file paths and research artifacts exist
- [ ] `bun install` clean
- [ ] All existing `@crustjs/plugins` tests pass before any changes

### Step 1: Walker + spec types

> **Review override: plan + code** — both reviews required (plan locks the
> `CompletionSpec` shape before any template work begins).

- [ ] Define `CompletionSpec` shape in `spec.ts` (commands tree, per-command
  flags + args + descriptions + choices, hidden filtered out)
- [ ] Implement walker in `walker.ts` traversing `CommandNode` recursively
  using `effectiveFlags` (not `localFlags`); skip `meta.hidden` subcommands;
  capture `flag.choices` and `arg.choices` from TP-009; strip ANSI codes from
  every `description` string during walk
- [ ] Add `walker.test.ts` covering at minimum: empty tree, flat commands,
  nested subcommands, inherited flags via `effectiveFlags`, hidden subcommand
  filtering, choices captured on flags and args, ANSI stripped from
  descriptions
- [ ] Run targeted tests: `cd packages/plugins && bun test src/completion/walker.test.ts`

**Artifacts:**
- `packages/plugins/src/completion/spec.ts` (new)
- `packages/plugins/src/completion/walker.ts` (new)
- `packages/plugins/src/completion/walker.test.ts` (new)

### Step 2: Bash template

> ⚠️ Hydrate: After `renderBash` is roughed in, expand checkboxes to track the
> specific subprocess scenarios (top-level subcommand, nested subcommand, flag
> with choices) once the actual generated script structure stabilizes.

- [ ] Implement `renderBash(spec, binName, version): string` in
  `templates/bash.ts`
- [ ] Embed Cobra-style `__<name>_init_completion` fallback shim so the script
  works without the `bash-completion` package (reference Cobra's
  `bash_completionsV2.go` lines 48–54)
- [ ] Use `complete -F _<bin> <bin>` registration
- [ ] First line is a comment:
  `# completion script for <bin> v<version> — regenerate with: <bin> completion bash`
- [ ] Add `templates/bash.test.ts` with one snapshot (golden) test plus
  behavioral subprocess tests that source the script under `bash -c`, set
  `COMP_WORDS`/`COMP_CWORD`, and assert `COMPREPLY` for at least three
  scenarios (top-level subcommand, nested subcommand, flag with choices)
- [ ] Run targeted tests: `cd packages/plugins && bun test src/completion/templates/bash.test.ts`

**Artifacts:**
- `packages/plugins/src/completion/templates/bash.ts` (new)
- `packages/plugins/src/completion/templates/bash.test.ts` (new)

### Step 3: Zsh template

> ⚠️ Hydrate: Expand to track the actual `_arguments -C` / `->state` shape
> after the first generated script compiles cleanly under `zsh -n`.

- [ ] Implement `renderZsh(spec, binName, version): string` in
  `templates/zsh.ts`
- [ ] First line is `#compdef <bin>` (required by zsh's autoload mechanism)
- [ ] Use `_arguments -C` with descriptions in `[brackets]` form
- [ ] Subcommand routing via the canonical `->state` pattern (see
  `/tmp/crust-completion-research/zsh.md` for the exact shape)
- [ ] Choices emitted as `--flag=[desc]:value:(option1 option2 option3)`
- [ ] Add `templates/zsh.test.ts`: snapshot test + behavioral test that runs
  the generated script under `zsh -c` if zsh is on PATH; skip-with-note
  otherwise
- [ ] Run targeted tests: `cd packages/plugins && bun test src/completion/templates/zsh.test.ts`

**Artifacts:**
- `packages/plugins/src/completion/templates/zsh.ts` (new)
- `packages/plugins/src/completion/templates/zsh.test.ts` (new)

### Step 4: Fish template

> ⚠️ Hydrate: Expand to track the chained `-n '__fish_seen_subcommand_from …'`
> predicates after the first generated script parses under `fish -n`.

- [ ] Implement `renderFish(spec, binName, version): string` in
  `templates/fish.ts`
- [ ] Emit declarative `complete -c <bin> -n '...' -a/-l/-s ... -d '...'`
  rules
- [ ] Subcommand routing via chained
  `-n '__fish_seen_subcommand_from <parent-chain>'` predicates
- [ ] Choices emitted as `-x -a 'option1 option2 option3'`
- [ ] Add `templates/fish.test.ts`: snapshot + behavioral test under
  `fish -c` if fish is on PATH; skip-with-note otherwise
- [ ] Run targeted tests: `cd packages/plugins && bun test src/completion/templates/fish.test.ts`

**Artifacts:**
- `packages/plugins/src/completion/templates/fish.ts` (new)
- `packages/plugins/src/completion/templates/fish.test.ts` (new)

### Step 5: Plugin factory + integration tests

- [ ] Implement `completionPlugin(options?: CompletionPluginOptions)`
  returning a `CrustPlugin`. Options:
  `{ command?: string; binName?: string; shells?: Array<"bash"|"zsh"|"fish">; version?: string; }`.
  Defaults: `command: "completion"`, `binName: rootCommand.meta.name`,
  `shells: ["bash", "zsh", "fish"]`, `version`: read from package.json or
  fall back to a sensible string
- [ ] In `setup(ctx, actions)`: register a subcommand `completion` with a
  positional `<shell>` argument constrained by TP-009's
  `choices: ["bash", "zsh", "fish"]` and a `--output-dir <path>` flag.
  **Walk lazily inside `run()`** (not at `setup()` time) so plugin order is
  irrelevant
- [ ] `run()` handler: walk `ctx.rootCommand` to a `CompletionSpec`, dispatch
  to the appropriate template renderer, and either print to stdout (default)
  or write to `<output-dir>/<filename>` for each shell where filename is:
  `<bin>` for bash (no extension), `_<bin>` for zsh (with `#compdef <bin>`
  first line), `<bin>.fish` for fish
- [ ] Re-export `completionPlugin` and `CompletionPluginOptions` from
  `packages/plugins/src/index.ts`
- [ ] Add `index.test.ts`: register the plugin in a test CLI, invoke
  `mycli completion bash` and assert output starts with
  `# completion script for mycli`; invoke
  `mycli completion bash --output-dir <tmp>` and assert all three filenames
  are written with the correct content (or document why only the requested
  shell is written — pin the behavior either way in the test)
- [ ] Run targeted tests: `cd packages/plugins && bun test src/completion/`

**Artifacts:**
- `packages/plugins/src/completion/index.ts` (new)
- `packages/plugins/src/completion/index.test.ts` (new)
- `packages/plugins/src/index.ts` (modified)

### Step 6: Documentation

> ⚠️ Hydrate: Confirm exact MDX paths and any `meta.json` / sidebar
> conventions by reading
> `apps/docs/content/docs/modules/plugins/` before writing the new page.
> Cross-link from the existing plugins guide if one exists.

- [ ] Create `apps/docs/content/docs/modules/plugins/completion.mdx` covering:
  - **Usage**: how to register the plugin and the available options
  - **Per-shell install**: print + redirect, or `eval` in the rc file, for
    each of bash/zsh/fish
  - **Packaging recipes**: Homebrew formula snippet using
    `generate_completions_from_executable`, Nix derivation using
    `installShellCompletion`, AUR PKGBUILD example (pull verbatim/adapted
    from `/tmp/crust-completion-verification/distribution-patterns.md`)
  - **Cross-compile note for nixpkgs**: ship `completions/` in the npm
    tarball using `prepublishOnly` + `--output-dir` + `package.json#files`;
    document the convention
  - **Drift handling**: "after upgrading the CLI, regenerate completion:
    `mycli completion <shell> > path`". Mention the version comment in
    generated scripts
  - **Limitations (v1)**: no dynamic value completion (planned for a future
    minor bump). No PowerShell (planned)
  - **Design notes** (collapsed `<details>` or similar): brief explanation of
    pure-static vs pure-delegate tradeoff, link to research artifacts in
    `/tmp/crust-completion-research/`
- [ ] Add a `completionPlugin` row to the plugin table in
  `packages/plugins/README.md`
- [ ] Check `apps/docs/content/docs/guide/*.mdx` — if there's an existing
  "plugins" guide, add a one-line mention of `completionPlugin` with a link
  to the new module page

**Artifacts:**
- `apps/docs/content/docs/modules/plugins/completion.mdx` (new)
- `packages/plugins/README.md` (modified)
- `apps/docs/content/docs/guide/*.mdx` (modified, if a plugins guide exists)

### Step 7: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality
> gate. Earlier steps used targeted tests for fast feedback.

- [ ] Run FULL test suite: `bun run check && bun run check:types && bun run test`
- [ ] Build passes: `bun run build`
- [ ] Manual smoke test: scaffold a tiny CLI in a temp dir, register
  `completionPlugin`, run `./mycli completion bash` and
  `./mycli completion bash --output-dir tmp/`, eyeball the output
- [ ] Add changeset via `bunx changeset`: `@crustjs/plugins`: minor — add
  `completionPlugin` for shell tab-completion (bash/zsh/fish, pure-static)

## Documentation Requirements

**Must Update:**
- `apps/docs/content/docs/modules/plugins/completion.mdx` (NEW) — full plugin
  docs as outlined in Step 6
- `packages/plugins/README.md` — add `completionPlugin` to the plugin table

**Check If Affected:**
- `apps/docs/content/docs/guide/*.mdx` — if a "plugins" guide exists, add a
  one-line mention with a link to the new module page

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing (full suite green)
- [ ] Build green (`bun run build`)
- [ ] Documentation updated and cross-links resolve
- [ ] Changeset added for `@crustjs/plugins` (minor)

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-010): complete Step N — description`
- **Bug fixes:** `fix(TP-010): description`
- **Tests:** `test(TP-010): description`
- **Hydration:** `hydrate: TP-010 expand Step N checkboxes`

## Do NOT

- Add `complete?:` callback fields to `FlagDef`/`ArgDef` — deferred to the
  v2 dynamic-completion task. **This task is pure-static only.**
- Add a hidden `__complete` runtime subcommand — pure-static doesn't need one
- Add a PowerShell template — v2 roadmap, not v1
- Auto-write to user dotfiles — print-only and `--output-dir` only
- Add runtime middleware bypass — not needed for pure-static
- Hand-maintain shell scripts — generate from the walker every time
- Walk the command tree at plugin `setup()` time — walk lazily inside `run()`
  so plugin order is irrelevant
- Expand task scope — add tech debt to `taskplane-tasks/CONTEXT.md` instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the `TP-010` prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->

### Amendment 1 — 2026-05-06 (supervisor pre-flight, post PR #116)

**Issue:** PR #116 (TP-016) merged after this PROMPT was authored and
changed the API surface that TP-010 references in its Tier 3 context:

1. **`packages/plugins/src/did-you-mean.ts`** — The PROMPT describes
   `findSuggestions` as taking a flat `details.available` string array
   from the routing error. After TP-016, the function signature is now:
   ```ts
   findSuggestions(input: string, subCommands: Record<string, CommandNode>): string[]
   ```
   The function iterates **both canonical names AND aliases** itself
   (via `node.meta.aliases ?? []`), maps alias matches back to canonical
   names, and only ever emits canonical names as suggestions.
2. **`packages/core/src/router.ts`** — TP-016 added a `findAliasMatch()`
   helper. `commandPath` always records canonical names, never the
   alias the user typed.
3. **`packages/core/src/types.ts`** — `CommandMeta` now has
   `aliases?: readonly string[]`. The completion-plugin walker may want
   to surface aliases in the `CompletionSpec` (so generated bash/zsh/fish
   scripts can complete alias spellings too).

**Resolution:**
- **Step 1 (Walker):** When walking the live `CommandNode` tree, decide
  whether the `CompletionSpec` should include aliases:
  - **Recommended:** Include aliases as additional completion candidates
    that resolve to the same canonical name, so users can type-complete
    any alias and the shell will offer it. Mirror the router's
    canonical-first behavior — the canonical name is the source of
    truth for the spec, with aliases as additional surface.
  - Add `aliases?: readonly string[]` to whatever node type your
    `CompletionSpec` uses, populated from `commandNode.meta.aliases`.
- **Step 0 preflight:** Re-read `packages/plugins/src/did-you-mean.ts`
  and `packages/core/src/router.ts` on `main` to understand the current
  alias-aware behavior. The PROMPT's description of `findSuggestions`
  is stale — your walker has different concerns, but understanding the
  established pattern will inform CompletionSpec design.
- **No direct conflict** with TP-010's own scope (TP-010 creates new
  files in `packages/plugins/src/completion/` and does not modify
  `did-you-mean.ts` or `router.ts`).

**Source:** Scout staleness audit 2026-05-06, `tp-track-plugins.md`.
