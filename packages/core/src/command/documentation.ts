import type { DeclaredDefault } from "../types.ts";
import type { CommandSnapshot, FlagSnapshot } from "./snapshot.ts";

function isNonFiniteNumber(value: DeclaredDefault): value is number {
	return typeof value === "number" && !Number.isFinite(value);
}

/** Format a definition's description and optional default/choice annotations. */
export function formatDescription(
	description: string | undefined,
	defaultValue: DeclaredDefault,
	choices: readonly string[] | undefined,
	formatAnnotation: (annotation: string) => string = (annotation) => annotation,
): string {
	const parts = description ? [description] : [];
	if (defaultValue !== undefined) {
		const value = isNonFiniteNumber(defaultValue)
			? String(defaultValue)
			: Array.isArray(defaultValue)
				? defaultValue.map(String).join(", ")
				: JSON.stringify(defaultValue);
		parts.push(formatAnnotation(`[default: ${value}]`));
	}
	if (choices?.length) parts.push(formatAnnotation(`[choices: ${choices.join(", ")}]`));
	return parts.join(" ");
}

/**
 * Presentation-ready view of one positional argument.
 *
 * Same data as {@link ArgSnapshot} but normalized for renderers: booleans are
 * always present (never `undefined`) and the display token is pre-formatted.
 */
export interface DocumentationArg {
	/** Argument name as defined, e.g. `"file"`. */
	readonly name: string;
	/**
	 * Pre-formatted usage token: `<name>` if required, `[name]` if optional,
	 * with `...` appended when variadic — e.g. `"<file>"`, `"[files...]"`.
	 */
	readonly token: string;
	/** Value type (`"string"`, `"number"`, …); `undefined` for schema/raw args. */
	readonly type?: CommandSnapshot["args"][number]["type"];
	/** Human-readable description from the arg definition. */
	readonly description?: string;
	/** `true` when parsing fails if the argument is missing. */
	readonly required: boolean;
	/** `true` when the argument collects all remaining positionals into an array. */
	readonly variadic: boolean;
	/** Static enum of accepted values, e.g. `["json", "text"]`, if declared. */
	readonly choices?: readonly string[];
	/** Default value used when the argument is omitted, e.g. `3000`. */
	readonly default?: unknown;
}

/**
 * Presentation-ready view of one flag.
 *
 * @example
 * For `{ output: { type: "string", short: "o", aliases: ["out"] } }`:
 * ```ts
 * {
 *   name: "output",
 *   spellings: ["-o", "--output", "--out"],
 *   short: "o",
 *   aliases: ["out"],
 *   negatable: false,
 *   type: "string",
 *   required: false,
 *   multiple: false,
 * }
 * ```
 */
export interface DocumentationFlag {
	/** Canonical flag name (the key in the flags definition), e.g. `"output"`. */
	readonly name: string;
	/**
	 * All accepted CLI spellings with dashes, ordered short, canonical, aliases,
	 * then negations — e.g. `["-v", "--verbose", "--no-verbose"]`.
	 */
	readonly spellings: readonly string[];
	/** Single-character short alias without the dash, e.g. `"v"` for `-v`. */
	readonly short?: string;
	/** Additional long aliases without dashes, e.g. `["out"]` for `--out`. */
	readonly aliases: readonly string[];
	/** `true` for boolean flags that also accept `--no-<name>` (i.e. `noNegate` unset). */
	readonly negatable: boolean;
	/** Value type, e.g. `"boolean"`, `"string"`, `"number"`. */
	readonly type: FlagSnapshot["type"];
	/** Human-readable description from the flag definition. */
	readonly description?: string;
	/** `true` when parsing fails if the flag is not provided. */
	readonly required: boolean;
	/** `true` when the flag can repeat and collects values into an array. */
	readonly multiple: boolean;
	/** Static enum of accepted values, e.g. `["debug", "info", "error"]`, if declared. */
	readonly choices?: readonly string[];
	/** Default value used when the flag is omitted, e.g. `false`. */
	readonly default?: unknown;
}

/**
 * One renderer-colorable piece of a usage line. `custom` is the sole segment
 * when the author supplied `meta.usage`; generated usage lines are composed
 * of the other kinds so renderers can style parts without re-deriving the
 * assembly policy (when `<command>`/`[options]` appear, argument ordering).
 */
