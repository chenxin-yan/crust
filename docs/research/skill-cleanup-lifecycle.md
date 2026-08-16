# Skill cleanup lifecycle: what happens to installed agent-dir copies when the CLI package is uninstalled?

Context: `@crustjs/skills` (post-#196) copies packaged skill directories into agent
discovery dirs (`~/.claude/skills/<name>`, `.agents/skills/<name>`, …) with a
`crust.json` ownership manifest, and refreshes stale copies via a preRun hook.
Problem under investigation: uninstalling the CLI package orphans the copies —
nothing crust-owned ever runs again to clean them up.

## 1. Uninstall lifecycle hooks are dead

- **npm ≥7 does not run uninstall scripts.** Official docs have a dedicated
  section: "A Note on a lack of `npm uninstall` scripts — While npm v6 had
  `uninstall` lifecycle scripts, npm v7 does not."
  ([npm docs, current v11](https://docs.npmjs.com/cli/v11/using-npm/scripts#a-note-on-a-lack-of-npm-uninstall-scripts))
- **Bun** documents only install-side hooks (`preinstall`/`postinstall`/…); no
  uninstall hooks exist. ([Bun lifecycle docs](https://bun.com/docs/pm/lifecycle))
- **pnpm ≥10** goes further: it blocks _install-side_ lifecycle scripts of
  dependencies by default (allowlist via `onlyBuiltDependencies`), so even
  install-time hooks can't be relied on.
- Conclusion: **no package manager will run our code at uninstall time.** Any
  cleanup must happen either before uninstall (user-initiated) or after the
  fact (something else sweeps orphans).

## 2. Symlinks

- Breakage modes (from #182's rationale, still valid): pnpm content-addressed
  store paths move/prune across installs; `npx`/`bunx` caches are ephemeral;
  `node_modules` is rebuilt on update; global agent dirs can't sensibly pin one
  project's `node_modules`; compiled executables have no package dir at all.
- Agent support is real but inconsistent: Claude Code's current docs state
  symlinked skill dirs **are** followed
  ([docs](https://code.claude.com/docs/en/skills#where-skills-live)), but there
  are recent bugs where symlinked skills failed discovery or validation
  ([#14836](https://github.com/anthropics/claude-code/issues/14836),
  [#25367](https://github.com/anthropics/claude-code/issues/25367)). Behavior
  across the ~40 agents in crust's matrix is unverifiable.
- A dangling symlink is self-cleaning in spirit ("skill disappears with the
  package") but leaves an entry with **no readable `crust.json`**, so
  ownership-safe tooling can't reclaim it, and some agents may error on it.

## 3. Prior art

- **Playwright** (browsers in a shared cache outside the package): keeps a
  registry and **garbage-collects stale browsers when the package runs**
  (`install` checks what other Playwright versions on the machine still
  reference); also ships an explicit `npx playwright uninstall [--all]` and
  documents running it _before_ `npm uninstall`. GC is aggressive enough that
  it has caused bug reports
  ([playwright.dev/docs/browsers](https://playwright.dev/docs/browsers#uninstall-browsers),
  [#40995](https://github.com/microsoft/playwright/issues/40995)).
  Net: orphans are accepted; cleanup = next-run GC + documented manual command.
- **Claude Code plugins**: a _managed_ model — the agent (not the package) owns
  a central registry (`~/.claude/plugins/installed_plugins.json`) and provides
  `claude plugin uninstall`; removing a marketplace uninstalls its plugins
  ([docs](https://code.claude.com/docs/en/discover-plugins#manage-installed-plugins)).
  Cleanup works because the _host_ outlives the packages. Crust has no such
  always-alive host.
- **husky, corepack, esbuild-style binary downloads**: all leave external state
  (hooks config, shims, caches) behind on `npm uninstall`; none attempt
  automated cleanup. Orphan acceptance is the ecosystem norm.

## 4. Orphan-reaping patterns given `crust.json`

The manifest already marks ownership per directory. To reap orphans, something
must (a) run after the package is gone, and (b) be able to decide "the owner is
gone" without false positives:

- **Owner-liveness probe**: record owner identity in `crust.json` (bin name
  and/or package name + install scope). A sweeper checks `Bun.which(bin)` /
  resolvability. False-positive risk: package present in some project's
  `node_modules` but bin not on PATH; PATH differences between shells; project
  vs global scope ambiguity.
- **Who sweeps?** Options: any other crust-based CLI's preRun hook (sweeps
  siblings' orphans); a standalone `npx @crustjs/cleanup`; the user manually.
  Hard limit acknowledged: if nothing crust-adjacent ever runs again, nothing
  sweeps. There is no way around this without an uninstall hook, which (§1)
  does not exist.

## 5. Coupling-focused findings (round 2)

- **pnpm's top-level `node_modules/<pkg>` is a stable symlink for direct
  dependencies** (`node_modules/foo -> ./.pnpm/foo@1.0.0/node_modules/foo`).
  The earlier "symlinks break under pnpm" claim applies to _realpath/store_
  targets, not to the name-based path. A link targeting
  `node_modules/<pkg>/skills/<name>` (unresolved) survives reinstalls and
  version bumps, and dangles exactly when the dependency is removed —
  i.e. lifecycle coupling by construction, for project scope.
  ([pnpm symlinked structure docs](https://pnpm.io/symlinked-node-modules-structure))
- **Skills-over-MCP is an active standardization effort**: `skill://` URI
  scheme with a `skill://index.json` discovery document; Microsoft Agent
  Framework already consumes MCP-hosted skills (fetches `SKILL.md` bodies via
  `resources/read`); Mintlify serves skills via the `.well-known` agent-skills
  URI and as MCP resources; an MCP interest group is meeting on it.
  ([MS Agent Framework skills docs](https://learn.microsoft.com/en-us/agent-framework/agents/skills),
  [MCP discussion #2585](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/2585))

## 6. Round 3: hinting/requiring cleanup, and post-mortem recovery

Hard constraint reconfirmed: no uninstall hooks (npm ratified the removal in
[npm/cli#3042](https://github.com/npm/cli/issues/3042); Yarn Berry calls the
omission deliberate; Bun runs install-side scripts only for allowlisted
packages), no uninstall-time messaging channel (`npm deprecate` is
install-time; no brew-`caveats` equivalent), and install-time `postinstall`
hints are hidden (npm ≥7 background scripts) or blocked (pnpm 10, bun)
([Yarn: "using them to print a message … will not work"](https://yarnpkg.com/advanced/lifecycle-scripts#postinstall)).
All reliable hint channels are **CLI runtime**.

Key findings:

- **`npx <cli>` works after uninstall** — npx fetches from the registry when
  the package is absent ([npx docs](https://docs.npmjs.com/cli/v11/commands/npx)),
  so `npx <cli> skill clean` is a valid _post-mortem_ cleanup with no companion
  package; the per-dir `crust.json` ownership manifest is what makes it safe
  (delete only owned dirs). No dedicated `<pkg>-uninstall` companion packages
  were found in the wild — the pattern lives as subcommands.
- **Two-step uninstall docs are the established pattern**: Playwright's
  "Uninstall browsers" section (`npx playwright uninstall`, then
  `npm uninstall`) with no enforcement
  ([playwright.dev](https://playwright.dev/docs/browsers#uninstall-browsers));
  its real mitigation is next-run GC by surviving installs. Husky v4 shipped a
  `preuninstall` hook that silently died on npm 7; v9 documents an
  after-the-fact manual fix instead
  ([husky troubleshoot](https://github.com/typicode/husky/blob/main/docs/troubleshoot.md)).
- **Self-uninstall verbs have prior art but must not execute package removal**:
  `rustup self uninstall` (owns its install dir), `mops self uninstall`
  (npm-distributed). AWS Amplify's `amplify uninstall` on npm-managed installs
  deleted files while npm still believed the package was installed
  ([amplify-cli#10610](https://github.com/aws-amplify/amplify-cli/issues/10610));
  Windows also can't delete an in-use node tree. Safe shape: delete owned
  skills, then _print_ the correct `npm rm -g`/`bun rm -g` command.
- **Orphaned skills are not inert in Claude Code**: every skill's
  name+description loads into every session's context (≈1% budget, visible in
  `/doctor`), malformed/stale skills are loaded silently rather than
  quarantined, and there is no GC
  ([CC skills docs](https://code.claude.com/docs/en/skills#troubleshooting)).
  Deletions are picked up live, no restart
  ([live change detection](https://code.claude.com/docs/en/skills#live-change-detection)).
- **Skill content instructing npx commands is established** (Vercel's bundled
  `find-skills` tells agents to run `npx skills …`
  [SKILL.md](https://github.com/vercel-labs/skills/blob/main/skills/find-skills/SKILL.md)),
  but **a skill instructing its own deletion is an anti-pattern**: "delete
  files" payloads embedded in skill files are the canonical _attack_ examples
  in skill-injection security literature
  ([arXiv:2602.20156](https://arxiv.org/pdf/2602.20156)); scanners and
  reviewers will flag it. Safe variant: detect the missing CLI, inform the
  user, suggest `npx <cli> skill clean` — let the user-invoked CLI delete
  against ownership manifests. Claude Code's `` !`cmd` `` dynamic-context can
  probe liveness at render time but is CC-only and policy-disableable.
- **Vercel `skills` CLI** (closest analog) tracks installs in central
  lockfiles, defaults to symlink-to-canonical-copy with `--copy` fallback, has
  known stale-lockfile bugs, and does no GC — nobody in this ecosystem has
  solved orphan cleanup.

Full briefs: session subagent artifacts `db3cb636` (pre-uninstall patterns)
and `b7d2c868` (post-mortem + skills ecosystem).

## 7. Round 4: empirical symlink verification (npm 11.19 / pnpm 11.20 / bun 1.3.14, Linux)

Experiment: `fake-cli` package with `skills/demo-skill/` (SKILL.md + crust.json),
installed from tarball (registry simulation); agent dir entry created as a
**name-based, unresolved** symlink `.agents/skills/demo-skill →
../../node_modules/fake-cli/skills/demo-skill`. Sandboxed global installs via
`npm_config_prefix` / `PNPM_HOME` / `BUN_INSTALL`. Sandboxes retained at
`/tmp/crust-symlink-exp-{npm,pnpm,bun}`; full reports in session subagent
artifacts `2a7a94aa` (npm), `3d3b3093` (pnpm), `ab54a4c9` (bun).

| scenario                                                       | npm  | pnpm                                                                                     | bun  |
| -------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------- | ---- |
| install v1, read through link                                  | PASS | PASS (top-level `node_modules/fake-cli` is itself a symlink; name-based traversal works) | PASS |
| update v1→v2, link untouched shows v2                          | PASS | PASS (realpath changed store dirs; name path stable)                                     | PASS |
| `rm -rf node_modules` + reinstall from lockfile                | PASS | PASS                                                                                     | PASS |
| `pnpm store prune`                                             | —    | PASS                                                                                     | —    |
| uninstall → link dangles (cat fails ENOENT, entry still lists) | PASS | PASS                                                                                     | PASS |
| reinstall after dangle → link revives untouched                | PASS | PASS                                                                                     | PASS |
| global install/update/uninstall (sandboxed)                    | PASS | PASS with caveat                                                                         | PASS |

No package manager warned about or touched the foreign agent-dir symlink in
any operation.

Caveats observed:

- **pnpm global root is version-suffixed** (`…/pnpm-home/global/v11`) and
  contains hash-alias indirection; a pnpm major upgrade (v11→v12) would move
  the root and dangle global links while the package is still installed.
- Same hazard class for npm/bun global under node version managers (nvm/mise):
  switching node versions moves `npm root -g`, dangling global links while the
  package remains installed in another version's tree. (Reasoned, not tested.)
- bun quirk: updating an installed local _tarball_ requires the
  `pkg@<tarball>` form (`DependencyLoop` otherwise) — irrelevant to registry
  installs.
- Untested here: Windows symlink privileges, bunx/npx ephemeral installs
  (no stable path — needs copy fallback), compiled executables (no
  node_modules — needs copy fallback), and per-agent symlink following
  (§2: Claude Code docs say followed; other agents unverified).

## 8. Prior art: TanStack Intent (Mar 2026)

[@tanstack/intent](https://github.com/tanstack/intent) is a CLI for shipping
Agent Skills inside npm packages — "the skill releases with the code it
explains" ([blog](https://tanstack.com/blog/from-docs-to-agents)).

- **Maintainer side**: skills live at `skills/<name>/SKILL.md` in the package
  (agentskills.io format); `edit-package-json` adds the `tanstack-intent`
  keyword (discovery marker) + `files` entries; `scaffold` drafts skills from
  docs; each skill declares `metadata.sources` (the docs it derives from) and
  `intent stale` fails CI when sources drift — staleness as a first-class,
  build-time concern.
- **Consumer side: no copies into agent skill dirs at all.** `intent install`
  writes one managed guidance block (`<!-- intent-skills:start/end -->`) into
  AGENTS.md / CLAUDE.md / .cursorrules telling the agent to run
  `npx @tanstack/intent list` before substantial work and
  `intent load <pkg>#<skill>` to fetch SKILL.md content on demand
  ([Vercel guide](https://vercel.com/kb/guide/using-tanstack-intent-to-ship-and-consume-agent-skills)).
  Discovery scans installed deps (node_modules, workspaces, Yarn PnP) for the
  keyword; `package.json#intent.skills` is a consumer allowlist. `hooks
install` adds harder enforcement for supported agents.
- **Lifecycle consequences**: content is read from the installed package at
  load time (sync by construction, pinned to installed version); uninstalling
  a package silently drops its skills from `list` (dead by construction); the
  only installed artifact is one package-agnostic guidance block that never
  goes per-package stale.
- **Trade-offs**: bypasses agents' native skill discovery (no advertise stage
  from skill dirs — every session pays the guidance block + a `list` run);
  soft reliance on agents following instructions, hardened by hooks;
  project-dependency oriented rather than global-CLI oriented.

This independently validates the live-pointer architecture (§5 option B2),
generalized: one loader block instead of per-skill stubs.

## 9. Options matrix

| Option                             | Requires                                                                             | Breaks / fails when                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Copy + accept orphans (status quo) | docs telling users to run `cli skill` deselect/uninstall first                       | user uninstalls without cleanup → inert stale skills forever                                                      |
| Copy + owner-liveness reaper       | owner identity in `crust.json`; sweep logic in preRun and/or standalone cleanup tool | no crust CLI ever runs again; owner-liveness heuristics misfire (PATH, project-local installs)                    |
| Symlink into package               | per-agent symlink support; stable package path                                       | pnpm store, bunx/npx caches, updates, global scope, compiled binaries; dangling links unreclaimable (no manifest) |
| Pointer/stub SKILL.md              | agents dereferencing content they don't natively support                             | dead on arrival: discovery contracts are content-based                                                            |
| preuninstall hook                  | package-manager support                                                              | npm ≥7 removed it; pnpm/bun never run it                                                                          |
