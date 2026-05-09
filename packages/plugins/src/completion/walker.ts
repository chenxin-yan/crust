import type { ArgDef, CommandNode, FlagDef } from "@crustjs/core";
import type {
	CompletionArg,
	CompletionCommand,
	CompletionFlag,
	CompletionSpec,
} from "./spec.ts";

/**
 * Strip ANSI escape sequences (CSI + private-use SGR codes) from a string.
 *
 * Help-text descriptions can carry colour codes from `@crustjs/style` (e.g.
 * `dim(...)`, `cyan(...)`). The completion templates inline descriptions
 * verbatim into shell scripts; embedded `\x1b[...m` would corrupt the
 * generated output (and would render as garbage in the completion menu of
 * any terminal that did not interpret them).
 *
 * The pattern matches `ESC` followed by `[` (CSI) or `]` (OSC) plus any
 * intermediate parameter/intermediate bytes terminated by a final byte in
 * the conventional ranges. This is intentionally permissive: we strip more
 * than strictly SGR because users who reach for ANSI in a description
 * almost always mean "decoration", not "data".
 */
// Build the pattern via the `RegExp` constructor with a string assembled from
// `String.fromCharCode` so the source has no embedded control characters —
// Biome's `noControlCharactersInRegex` rule flags both regex literals and
// string literals that contain raw `\x1b`/`\x07`. Behaviour is identical to
// the equivalent regex literal.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ANSI_PATTERN = new RegExp(
	// CSI: ESC [ <params/intermediates> <final>
	// OSC: ESC ] ... (BEL | ESC \)
	// Two-byte simple sequences: ESC <0x40-0x5F>
	`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|[@-_])`,
	"g",
);

function stripAnsi(value: string): string {
	return value.replace(ANSI_PATTERN, "");
}

/**
 * Normalise an optional description: strip ANSI, then drop empty results.
 * Returning `undefined` (rather than `""`) makes templates' presence checks
 * easy and keeps generated scripts tidy.
 */
function normaliseDescription(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const stripped = stripAnsi(value).trim();
	return stripped.length === 0 ? undefined : stripped;
}

/**
 * Project a single `FlagDef` (keyed by `name` in `effectiveFlags`) onto a
 * `CompletionFlag`. The walker calls this for every entry of every visible
 * command's `effectiveFlags` map so inherited flags surface at the right
 * depth.
 */
function walkFlag(name: string, def: FlagDef): CompletionFlag {
	const aliases = def.aliases?.filter((alias) => alias.length > 0);

	const flag: CompletionFlag = {
		name,
		type: def.type,
		// Boolean flags are toggle-only; everything else takes a value.
		takesValue: def.type !== "boolean",
	};

	if (def.short !== undefined && def.short.length > 0) {
		flag.short = def.short;
	}
	if (aliases !== undefined && aliases.length > 0) {
		flag.aliases = aliases;
	}

	const description = normaliseDescription(def.description);
	if (description !== undefined) {
		flag.description = description;
	}

	if (def.multiple === true) {
		flag.multiple = true;
	}

	// `choices` lives only on string-typed flags (TP-009 — see `types.ts`).
	// We accept the field via discriminated narrowing rather than an `as`
	// cast to keep the reader honest about which branches actually carry it.
	if (def.type === "string") {
		const choices = def.choices;
		if (choices !== undefined && choices.length > 0) {
			flag.choices = choices;
		}
	}

	return flag;
}

/** Project a single `ArgDef` onto a `CompletionArg`. */
function walkArg(def: ArgDef): CompletionArg {
	const arg: CompletionArg = {
		name: def.name,
		type: def.type,
		required: def.required === true,
		variadic: def.variadic === true,
	};

	const description = normaliseDescription(def.description);
	if (description !== undefined) {
		arg.description = description;
	}

	// `choices` is only present on string-typed args (TP-009).
	if (def.type === "string") {
		const choices = def.choices;
		if (choices !== undefined && choices.length > 0) {
			arg.choices = choices;
		}
	}

	return arg;
}

/**
 * Recursively walk a `CommandNode`. Hidden subcommands are filtered out at
 * every level; the calling site (`walkCommandNode`) is responsible for
 * passing in a node that should itself be visible — the root is always
 * visible by construction.
 */
function walkCommand(node: CommandNode): CompletionCommand {
	const flags: CompletionFlag[] = [];
	for (const [flagName, flagDef] of Object.entries(node.effectiveFlags)) {
		flags.push(walkFlag(flagName, flagDef));
	}

	const args: CompletionArg[] = [];
	if (node.args !== undefined) {
		for (const argDef of node.args) {
			args.push(walkArg(argDef));
		}
	}

	const subCommands: CompletionCommand[] = [];
	for (const subNode of Object.values(node.subCommands)) {
		// Mirror the help renderer's contract: skip listing-hidden nodes.
		// Routing in `packages/core/src/router.ts` still resolves them by
		// direct name (TP-009) — they are only invisible to enumeration.
		if (subNode.meta.hidden === true) continue;
		subCommands.push(walkCommand(subNode));
	}

	const result: CompletionCommand = {
		name: node.meta.name,
		flags,
		args,
		subCommands,
	};

	const aliases = node.meta.aliases;
	if (aliases !== undefined && aliases.length > 0) {
		// `CommandMeta.aliases` is `readonly string[] | undefined`. Preserve
		// readonly-ness; template code only needs to enumerate.
		result.aliases = aliases;
	}

	const description = normaliseDescription(node.meta.description);
	if (description !== undefined) {
		result.description = description;
	}

	return result;
}

/**
 * Build a `CompletionSpec` from a root `CommandNode`.
 *
 * This is the single entry point used by the plugin's `run()` handler. It
 * walks lazily — never at `setup()` time — so plugin order is irrelevant
 * (other plugins may add subcommands or inject flags after this plugin
 * registers; we only see the final tree when the user actually invokes the
 * `completion` subcommand).
 */
export function walkCommandNode(root: CommandNode): CompletionSpec {
	return { root: walkCommand(root) };
}