export type UsageSegment =
	| { readonly kind: "path"; readonly text: string }
	| { readonly kind: "command"; readonly text: "<command>" }
	| { readonly kind: "arg"; readonly text: string; readonly required: boolean }
	| { readonly kind: "options"; readonly text: "[options]" }
	| { readonly kind: "custom"; readonly text: string };

/**
 * Presentation-neutral documentation model for one command (and, via
 * `children`, its visible subtree). Renderers (help, man pages, …) consume
 * this instead of re-deriving usage/spelling policy from raw definitions.
 */
export interface CommandDocumentation {
	/** Canonical command name, e.g. `"add"`. */
	readonly name: string;
	/** Full invocation path from the root CLI, e.g. `["mycli", "remote", "add"]`. */
	readonly path: readonly string[];
	/** Human-readable description from `meta.description`. */
	readonly description?: string;
	/** Alternative names that route to this command, e.g. `["i"]` for `install`. */
	readonly aliases: readonly string[];
	/**
	 * Plain usage line: `usageSegments` texts joined with spaces —
	 * e.g. `"mycli remote add <name> [url] [options]"`.
	 */
	readonly usage: string;
	/** Structured pieces of `usage` so renderers can color parts individually. */
	readonly usageSegments: readonly UsageSegment[];
	/** `true` when the command has its own action (not just a subcommand container). */
	readonly hasAction: boolean;
	/** Positional arguments in declaration order. */
	readonly args: readonly DocumentationArg[];
	/** Effective flags (Context-owned + local), in definition order. */
	readonly flags: readonly DocumentationFlag[];
	/** Visible children only; hidden commands remain invocable but are not documentation. */
	readonly children: readonly CommandDocumentation[];
}

function argToken(arg: CommandSnapshot["args"][number]): string {
	const name = arg.variadic ? `${arg.name}...` : arg.name;
	return arg.required ? `<${name}>` : `[${name}]`;
}

function documentationFlags(flags: CommandSnapshot["flags"]): readonly DocumentationFlag[] {
	return Object.entries(flags).map(([name, def]) => {
		const long = [name, ...(def.aliases ?? [])];
		const negatable = def.type === "boolean" && def.noNegate !== true;
		return Object.freeze({
			name,
			spellings: Object.freeze([
				...(def.short ? [`-${def.short}`] : []),
				...long.map((spelling) => `--${spelling}`),
				...(negatable ? long.map((spelling) => `--no-${spelling}`) : []),
			]),
			short: def.short,
			aliases: Object.freeze([...(def.aliases ?? [])]),
			negatable,
			type: def.type,
			description: def.description,
			required: def.required === true,
			multiple: def.multiple === true,
			choices: def.choices,
			default: def.default,
		});
	});
}

function buildNode(command: CommandSnapshot, path: readonly string[]): CommandDocumentation {
	const args = command.args.map((arg) =>
		Object.freeze({
			...arg,
			token: argToken(arg),
			required: arg.required === true,
			variadic: arg.variadic === true,
		}),
	);
	const children = Object.entries(command.subCommands)
		.filter(([, child]) => child.meta.hidden !== true)
		.map(([name, child]) => buildNode(child, [...path, name]));
	const flags = documentationFlags(command.flags);
	const usageSegments: UsageSegment[] = command.meta.usage
		? [{ kind: "custom", text: command.meta.usage }]
		: [
				{ kind: "path", text: path.join(" ") },
				...(children.length > 0 && !command.hasAction
					? [{ kind: "command", text: "<command>" } as const]
					: []),
				...args.map((arg) => ({ kind: "arg", text: arg.token, required: arg.required }) as const),
				...(flags.length > 0 ? [{ kind: "options", text: "[options]" } as const] : []),
			];
	const usage = usageSegments.map((segment) => segment.text).join(" ");

	return Object.freeze({
		name: command.meta.name,
		path: Object.freeze([...path]),
		description: command.meta.description,
		aliases: Object.freeze([...(command.meta.aliases ?? [])]),
		usage,
		usageSegments: Object.freeze(usageSegments.map((segment) => Object.freeze(segment))),
		hasAction: command.hasAction,
		args: Object.freeze(args),
		flags: Object.freeze(flags),
		children: Object.freeze(children),
	});
}

/** Build the presentation-neutral documentation model for a full command tree. */
export function buildCommandDocumentation(
	command: CommandSnapshot,
	path: readonly string[] = [command.meta.name],
): CommandDocumentation {
	return buildNode(command, path);
}
