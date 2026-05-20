/**
 * Internal data shape produced by the completion-plugin walker.
 *
 * The walker traverses the live `CommandNode` tree (built by the user's
 * `Crust` builder) and projects it down to a small, serialisable description
 * of every visible command, flag, and positional argument. Per-shell template
 * renderers (`bash.ts`, `zsh.ts`, `fish.ts`) consume this spec — they never
 * touch `CommandNode` directly. This decoupling keeps the templates pure
 * functions that are easy to snapshot-test.
 *
 * The spec intentionally **excludes** anything a generated shell script
 * cannot use:
 *
 * - Subcommands marked `meta.hidden === true` are dropped during the walk
 *   (the same listing contract the help renderer follows).
 * - Boolean flags surface with `takesValue: false` so templates know not to
 *   offer value candidates after them.
 * - Description strings have ANSI escape sequences stripped — completion
 *   scripts run in a wide variety of terminals (and inside `bash -n` /
 *   `zsh -n` / `fish -n` parsers) where embedded SGR codes are noise at
 *   best and a syntax hazard at worst.
 *
 * The shape is **internal to `@crustjs/plugins`**: it is not exported from
 * the package entrypoint and may change across patch releases.
 */

/** Description of a single named flag attached to a command. */
export interface CompletionFlag {
	/**
	 * The canonical long name with **no** leading dashes — the same key used
	 * in `CommandNode.effectiveFlags`. Templates prepend `--` when emitting.
	 */
	name: string;
	/**
	 * Single-character short alias with **no** leading dash, when present.
	 * Templates prepend `-` when emitting.
	 */
	short?: string;
	/**
	 * Additional long aliases with **no** leading dashes, when the flag
	 * definition declares any. Templates prepend `--` when emitting.
	 */
	aliases?: readonly string[];
	/** Underlying value type — discriminator from `FlagDef.type`. */
	type: "string" | "number" | "boolean";
	/** Human-readable description, ANSI-stripped, ready to embed verbatim. */
	description?: string;
	/**
	 * `true` when the flag consumes the next token as a value
	 * (`string`/`number` flags). `false` for boolean toggles, which never
	 * take a value (the parser supports `--no-flag` for negation).
	 */
	takesValue: boolean;
	/**
	 * `true` when the flag is repeatable (`multiple: true` in `FlagDef`).
	 * Templates use this to relax mutual-exclusion or de-dup logic where
	 * each shell supports it.
	 */
	multiple?: true;
	/**
	 * `true` when the boolean flag has explicitly opted out of `--no-`
	 * negation (mirrors `BooleanFlagDef.noNegate` in core). Only
	 * meaningful for `type: "boolean"` flags; absent on string/number.
	 * Templates use this to decide whether to emit the `--no-<name>`
	 * candidate alongside `--<name>`.
	 */
	noNegate?: true;
	/**
	 * Static enumeration of valid values, surfaced from TP-009's `choices`
	 * field on `StringFlagDef` / `StringMultiFlagDef`. When present,
	 * templates emit a fixed value list (`--flag=(a b c)` in zsh,
	 * `-x -a 'a b c'` in fish, etc.). Only string-typed flags can carry
	 * choices today; absent on number/boolean.
	 */
	choices?: readonly string[];
	/**
	 * Source-type hints for value completion. The spec-level `type` is
	 * normalised to `"string"` for `url`/`path`/`json` (their values are
	 * string tokens), so templates branch on these flags instead:
	 *  - `isPath`  → emit file-completion candidates.
	 *  - `isUrl`/`isJson` → suppress the string fallback's file completion.
	 */
	isPath?: true;
	isUrl?: true;
	isJson?: true;
}

/** Description of a single positional argument attached to a command. */
export interface CompletionArg {
	/** Argument name (used as the key in the parsed result and in help). */
	name: string;
	/** Underlying value type — discriminator from `ArgDef.type`. */
	type: "string" | "number" | "boolean";
	/** Human-readable description, ANSI-stripped. */
	description?: string;
	/** `true` when the argument is required (per `ArgDef.required`). */
	required: boolean;
	/**
	 * `true` when the argument collects all remaining positional values
	 * (per `ArgDef.variadic`). Templates use this to keep offering value
	 * candidates beyond the declared positional slot.
	 */
	variadic: boolean;
	/**
	 * Static enumeration of valid values, surfaced from TP-009's `choices`
	 * field on `StringArgDef`. Only string-typed args can carry choices.
	 */
	choices?: readonly string[];
	/** Source-type hints — see {@link CompletionFlag.isPath}. */
	isPath?: true;
	isUrl?: true;
	isJson?: true;
}

/** Description of a single command node — recursive via `subCommands`. */
export interface CompletionCommand {
	/**
	 * The canonical command name. The router records canonical names in
	 * `commandPath` regardless of which alias the user typed (TP-016), so
	 * the spec keeps the canonical name as the source of truth and exposes
	 * any alternative spellings via `aliases`.
	 */
	name: string;
	/**
	 * Additional sibling-level alternatives for `name`, surfaced from
	 * `CommandMeta.aliases` (TP-016). When present, templates emit alias
	 * spellings as completion candidates that resolve to the same node, so
	 * users can tab-complete any alias.
	 */
	aliases?: readonly string[];
	/** Human-readable description, ANSI-stripped. */
	description?: string;
	/**
	 * Flags visible on this command. Walker captures `effectiveFlags` (not
	 * `localFlags`), so inherited flags appear at every depth — matching
	 * what the parser actually accepts at this level.
	 */
	flags: readonly CompletionFlag[];
	/** Positional arguments declared on this command. */
	args: readonly CompletionArg[];
	/**
	 * Visible subcommands. Nodes whose `meta.hidden === true` are omitted
	 * here (recursively); routing still resolves them by direct name, but
	 * shell completion never offers them as candidates.
	 */
	subCommands: readonly CompletionCommand[];
}

/**
 * The full spec produced for a single CLI tree.
 *
 * Per-shell template renderers receive this plus `(binName, version)` and
 * emit a self-contained completion script.
 */
export interface CompletionSpec {
	/** The root command (`rootCommand` from the plugin context). */
	root: CompletionCommand;
}
