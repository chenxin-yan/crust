/**
 * Internal data shape produced by the completion-extension walker.
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
 * The shape is **internal to `@crustjs/extensions`**: it is not exported from
 * the package entrypoint and may change across patch releases.
 */

/** Fields shared by every named flag attached to a command. */
interface CompletionFlagBase {
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
	/** Human-readable description, ANSI-stripped, ready to embed verbatim. */
	description?: string;
	/** `true` when the flag accepts generated `--no-<name>` spellings. */
	negatable?: boolean;
	/**
	 * `true` when the flag is repeatable (`multiple: true` in `FlagDef`).
	 * Templates use this to relax mutual-exclusion or de-dup logic where
	 * each shell supports it.
	 */
	multiple?: true;
}

type StringCompletion =
	| { choices: readonly string[]; valueCompletion?: never }
	| { choices?: never; valueCompletion: "files" | "none" }
	| { choices?: never; valueCompletion?: never };

/** Description of a single named flag attached to a command. */
export type CompletionFlag = CompletionFlagBase &
	(
		| {
				type: "boolean";
				takesValue: false;
				choices?: never;
				valueCompletion?: never;
		  }
		| {
				type: "number";
				takesValue: true;
				choices?: never;
				valueCompletion?: never;
		  }
		| ({ type: "string"; takesValue: true } & StringCompletion)
	);

/** Fields shared by every positional argument attached to a command. */
interface CompletionArgBase {
	/** Argument name (used as the key in the parsed result and in help). */
	name: string;
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
}

/** Description of a single positional argument attached to a command. */
export type CompletionArg = CompletionArgBase &
	(
		| {
				type: "number" | "boolean";
				choices?: never;
				valueCompletion?: never;
		  }
		| ({ type: "string" } & StringCompletion)
	);

/** Description of a single command node — recursive via `subCommands`. */
export interface CompletionCommand {
	/**
	 * The canonical command name. The router records canonical names in
	 * `commandPath` regardless of which alias the user typed, so
	 * the spec keeps the canonical name as the source of truth and exposes
	 * any alternative spellings via `aliases`.
	 */
	name: string;
	/**
	 * Additional sibling-level alternatives for `name`, surfaced from
	 * `CommandMeta.aliases`. When present, templates emit alias
	 * spellings as completion candidates that resolve to the same node, so
	 * users can tab-complete any alias.
	 */
	aliases?: readonly string[];
	/** Human-readable description, ANSI-stripped. */
	description?: string;
	/**
	 * Flags visible on this command. Walker captures `effectiveFlags` (not
	 * `localFlags`), so propagating flags appear at every depth — matching
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
