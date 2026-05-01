# Scout Report: Command & Subcommand Alias Support in Crust CLI

**Date:** 2026-05-03  
**Repo:** github.com/chenxin-yan/crust  
**Focus:** @crustjs/core + plugins that touch command names  

---

## Executive Summary

The Crust CLI framework has **no alias support for commands or subcommands**. The current design:
- **Commands are defined** via the `Crust` builder API with a single, immutable `name` field
- **Subcommands are keyed** by their canonical name in a `Record<string, CommandNode>` registry
- **Resolution is exact string matching** in `resolveCommand()` against registry keys
- **Name metadata is immutable** at runtime—no facility for aliases

Adding alias support will require:
1. **Type definition changes** in `CommandMeta` (add `alias?` or `aliases?` field)
2. **Resolution logic changes** in `resolveCommand()` to check both canonical names and alias matches
3. **Registry/collision validation changes** to detect alias→name and alias→alias collisions
4. **Help/autocomplete/man regeneration** to enumerate and display aliases alongside canonical names
5. **Test coverage** for alias resolution, collision detection, and display logic

This report maps the exact extension points and identifies prior art (TP-009, TP-010) that shows how to add optional fields to command metadata and filter help output.

---

## 1. Command Definition API & TypeScript Types

### Files Retrieved
- `packages/core/src/types.ts` (lines 553–563) — `CommandMeta` interface
- `packages/core/src/node.ts` (lines 1–48) — `CommandNode` structure
- `packages/core/src/crust.ts` (lines 1–50, 150–170) — `Crust` builder API overview

### Current Command Definition

**`CommandMeta` interface** (`packages/core/src/types.ts`, lines 553–563):
```typescript
export interface CommandMeta {
	/** The command name (used in help text and routing) */
	name: string;
	/** Human-readable description for help text */
	description?: string;
	/** Custom usage string (overrides auto-generated usage) */
	usage?: string;
}
```

**`CommandNode` structure** (`packages/core/src/node.ts`, lines 11–48):
```typescript
export interface CommandNode {
	meta: CommandMeta;  // ← Contains name, description, usage only
	localFlags: FlagsDef;
	effectiveFlags: FlagsDef;
	args: ArgsDef | undefined;
	subCommands: Record<string, CommandNode>;  // ← Keyed by canonical name
	plugins: CrustPlugin[];
	preRun?: (ctx: unknown) => void | Promise<void>;
	run?: (ctx: unknown) => void | Promise<void>;
	postRun?: (ctx: unknown) => void | Promise<void>;
}
```

**Crust Builder API** (`packages/core/src/crust.ts`, lines 150–170):
```typescript
/**
 * Set metadata (description, usage) for this command.
 */
meta(meta: Omit<CommandMeta, "name">): Crust<...> { ... }

/**
 * Register a named subcommand via inline callback.
 * @param name - Subcommand name (must be non-empty, unique among siblings)
 */
command<N extends string>(
	name: N,
	cb: (cmd: Crust<...>) => Crust<...>,
): Crust<...>;

/**
 * Register a pre-built subcommand builder.
 * The builder's name (from its constructor or `.sub()`) is used as the subcommand name.
 */
command(builder: Crust<any, any, any>): Crust<...>;
```

### Key Observation: No Alias Field Yet
- `CommandMeta` has **only** `name`, `description`, `usage`
- **No `alias`, `aliases`, or similar field exists**
- The `name` field is assigned during builder construction and is **read-only** in the runtime `CommandNode`
- Subcommand registration by name happens in `.command(name, cb)` or `.command(builder)` where the builder's `_node.meta.name` becomes the registry key

---

## 2. Subcommand Registration & Parent→Child Relationship

### Files Retrieved
- `packages/core/src/crust.ts` (lines 579–696) — `.command()` implementation
- `packages/core/src/node.ts` (lines 1–48) — `CommandNode` with `subCommands` record
- `packages/core/src/crust.test.ts` (lines 1–100+) — subcommand tests

