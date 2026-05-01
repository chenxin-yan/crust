# Research: Command/Subcommand Aliases in Mature CLI Frameworks

## Summary
Across mature CLI frameworks the dominant shape is a **plural `aliases: string[]`** field (or method) attached to each command, applied identically to root and subcommands, rendered in `--help` next to the canonical name. Only Clipanion deviates by collapsing names+aliases into a unified `paths: string[][]` model. The strongest design points to copy for a TS `defineCommand`-style API are: plural `aliases`, error on duplicate registration, include aliases in did-you-mean output, and an optional `deprecated` flag for migration-only aliases.

## Findings

### 1. Commander.js — `.alias()` / `.aliases()`
- Single: `cmd.alias('rm')`. Plural: `cmd.aliases(['rm', 'remove'])`. Plural method was added in PR #1236; both forms remain. [Source](https://github.com/tj/commander.js/pull/1236)
- Subcommands and root both use the same method on the `Command` instance.
- Help output renders as `name|alias1|alias2` in usage lines.
- **Conflict behavior:** v12+ throws at registration if an alias collides with an existing alias, command name, or subcommand name in the same parent. PR #1924 "Prevent aliases already in use…" — released as a semver-major change. [Source](https://github.com/tj/commander.js/pull/1924)
- Did-you-mean: Commander's `showSuggestionAfterError` matcher includes alias strings (it iterates over all known names+aliases of registered commands).
- Constraints: alias string must not contain whitespace/brackets (the parser uses brackets for arg syntax in `command()`).