### Parent→Child Relationship at Runtime

**Subcommands are stored as a flat `Record<string, CommandNode>`**:
```typescript
// In CommandNode (packages/core/src/node.ts)
subCommands: Record<string, CommandNode>;

// In Crust builder (packages/core/src/crust.ts, lines 579–696)
// When a subcommand is registered:
return this._clone({
	subCommands: {
		...this._node.subCommands,
		[name]: childNode,  // ← Registry key is the canonical name
	},
});
```

**Subcommand attachment happens in two paths**:

1. **Inline callback path** (`command(name, cb)`) — lines 598–649:
   - User calls `.command("deploy", (cmd) => cmd.flags(...).run(...))`
   - A child builder is created with inherited flags pre-populated
   - The callback configures the child
   - The returned child's `_node` is extracted and registered under the canonical `name`

2. **Pre-built builder path** (`command(builder)`) — lines 651–696:
   - User calls `.command(app.sub("deploy").flags(...).run(...))`
   - The builder's `_node.meta.name` becomes the registry key
   - Duplicate-name detection runs eagerly at registration too (`packages/core/src/crust.ts:713–718`)

**No direct parent reference**: `CommandNode` has no back-pointer to its parent; the tree is navigated top-down only.

### Collision/Validation Behavior
- **Duplicate subcommand names are detected** during `.command()` calls: `if (this._node.subCommands[name]) throw CrustError("Subcommand already registered")`
- **Validation is runtime**: `validateCommandTree()` (`packages/core/src/validation.ts`) calls `parseArgs()` on each node but does NOT validate subcommand names
- **No collision detection for aliases** exists yet (since aliases don't exist)

---

## 3. Command Resolution & Lookup Function (Key Extension Point)

### Files Retrieved
- `packages/core/src/router.ts` (entire file) — `resolveCommand()` function
- `packages/core/src/router.test.ts` (entire file) — resolution tests

### Current Resolution Logic

**`resolveCommand(command: CommandNode, argv: string[]): CommandRoute`** (`packages/core/src/router.ts`, lines 35–93):

```typescript
export function resolveCommand(
	command: CommandNode,
	argv: string[],
): CommandRoute {
	const path = [command.meta.name];

	let current: CommandNode = command;
	let routedArgv = argv;

	while (routedArgv.length > 0) {
		const subCommands = current.subCommands;
		if (!subCommands || Object.keys(subCommands).length === 0) {
			// No subcommands defined — argv goes to the parser
			break;
		}

		const candidate = routedArgv[0];

		// Skip if the candidate looks like a flag (starts with -) or doesn't exist
		if (!candidate || candidate.startsWith("-")) {
			break;
		}

		// ╔═══════════════════════════════════════════════════════════════════════╗
		// ║ THIS IS THE EXACT MATCH LINE — CRITICAL FOR ALIAS SUPPORT            ║
		// ║ Currently does: `if (candidate in subCommands && subCommands[candidate])`
		// ║ For aliases, need: check subCommands[candidate] OR resolve alias→name  ║
		// ╚═══════════════════════════════════════════════════════════════════════╝
		if (candidate in subCommands && subCommands[candidate]) {
			current = subCommands[candidate];
			path.push(candidate);
			routedArgv = routedArgv.slice(1);
			continue;
		}

		// Unknown subcommand candidate — but only if the parent has no run()
		// If the parent has run(), this could be a positional argument
		if (current.run) {
			break;
		}

		// Parent has no run() — this is an unknown subcommand error
		const available = Object.keys(subCommands);
		throw new CrustError(
			"COMMAND_NOT_FOUND",
			`Unknown command "${candidate}".`,
			{
				input: candidate,
				available,  // ← Only includes canonical names, not aliases
				commandPath: [...path],
				parentCommand: current,
			},
		);
	}

	return {
		command: current,
		argv: routedArgv,
		commandPath: path,
	};
}
```

### Key Observations
1. **The lookup is a simple object membership test**: `if (candidate in subCommands && subCommands[candidate])`
2. **Only canonical names are checked** — no fallback to aliases
3. **The resolved node is returned unchanged** — the alias used is NOT tracked (important for help/error messages later)
4. **The `commandPath` includes only canonical names** — the path returned to plugins reflects resolved names, not aliases
5. **Error reporting lists only canonical names** in `details.available` — aliases are not suggested

### Extension Point for Aliases
The alias-aware lookup would need to:
1. First check if `candidate` matches a canonical name → return that node (fast path)
2. Then check if `candidate` matches any subcommand's alias → resolve to that subcommand's canonical name
3. Build a mapping (either at registration or at resolution time) to support this lookup

**Decision point**: Should the returned `CommandRoute` include which alias was used? (Affects help/error output)

---

## 4. Help Rendering & Command List Display

### Files Retrieved
- `packages/plugins/src/help.ts` (lines 1–170) — `renderHelp()` and `formatCommandsSection()`
- `packages/plugins/src/help.ts` (lines 121–131) — specifically where subcommands are listed

### Current Help Rendering

**`formatCommandsSection(command: CommandNode): string[]`** (`packages/plugins/src/help.ts`, lines 121–131):

```typescript
function formatCommandsSection(command: CommandNode): string[] {
	if (Object.keys(command.subCommands).length === 0) {
		return [];
	}

	const lines = [bold(cyan("COMMANDS:"))];
	for (const [name, subCommand] of Object.entries(command.subCommands)) {
		const rendered = `${padEnd(green(name), COMMAND_COLUMN_WIDTH, " ")} `;
		lines.push(`  ${rendered}${subCommand.meta.description ?? ""}`.trimEnd());
	}

	return lines;
}
```

**Current output format**:
```
COMMANDS:
  build      Build the project
  deploy     Deploy the application
  generate   Generate files
```

### How It Enumerates Commands
- Iterates `Object.entries(command.subCommands)` — keys are canonical names only
- Displays each as `<name>   <description>`
- No grouping by alias; no indication that aliases exist

### Alias Display Considerations (for planning)
1. **Canonical name + aliases in the same line?**  
   ```
   COMMANDS:
     build (b, bld)   Build the project
   ```

2. **Canonical name only, with separate alias list?**  
   ```
   COMMANDS:
     build   Build the project
   
   ALIASES:
     b → build
     bld → build
   ```

3. **Separate entries per alias?** (Not recommended — too verbose)  
   ```
   COMMANDS:
     build   Build the project
     b       (alias for build)
     bld     (alias for build)
   ```

**Recommendation**: Option 1 (inline) or Option 2 (separate section). Requires design decision before implementation.

### Related: TP-009 Prior Art
Task TP-009 added **`hidden?: boolean` to `CommandMeta`** and updated `formatCommandsSection()` to **filter hidden subcommands**:
```typescript
// Added in TP-009:
// Filter out subcommands with meta.hidden === true
for (const [name, subCommand] of Object.entries(command.subCommands)) {
	if (subCommand.meta.hidden === true) continue;  // ← Pattern for metadata-driven filtering
	...
}
```

**Lesson**: The help plugin already filters by metadata. Alias display should follow the same pattern.

---

## 5. Autocomplete / Did-You-Mean / Completion Plugins

### Files Retrieved
- `packages/plugins/src/did-you-mean.ts` (lines 1–120) — `didYouMeanPlugin()` (renamed from `autoCompletePlugin` in TP-008; file renamed from `autocomplete.ts` in PR #115)
- `packages/plugins/src/help.ts` — help plugin (not strictly autocomplete but related)

### Did-You-Mean Plugin (`didYouMeanPlugin`)

**Location**: `packages/plugins/src/did-you-mean.ts`

**Behavior** (`lines 73–120`):
```typescript
export function didYouMeanPlugin(
	options: DidYouMeanPluginOptions = {},
): CrustPlugin {
	const mode = options.mode ?? "error";

	return {
		name: "did-you-mean",
		async middleware(_context, next) {
			try {
				await next();
				return;
			} catch (error) {
				if (!(error instanceof CrustError)) throw error;
				if (!error.is("COMMAND_NOT_FOUND")) throw error;

				const details = error.details;
				// ╔═════════════════════════════════════════════════════════╗
				// ║ THIS LINE IS KEY: findSuggestions() uses details.available
				// ║ details.available = Object.keys(subCommands) — canonical names only
				// ║ For aliases: need to also enumerate aliases in available list
				// ╚═════════════════════════════════════════════════════════╝
				const suggestions = findSuggestions(details.input, details.available);

				let message = `Unknown command "${details.input}".`;
				if (suggestions.length > 0) {
					message += ` Did you mean "${suggestions[0]}"?`;
				}
				// ... render or print message
			}
		},
	};
}
```

### How It Enumerates Command Names

1. **At resolution time**, if an unknown command is encountered, `resolveCommand()` throws `COMMAND_NOT_FOUND` with `details.available = Object.keys(subCommands)`
2. **At middleware time**, the plugin catches the error and calls `findSuggestions(input, details.available)` — where `details.available` contains only **canonical names**
3. **Levenshtein distance matching** (`levenshtein()` function, lines 11–38) ranks suggestions

### Alias-Aware Changes Needed
- `details.available` should include **both canonical names and aliases**
- When displaying suggestions, clarify which are canonical and which are aliases, e.g. `Did you mean "build" (alias: "b")?`
- Or list separately: `Did you mean "build"? (You can also use alias "b")`

### Completion Plugin (Planned in TP-010)

**Files**: `taskplane-tasks/TP-010-completion-plugin-static/PROMPT.md` (referenced but not yet implemented)

**Relevant for aliases**: TP-010 describes a `completionPlugin` that will walk the command tree and emit shell completion scripts. When implemented, it will need to:
- Enumerate subcommands from the tree (via `Object.keys(subCommands)`)
- If aliases are added, include them in completion candidates

**Current status**: TP-010 is not yet merged. Alias support should be compatible with the pure-static walker pattern described in the PROMPT.

---

## 6. Existing Tests for Command-Name Resolution

### Files Retrieved
- `packages/core/src/router.test.ts` (entire file) — 200+ line test suite
- `packages/core/src/crust.test.ts` (lines 1–100+) — builder integration tests

### Test Coverage Baseline

**`packages/core/src/router.test.ts` test cases** (by category):

1. **Basic resolution** (~50 lines):
   - Root command with empty argv
   - Single-level subcommand
   - Subcommand with flags/positionals

2. **Nested subcommands** (~100 lines):
   - 2-level nesting ("generate command")
   - 3+ level nesting ("level1 level2 deep")
   - Nested with remaining argv

3. **Fallback to parent** (~50 lines):
   - Unknown candidate + parent has `run()` → treated as positional
   - Flag arguments (`--help`, `-h`) → not treated as subcommands

4. **Unknown subcommand errors** (~100 lines):
   - Error thrown when parent has no `run()`
   - Error structure with `details.available` capture
   - Nested unknown subcommand errors

5. **Edge cases** (~100 lines):
   - `--` separator handling
   - Multiple candidates (first matches)
   - Mid-level subcommand with no `run()` and unknown child

### Good Test Practices Found
- **Test helper**: `makeNode()` builds `CommandNode` objects with custom metadata for fixtures
- **Error assertion**: Tests validate the `CrustError` shape, including `code` and `details` fields
- **Path tracking**: Tests verify `commandPath` is built correctly as resolution progresses

### Where Alias Tests Should Go
- **Extend `router.test.ts`**: Add "alias resolution" describe block with cases like:
  - "resolves single-character alias to subcommand"
  - "resolves multi-character alias to subcommand"
  - "alias and canonical name resolve to same node"
  - "throws error when alias is unknown"
  - "suggests aliases in COMMAND_NOT_FOUND details.available"
  - "no collision between alias and subcommand name"

- **Extend `crust.test.ts`**: Add builder-level tests like:
  - "`.command(name, cb)` with no aliases defined works (baseline)"
  - "`.command(name, cb).meta({ aliases: [...] })` registers aliases"
  - "alias collision at registration time throws CrustError DEFINITION"
  - "inherited flags with aliases don't collide with subcommand aliases"

---

## 7. Prior Task Packets (TP-008, TP-009, TP-010)

### Summary of Prior Art

**TP-008 — Rename `autoCompletePlugin` to `didYouMeanPlugin`** (DONE)
- **Change type**: Pure rename + deprecated alias
- **Files touched**: Renamed `autocomplete.ts` → `did-you-mean.ts`, updated exports, added deprecated aliases
- **Relevant pattern**: Shows how to add/change function names without breaking consumers

**TP-009 — Add `choices` to `FlagDef`/`ArgDef` and `hidden` to `CommandMeta`** (DONE)
- **Changes to `CommandMeta`**: Added `hidden?: boolean` field (lines 573–575 of types.ts)
- **Changes to `help.ts`**: Updated `formatCommandsSection()` to filter `subCommand.meta.hidden === true`
- **Pattern**: Optional additive field on metadata + metadata-driven filtering in help
- **Test coverage**: Type-level tests + regression tests for filtering behavior
- **Relevant quote from PROMPT**: "Purely additive optional fields on public types"

**Example from TP-009** (`packages/core/src/types.ts`):
```typescript
export interface CommandMeta {
	name: string;
	description?: string;
	usage?: string;
	hidden?: boolean;  // ← Added in TP-009
}
```

**Corresponding help filter** (`packages/plugins/src/help.ts`):
```typescript
for (const [name, subCommand] of Object.entries(command.subCommands)) {
	if (subCommand.meta.hidden === true) continue;  // ← Pattern
	// ... render
}
```

**TP-010 — Add `completionPlugin` for shell tab-completion** (NOT YET MERGED)
- **Scope**: Adds a new plugin that walks the `CommandNode` tree and emits bash/zsh/fish completion scripts
- **Relevant for aliases**: The walker will enumerate subcommands via `Object.keys(subCommands)`. If aliases are added first, the walker must include aliases in completion candidates.
- **Key section**: "Step 1: Walker + spec types" describes how the walker captures metadata (including `choices` from TP-009)

**Lesson from TP-010**: Pure-static completion walks the tree at `setup()` time or lazily at `run()` time. Alias support should be compatible with both patterns.

---

## 8. Collision/Duplicate Handling & Validation

### Files Retrieved
- `packages/core/src/crust.ts` (lines 579–696) — `.command()` duplicate check
- `packages/core/src/validation.ts` (lines 37–109) — `validateCommandTree()`
- `packages/core/src/parser.ts` (lines 240–280) — flag alias collision detection (reference)

### Current Duplicate Command Name Handling

**At registration time** (`packages/core/src/crust.ts`, line 616–617):
```typescript
if (this._node.subCommands[name]) {
	throw new CrustError(
		"DEFINITION",
		`Subcommand "${name}" is already registered`,
	);
}
```

**At validation time** (`packages/core/src/validation.ts`):
- `validateCommandTree()` does NOT check for duplicate subcommand names
- It only validates flags and args via `parseArgs()` and `validateParsed()`
- **Subcommand duplicate detection only happens at `.command()` call time**

### Flag Alias Collision Detection (Reference Model)

**Compile-time** (`packages/core/src/types.ts`, lines 199–282):
- `ValidateFlagAliases<F>` type checks that no flag alias shadows another flag name
- `ValidateCrossCollisions<I, F>` type checks that child flag aliases don't shadow inherited flags
- **Example error**: Trying to define a flag `out: { aliases: ["o"] }` when `o` is already a flag name results in a branded TypeScript error

**Runtime** (`packages/core/src/parser.ts`, lines 240–280):
- `validateAliasCollisions()` function checks the effective flags for collisions
- Called during `validateParsed()` for every command

**Pattern to follow for command aliases**:
1. **Compile-time**: Add TypeScript types that prevent alias→name and alias→alias collisions (lower priority; runtime checks are usually enough)
2. **Registration time**: Throw `CrustError` if an alias would shadow an existing subcommand name or another alias
3. **Validation time**: Call a check function during `validateCommandTree()` to catch cross-subcommand alias collisions

### Design Questions for Alias Collision Detection

1. **Alias vs. canonical name collision**: Can a subcommand named `deploy` have an alias `build` if another subcommand is named `build`?
   - **Current pattern** (flags): No. `ValidateFlagAliases` prevents this.
   - **Recommendation**: Same for commands. Alias must not shadow any other canonical name.

2. **Alias vs. parent command names**: Can a top-level command `deploy` have an alias `build` if `build` is the top-level command name?
   - **Answer**: Yes, they're in the same namespace (siblings). No collision possible.

3. **Alias inheritance**: Do aliases need to be inherited by subcommands?
   - **Current flag pattern**: Yes, flags with `inherit: true` are inherited. But commands are not flags—they're in a different namespace.
   - **Recommendation**: No alias inheritance. Each subcommand defines its own aliases scoped to its context.

4. **Hidden aliases**: Can an alias resolve to a `hidden: true` subcommand?
   - **Answer**: Yes. `hidden` only affects help output, not routing. Same for aliases.

---

## 9. Design Decisions Needed Before Implementation

### Open Questions

1. **Alias field name & cardinality**:
   - `alias?: string` — single alias only
   - `aliases?: string[]` — multiple aliases (mirrors flag pattern)
   - **Recommendation**: `aliases?: readonly string[]` (mirrors `FlagDef.aliases`)

2. **Where to define aliases**:
   - On `CommandMeta`? (mirrors `hidden` from TP-009)
   - Via a separate `.alias()` or `.aliases()` method on `Crust`? (mirrors `.flags()` and `.args()`)
   - **Recommendation**: On `CommandMeta` via `.meta()` method, since `hidden` is already there

3. **Alias scope**:
   - Subcommand-local only (aliases don't appear in parent's registry, only the canonical name does)
   - **Recommendation**: This is the only sensible option; aliases are convenience names for the canonical name

4. **Error messages & help output**:
   - When a user invokes `cli b` (alias for `build`), does the help output say "build" or "b"?
   - When `didYouMeanPlugin` suggests alternatives, should it prefer canonical names or list aliases too?
   - **Recommendation**: Always report the canonical name in error messages and help; list aliases parenthetically if space permits

5. **Validation timing**:
   - Check aliases at `.command()` registration time (eager, like duplicate names)?
   - Check during `validateCommandTree()` (lazy, like flag aliases)?
   - **Recommendation**: Eager check at registration + lazy check during validation (for plugins that add subcommands late)

6. **Backwards compatibility**:
   - Since `aliases` is optional, existing code requires no changes
   - `resolveCommand()` must still work with `CommandNode` objects created before aliases were added
   - **Recommendation**: All changes are backwards compatible; no breaking changes needed

---

## File Structure & Extension Points Summary

### Critical Extension Points (In Priority Order)

1. **Type definition** (`packages/core/src/types.ts`, line ~575):
   ```typescript
   export interface CommandMeta {
      name: string;
      description?: string;
      usage?: string;
      hidden?: boolean;          // ← From TP-009
      aliases?: readonly string[]; // ← NEW for alias support
   }
   ```

2. **Resolution logic** (`packages/core/src/router.ts`, lines 57–68):
   - Current: `if (candidate in subCommands && subCommands[candidate])`
   - New: Needs to check aliases and resolve to canonical name
   - Could build alias→name map at registration or resolution time

3. **Collision detection** (`packages/core/src/crust.ts`, lines 616–617):
   - Add check when `.command()` is called to reject aliases that shadow other names
   - Add check in `validateCommandTree()` to catch late-added aliases

4. **Help rendering** (`packages/plugins/src/help.ts`, lines 121–131):
   - Update `formatCommandsSection()` to display aliases inline or in separate section

5. **Did-you-mean suggestions** (`packages/plugins/src/did-you-mean.ts`, lines 73–120):
   - Include aliases in `details.available` when throwing `COMMAND_NOT_FOUND`
   - Clarify in suggestions whether the match was alias or canonical

6. **Man page rendering** (`packages/man/src/mdoc.ts`):
   - Similar to help: enumerate and display aliases

7. **Completion plugin** (TP-010, not yet merged):
   - Walker must include aliases when building `CompletionSpec`
   - Templates must emit aliases in completion candidates

### Files to Create/Modify

**Core package**:
- `packages/core/src/types.ts` — add `aliases?` to `CommandMeta`
- `packages/core/src/router.ts` — add alias resolution logic
- `packages/core/src/crust.ts` — add alias collision checks at `.command()` time
- `packages/core/src/validation.ts` — add alias collision checks in `validateCommandTree()`
- `packages/core/src/router.test.ts` — add alias resolution tests
- `packages/core/src/crust.test.ts` — add alias builder tests

**Plugins package**:
- `packages/plugins/src/help.ts` — update `formatCommandsSection()`
- `packages/plugins/src/did-you-mean.ts` — update `didYouMeanPlugin` to include aliases in `details.available`
- `packages/plugins/src/help.test.ts` or `plugins.test.ts` — add alias display tests
- `packages/plugins/src/did-you-mean.test.ts` — add alias suggestion tests

**Man package**:
- `packages/man/src/mdoc.ts` — update command enumeration to include aliases

**Documentation**:
- `apps/docs/content/docs/api/types.mdx` — document `aliases` field on `CommandMeta`
- `apps/docs/content/docs/guide/subcommands.mdx` — add example of defining aliases
- `packages/core/README.md` — update if it shows command examples

---

## Start Here

**First file to open**: `packages/core/src/types.ts` (line ~575)
- **Why**: Defines `CommandMeta` interface where `aliases` field will be added
- **Next steps**: 
  1. Review the full `CommandMeta` definition and how it's used in `CommandNode`
  2. Read `packages/core/src/router.ts` to understand the exact place where alias resolution must happen
  3. Design the alias-aware lookup algorithm (map-based vs. linear search)
  4. Check `packages/core/src/validation.ts` to understand how to add collision validation

**Second file**: `packages/core/src/router.ts` (lines 35–93)
- **Why**: The `resolveCommand()` function is where `candidate in subCommands` check happens
- **Next steps**: 
  1. Understand the current algorithm flow
  2. Design where to add alias→name mapping (at registration time or runtime)
  3. Plan how to track which alias was used (affects error messages)
  4. Write tests in `router.test.ts` before modifying the function

**Third file**: `packages/core/src/crust.ts` (lines 579–696)
- **Why**: `.command()` method is where duplicate checks happen; needs to validate aliases too
- **Next steps**:
  1. Add alias parameter to `.meta()` method or new method
  2. Add collision detection at registration time

**Fourth file**: `packages/plugins/src/help.ts` (lines 121–131)
- **Why**: Help rendering needs to show aliases alongside command names
- **Reference pattern**: TP-009's filtering of `hidden` subcommands shows the metadata-driven approach

---

## Key Code Locations (Quick Reference)

| **Concept** | **File** | **Lines** | **Function/Type** |
|---|---|---|---|
| Command metadata interface | `packages/core/src/types.ts` | 553–563 | `CommandMeta` |
| Command node structure | `packages/core/src/node.ts` | 11–48 | `CommandNode` |
| Subcommand registry | `packages/core/src/node.ts` | 21 | `subCommands: Record<string, CommandNode>` |
| Builder `.meta()` method | `packages/core/src/crust.ts` | 315–328 | `meta(meta: Omit<CommandMeta, "name">)` |
| Builder `.command()` method | `packages/core/src/crust.ts` | 540–696 | `command(name, cb)` and `command(builder)` overloads |
| Duplicate name check | `packages/core/src/crust.ts` | 616–617 | In `.command()` inline callback path |
| **Subcommand resolution** | `packages/core/src/router.ts` | 35–93 | `resolveCommand()` **← CRITICAL** |
| Exact match check | `packages/core/src/router.ts` | 67 | `if (candidate in subCommands && subCommands[candidate])` **← KEY LINE** |
| Error details (available names) | `packages/core/src/router.ts` | 84 | `const available = Object.keys(subCommands)` |
| Validation entry point | `packages/core/src/validation.ts` | 62–109 | `validateCommandTree()` |
| Help command section | `packages/plugins/src/help.ts` | 121–131 | `formatCommandsSection()` |
| Did-you-mean plugin | `packages/plugins/src/did-you-mean.ts` | 73–120 | `didYouMeanPlugin()` middleware |
| Suggestions with available names | `packages/plugins/src/did-you-mean.ts` | 82 | `findSuggestions(details.input, details.available)` |
| Router tests | `packages/core/src/router.test.ts` | 1–800+ | Comprehensive test suite |
| Builder tests (subcommands) | `packages/core/src/crust.test.ts` | 200–400 | Subcommand registration tests |
| Help tests | `packages/plugins/src/plugins.test.ts` | TBD | Help plugin tests |

---

## Risks & Constraints

1. **Plugin order sensitivity**: If a plugin adds subcommands with aliases during `setup()`, the alias lookup must work. Current pattern: lazy evaluation during resolution (should be fine).

2. **Backwards compatibility with `CommandNode` trees built before aliases existed**: Unmodified code will have undefined `meta.aliases`. Runtime checks must handle missing `aliases` field gracefully.

3. **Path tracking in error messages**: When an alias is used to resolve a subcommand, should `commandPath` in the error show the alias or the canonical name? Current pattern (flags) does not track aliases in resolved output. **Recommendation**: Track canonical name only; aliases are transparent to the parser and error output.

4. **Circular alias definitions**: Prevent `build: { aliases: ["deploy"] }` and `deploy: { aliases: ["build"] }` (mutually aliasing). **Solution**: Collision detection at registration time.

5. **Completion plugin compatibility**: TP-010 (not yet merged) will walk the tree. If aliases are added, the walker's `CompletionSpec` shape may need to include them. **Solution**: Defer detailed compatibility check until TP-010 surfaces its PR.

---

## Summary for Implementation Planning

| **Aspect** | **Current State** | **Required Changes** |
|---|---|---|
| **Type definition** | `CommandMeta` has `name`, `description`, `usage` | Add `aliases?: readonly string[]` |
| **Registration** | `.command(name, cb)` takes only `name` | Extend `.meta()` to accept `aliases` or add `.alias()` method |
| **Collision detection** | Duplicate `name` checked at `.command()` time | Add alias→name and alias→alias collision checks |
| **Resolution** | `candidate in subCommands` (exact match only) | Add fallback to alias→name lookup |
| **Error reporting** | `details.available` lists only canonical names | Include aliases in error details |
| **Help output** | Lists only canonical names | Display aliases inline or in separate section |
| **Did-you-mean** | Suggests based on canonical names only | Include aliases in suggestion candidates |
| **Tests** | Router and builder tests exist, no alias tests | Add comprehensive alias resolution and collision tests |

---

**Generated:** 2026-05-03  
**Scouted by:** Child agent in pi session