### 2. oclif — `static aliases = [...]`
- Plural only: `static aliases = ['config:index', 'config:list']`. No singular form. [Source](https://oclif.io/docs/aliases)
- Companion `static deprecateAliases = true` emits a warning and tells users the canonical form — explicit migration support.
- **Subcommand aliases are an open gap:** issue #984 "Ability to set aliases for sub commands" notes top-level `aliases` does not propagate; each command class re-declares its own. [Source](https://github.com/oclif/core/issues/984)
- Bin-level aliases are a separate mechanism (`binAliases` in `package.json`) for the CLI executable name itself.
- Flag aliases mirror command aliases: `aliases: [...]` plus `deprecateAliases`.
- `hideAliases` help option proposed in PR #819 to keep crowded help output clean. [Source](https://github.com/oclif/core/pull/819)

### 3. Clipanion — `static paths = [[...], [...]]`
- No separate "alias" concept. A command declares an array of *paths*; each path is itself an array of tokens. `static paths = [['install'], ['i']]` makes `install` and `i` equivalent. [Source](https://mael.dev/clipanion/docs/paths)
- This naturally supports multi-token aliases (`['remote', 'add']` vs `['ra']`) — something flat alias arrays can't express.
- `Command.Default` symbol or empty array marks a command as the no-arg fallback.
- Conflict resolution is *parser-driven*: identical paths with different option shapes are allowed; truly identical paths produce `AmbiguousSyntaxError` at runtime, not registration.
- Tradeoff: more expressive but unfamiliar; users must mentally distinguish "path list" from "name + aliases".

### 4. cac — `command.alias(name)`
- Singular only, called multiple times for multiple aliases: `cli.command('rm <dir>').alias('remove').alias('delete')`. [Source](https://github.com/cacjs/cac/blob/main/README.md)
- Constraint: "the `name` here can't contain brackets" (brackets are reserved for argument specs).
- No documented duplicate-detection or did-you-mean. Aliases were added to help output post-hoc in PR #145. [Source](https://github.com/cacjs/cac/pull/145)
- Same API for top-level and subcommands (cac has no real "subcommand" — it's flat with git-style names).

### 5. yargs — first element of name array is canonical, rest are aliases
- `yargs.command(['serve', 'start', 's'], 'desc', builder, handler)` — the array form makes element 0 the canonical name and 1..N aliases. Also accepts a single space-separated string `'serve [port]'`. [Source](https://github.com/yargs/yargs/blob/main/docs/advanced.md)
- Help output renders aliases comma-separated next to the command line.
- Same shape applies to nested commands defined inside a `builder` function.
- No registration-time conflict error; later registrations silently shadow.
- Did-you-mean (`recommendCommands()`) compares against canonical names and aliases.
- Note: `.alias()` at the yargs *instance* level is a different API — it's for **option** aliases, a frequent source of confusion.

### 6. citty (unjs) — `meta.aliases` / top-level `alias`
- Added in v0.2.2 via PR #170: a command's definition object accepts `alias: string | string[]` (and the issue tracker references `aliases` plural). [Source](https://github.com/unjs/citty/pull/170) [Release](https://github.com/unjs/citty/releases/tag/v0.2.2)
- Works on subcommands defined inside `subCommands: { ... }`.
- Implementation has had coverage gaps (PR #170 patch coverage 64%); pi0 noted "Landing via #236" — feature is still consolidating as of 2026.
- Constraint: aliases are matched as exact subcommand keys at lookup time, no glob/regex.

### 7. Cobra (Go) — `Aliases []string`
- Plural-only field on `cobra.Command`: `Aliases: []string{"i", "add"}` for `install`. [Source](https://cobra.dev/docs/how-to-guides/working-with-commands)
- Identical for root and any subcommand (Cobra has no structural distinction).
- `--help` lists aliases on a dedicated `Aliases:` line, comma-separated.
- **Did-you-mean uses both names and aliases** for Levenshtein matching, plus an explicit `SuggestFor []string` field for non-similar suggestions (e.g., `times` is suggested for `counts`). [Source](https://github.com/spf13/cobra/blob/main/command.go)
- **Conflict behavior is permissive:** Cobra does not error if two siblings declare the same alias or if an alias shadows a sibling's `Use` name. Lookup iterates children and the first match wins. Issue #2185 explicitly tracks the lack of collision detection. [Source](https://github.com/spf13/cobra/issues/2185)
- Parent-path aliases not supported (issue #895): you can't alias `foo bar` to `quux`; aliases live at one level only — same limitation as every framework here except Clipanion.
- No constraints on alias strings beyond shell-safety (whitespace breaks parsing).

## Comparison Table

| Framework | API | Singular & Plural? | Subcommand parity | Help rendering | Conflict on duplicate | Aliases in suggestions | Migration/deprecation |
|---|---|---|---|---|---|---|---|
| Commander.js | `.alias(s)` / `.aliases([])` | both | yes | `name\|a1\|a2` | **throws** (v12+) | yes | — |
| oclif | `static aliases = []` | plural only | yes (must redeclare) | listed in help | not documented | yes | `deprecateAliases: true` |
| Clipanion | `static paths = [[]]` | unified | yes (n-ary tokens) | each path listed | runtime ambiguity error | n/a (path-based) | — |
| cac | `.alias(s)` | singular, chain | yes (flat) | listed (since #145) | not documented | not documented | — |
| yargs | `command([name, ...aliases])` | array form | yes | comma-separated | last-write-wins | yes | — |
| citty | `alias: string \| string[]` (also `aliases`) | both | yes | listed | not documented | not documented | — |
| Cobra | `Aliases []string` | plural only | yes | `Aliases:` line | **none** (silent shadow) | yes + `SuggestFor` | — |

## Sources

**Kept**
- Commander.js PR #1236 — introduces plural `.aliases()`. https://github.com/tj/commander.js/pull/1236
- Commander.js PR #1924 — registration-time conflict detection (semver-major). https://github.com/tj/commander.js/pull/1924
- oclif Aliases doc — canonical reference for `static aliases`, `deprecateAliases`, `binAliases`. https://oclif.io/docs/aliases
- oclif issue #984 — subcommand alias gap. https://github.com/oclif/core/issues/984
- Clipanion paths doc — unified path/alias model. https://mael.dev/clipanion/docs/paths
- cac README — `command.alias(name)` constraint and signature. https://github.com/cacjs/cac/blob/main/README.md
- yargs advanced docs — array-form command names. https://github.com/yargs/yargs/blob/main/docs/advanced.md
- citty PR #170 — added `aliases`. https://github.com/unjs/citty/pull/170
- Cobra "Working with Commands" — `Aliases []string` example. https://cobra.dev/docs/how-to-guides/working-with-commands
- Cobra command.go — source of truth for alias matching + `SuggestFor`. https://github.com/spf13/cobra/blob/main/command.go
- Cobra issue #2185 — documents lack of collision detection. https://github.com/spf13/cobra/issues/2185

**Dropped**
- Yarn berry #3077 — about user-config aliases, not Clipanion's own API.
- Generic devhints/medium articles — secondary, no new info.
- Stack Overflow Q39844938 — predates `.aliases()` plural support.

## Gaps
- **Exact alias-string validation rules** in Commander, citty, and oclif weren't fully verified from docs alone — would require reading source (`Command#_checkForConflictingCommand`, oclif's `Config.findCommand`).
- **Whether Commander's suggestion engine includes aliases of *deprecated* commands** isn't documented; would need a quick code read.
- **citty's behavior on duplicate aliases between sibling subcommands** is undocumented; PR #170 has only 64% patch coverage so behavior is likely "last write wins" but should be confirmed in `src/command.ts`.

Suggested next steps if these matter for Crust: (a) read `commander/lib/command.js` `_registerCommand` and `cobra/command.go` `Find`; (b) write a small probe script for citty to confirm collision behavior empirically.

## Recommended shape for Crust

For a TypeScript, Bun-native, declarative `defineCommand` API, the convergent best-of-breed shape is:

```ts
defineCommand({
  name: "install",
  aliases: ["i", "add"],          // plural, string[]; accept string for ergonomics
  deprecatedAliases: ["isntall"], // optional, emits warning + canonical hint (oclif-style)
  // ...
  subcommands: {
    add: defineCommand({ name: "add", aliases: ["a"], /* ... */ }),
  },
});
```

Design rules to adopt, with citations:

1. **Plural `aliases: string | string[]`** as the primary surface — matches Cobra, oclif, citty; accept a bare string for ergonomics like commander/citty. Avoid yargs' "first element of name" trick: it conflates naming with aliasing and confuses TS types. ([oclif](https://oclif.io/docs/aliases), [Cobra](https://cobra.dev/docs/how-to-guides/working-with-commands))
2. **Identical API for root and subcommands** — every surveyed framework does this; Clipanion's path-list is more expressive but costs comprehensibility.
3. **Error at registration on duplicates** within the same parent (alias↔alias, alias↔canonical, alias↔subcommand-name). Commander adopted this in v12 as a deliberate semver-major; Cobra explicitly regrets not doing so (#2185). Surface a typed `AliasConflictError` with both offending command paths. ([commander #1924](https://github.com/tj/commander.js/pull/1924), [cobra #2185](https://github.com/spf13/cobra/issues/2185))
4. **Include aliases in did-you-mean output**, with canonical name shown as the suggestion (Cobra and Commander do this). Optionally support a Cobra-style `suggestFor: string[]` for non-similar mappings. ([cobra command.go](https://github.com/spf13/cobra/blob/main/command.go))
5. **Help rendering**: show `install (i, add)` next to the command in parent listings, and a dedicated `Aliases:` line on the per-command help page (Cobra style is the cleanest).
6. **Constraints**: reject empty strings, whitespace, and strings starting with `-` (would be parsed as flags). Don't allow brackets — cac's documented carve-out — since you'll likely reuse `<arg>` / `[arg]` syntax in `name`.
7. **First-class deprecation**: `deprecatedAliases` (or `aliases: [{ name, deprecated: true, replaceWith }]`) inspired by oclif. Emits a stderr notice on use; hideable from help via a flag.
8. **Don't try to support multi-token aliases** in the v1 surface. Clipanion proves it's possible but adds significant parser complexity; every other framework punts on this and users rarely complain.

Default to the simplest thing that captures these wins: a plural `aliases` field, validated and conflict-checked at `defineCommand` registration, surfaced in help and suggestions identically to canonical names.
