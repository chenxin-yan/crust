import { isListed } from "../sections.ts";
import type { CommandSection, DeclaredDefault, FlagEnv, VariadicMode } from "../types.ts";
import type { ArgSnapshot, CommandSnapshot, FlagSnapshot } from "./snapshot.ts";

function isNonFiniteNumber(value: DeclaredDefault): value is number {
	return typeof value === "number" && !Number.isFinite(value);
}

/** Format a declared default value for command documentation. */
export function formatDefault(value: DeclaredDefault): string {
	if (isNonFiniteNumber(value)) return String(value);
	if (Array.isArray(value)) return value.map(String).join(", ");
	return JSON.stringify(value) ?? String(value);
}

/**
 * Format a definition's description and optional deprecation/env/default/choice annotations.
 * `env` is the variable *names* only, joined with commas; renderers never see their values.
 */
export function formatDescription(
	description: string | undefined,
	defaultValue: DeclaredDefault,
	choices: readonly string[] | undefined,
	formatAnnotation: (annotation: string) => string = (annotation) => annotation,
	env?: FlagEnv,
	deprecated?: string,
): string {
	const parts = description ? [description] : [];
	if (deprecated !== undefined) parts.push(formatAnnotation(`[deprecated: ${deprecated}]`));
	if (env !== undefined) parts.push(formatAnnotation(`[env: ${[env].flat().join(", ")}]`));
	// An empty list is no value to show.
	if (defaultValue !== undefined && !(Array.isArray(defaultValue) && defaultValue.length === 0)) {
		parts.push(formatAnnotation(`[default: ${formatDefault(defaultValue)}]`));
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
	 * A `variadic: "afterDoubleDash"` argument reads `-- <name>...`, wrapped in
	 * `[…]` when optional — e.g. `"[-- <extra>...]"`.
	 */
	readonly token: string;
	/** Value type (`"string"`, `"number"`, …); `undefined` for schema-backed args. */
	readonly type?: ArgSnapshot["type"];
	/** Human-readable description from the arg definition. */
	readonly description?: string;
	/** `true` when parsing fails if the argument is missing. */
	readonly required: boolean;
	/** How the argument collects its values into an array (see `ArgDef`'s `variadic`); `false` for one value. */
	readonly variadic: VariadicMode | false;
	/** Accepted values, e.g. `["json", "text"]`: declared `choices`, or its schema's string `enum`. */
	readonly choices?: readonly string[];
	/** Default value used when the argument is omitted, e.g. `3000`: declared, or its schema's. */
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
	 * The CLI spellings to document, with dashes, ordered short, one-dash forms of
	 * one-character names and aliases, canonical, aliases, then negations —
	 * e.g. `["-v", "-V", "--verbose", "--V", "--no-verbose", "--no-V"]`. Negations
	 * are listed only for a flag with `default: true`; `negatable: true` alone
	 * accepts them without listing them.
	 */
	readonly spellings: readonly string[];
	/** Single-character short alias without the dash, e.g. `"v"` for `-v`. */
	readonly short?: string;
	/** Additional long aliases without dashes, e.g. `["out"]` for `--out`. */
	readonly aliases: readonly string[];
	/** `true` for boolean flags that also accept `--no-<name>`: `default: true` or `negatable: true`. */
	readonly negatable: boolean;
	/** Value type, e.g. `"boolean"`, `"string"`, `"count"`; never `"exclusive"`, whose members are listed instead. */
	readonly type: Exclude<FlagSnapshot["type"], "exclusive">;
	/** Human-readable description from the flag definition. */
	readonly description?: string;
	/** `true` when parsing fails if the flag is not provided. */
	readonly required: boolean;
	/** `true` when the flag can repeat and collects values into an array. */
	readonly multiple: boolean;
	/**
	 * The value's name to document, `"bytes"` in `--memory <bytes>`: the flag's `valueName`,
	 * else its type; absent for a flag that takes no value (`boolean`, `count`).
	 */
	readonly valueName?: string;
	/** Accepted values, e.g. `["debug", "info", "error"]`: declared `choices`, or its schema's string `enum`. */
	readonly choices?: readonly string[];
	/** Default value used when the flag is omitted, e.g. `false`: declared, or its schema's. */
	readonly default?: unknown;
	/** Declared environment variable names; never their values. */
	readonly env?: FlagSnapshot["env"];
	/** Delimiter that splits a repeatable flag's string argv values and environment text into occurrences. */
	readonly delimiter?: string;
	/** Why the flag is deprecated, and what to use instead. */
	readonly deprecated?: string;
	/** The exclusive group (`type: "exclusive"`) this flag is a member of, by the group's name. */
	readonly group?: string;
	/** The `.group()` title the flag is listed under; absent for an ungrouped flag. */
	readonly heading?: string;
	/** `true` for a Context-owned or Extension flag, which help lists under "Global options". */
	readonly inherited: boolean;
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
	| { readonly kind: "exclusive"; readonly text: string; readonly required: boolean }
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
	/** Why the command is deprecated, and what to use instead. */
	readonly deprecated?: string;
	/** The parent's `.group()` title this command is listed under; absent when ungrouped. */
	readonly heading?: string;
	/** Example command lines from `meta.examples`. */
	readonly examples: readonly string[];
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
	/**
	 * Effective flags (Context-owned + local) in listing order: the command's own ungrouped
	 * flags, then each `.group()` heading's flags in code order, then the inherited ones, which
	 * keep definition order: flags owned by Extension-provided Contexts first, then the command
	 * path's own Context-owned flags, then Extension flags. An exclusive group's members stand
	 * in its place, each with its `group`. Hidden flags are left out.
	 */
	readonly flags: readonly DocumentationFlag[];
	/** Unfiltered command-authored and Extension-contributed documentation sections. */
	readonly sections: readonly CommandSection[];
	/**
	 * Visible children only, in listing order: each `.group()` heading's commands in code
	 * order, then the ungrouped ones. Hidden commands remain invocable but are not documentation.
	 */
	readonly children: readonly CommandDocumentation[];
}

function argToken(arg: ArgSnapshot): string {
	// clap's `Arg::last` usage spelling: `[-- <ARG>...]`.
	if (arg.variadic === "afterDoubleDash") {
		const token = `-- <${arg.name}>...`;
		return arg.required ? token : `[${token}]`;
	}
	const name = arg.variadic ? `${arg.name}...` : arg.name;
	return arg.required ? `<${name}>` : `[${name}]`;
}

/** A schema-backed definition's string `enum`, of each item for a list. */
function schemaChoices(def: ArgSnapshot | FlagSnapshot): readonly string[] | undefined {
	const list = "negatable" in def ? def.multiple : def.variadic;
	const value: unknown = list ? def.inputSchema?.items : def.inputSchema;
	if (typeof value !== "object" || value === null || !("enum" in value)) return undefined;
	const { enum: values } = value;
	return Array.isArray(values) && values.every((entry) => typeof entry === "string")
		? Object.freeze([...values])
		: undefined;
}

/** `.group()` titles by member name, and the titles in code order of first use. */
function groupTitles(
	command: CommandSnapshot,
	kind: "commands" | "flags",
): {
	readonly headingOf: (name: string) => string | undefined;
	readonly rank: (heading: string) => number;
} {
	const titles = new Map<string, string>();
	for (const group of command.groups ?? []) {
		const names =
			kind === "commands" ? "commands" in group && group.commands : "flags" in group && group.flags;
		for (const name of names || []) titles.set(name, group.title);
	}
	const order = [...new Set(titles.values())];
	return { headingOf: (name) => titles.get(name), rank: (heading) => order.indexOf(heading) };
}

function documentationFlags(
	flags: CommandSnapshot["flags"],
	headingOf: (name: string) => string | undefined,
	group?: { readonly name: string; readonly inherited: boolean },
): readonly DocumentationFlag[] {
	return Object.entries(flags).flatMap(([name, def]): DocumentationFlag[] => {
		if (def.hidden === true) return [];
		if (def.type === "exclusive") {
			const heading = headingOf(name);
			return [
				...documentationFlags(def.flags ?? {}, () => heading, {
					name,
					inherited: def.inherited === true,
				}),
			];
		}
		const long = [name, ...(def.aliases ?? [])];
		const flag: DocumentationFlag = Object.freeze({
			name,
			spellings: Object.freeze([
				...(def.short ? [`-${def.short}`] : []),
				...long.flatMap((spelling) => (spelling.length === 1 ? [`-${spelling}`] : [])),
				...long.map((spelling) => `--${spelling}`),
				...(def.negatable && def.default === true
					? long.map((spelling) => `--no-${spelling}`)
					: []),
			]),
			short: def.short,
			aliases: Object.freeze([...(def.aliases ?? [])]),
			negatable: def.negatable,
			type: def.type,
			description: def.description,
			required: def.required === true,
			multiple: def.multiple === true,
			valueName:
				def.type === "boolean" || def.type === "count" ? undefined : (def.valueName ?? def.type),
			choices: def.choices ?? schemaChoices(def),
			default: def.default ?? def.inputSchema?.default,
			env: def.env,
			delimiter: def.delimiter,
			deprecated: def.deprecated,
			group: group?.name,
			heading: headingOf(name),
			inherited: group?.inherited ?? def.inherited === true,
		});
		return [flag];
	});
}

/** Each exclusive group's usage token, `(--org-id <string> | --all)`, or `[…]` when optional. */
function exclusiveSegments(
	flags: CommandSnapshot["flags"],
	documented: readonly DocumentationFlag[],
): UsageSegment[] {
	return Object.entries(flags).flatMap(([name, def]): UsageSegment[] => {
		const members = documented.filter((flag) => flag.group === name);
		if (members.length === 0) return [];
		const text = members
			.map(({ name: member, valueName }) =>
				valueName === undefined ? `--${member}` : `--${member} <${valueName}>`,
			)
			.join(" | ");
		const required = def.required === true;
		return [{ kind: "exclusive", text: required ? `(${text})` : `[${text}]`, required }];
	});
}

/** Build the presentation-neutral documentation model for a full command tree. */
export function buildCommandDocumentation(
	command: CommandSnapshot,
	path: readonly string[] = [command.meta.name],
): CommandDocumentation {
	return documentCommand(command, path, undefined);
}

function documentCommand(
	command: CommandSnapshot,
	path: readonly string[],
	heading: string | undefined,
): CommandDocumentation {
	const args = command.args.map((arg) =>
		Object.freeze({
			...arg,
			token: argToken(arg),
			required: arg.required === true,
			variadic: arg.variadic ?? false,
			choices: arg.choices ?? schemaChoices(arg),
			default: arg.default ?? arg.inputSchema?.default,
		}),
	);
	// Options cannot follow `--`, nor any positional of a command with a passthrough argument,
	// so `[options]` goes before them.
	const lastVariadic = args.at(-1)?.variadic;
	const afterOptions =
		lastVariadic === "passthrough"
			? args
			: lastVariadic === "afterDoubleDash"
				? args.slice(-1)
				: [];
	const beforeOptions = args.slice(0, args.length - afterOptions.length);
	const argSegments = (list: typeof args) =>
		list.map((arg) => ({ kind: "arg", text: arg.token, required: arg.required }) as const);
	const commandGroups = groupTitles(command, "commands");
	const childRank = (child: CommandDocumentation) =>
		child.heading === undefined ? Infinity : commandGroups.rank(child.heading);
	// `sort` is stable, and ungrouped entries compare equal (`Infinity - Infinity` is NaN, read as 0).
	const children = Object.entries(command.subCommands)
		.flatMap(([name, child]) =>
			isListed(child)
				? [documentCommand(child, [...path, name], commandGroups.headingOf(name))]
				: [],
		)
		.sort((a, b) => childRank(a) - childRank(b));
	const flagGroups = groupTitles(command, "flags");
	const flagRank = (flag: DocumentationFlag) =>
		flag.inherited ? Infinity : flag.heading === undefined ? -1 : flagGroups.rank(flag.heading);
	const flags = [...documentationFlags(command.flags, flagGroups.headingOf)].sort(
		(a, b) => flagRank(a) - flagRank(b),
	);
	const usageSegments: UsageSegment[] = command.meta.usage
		? [{ kind: "custom", text: command.meta.usage }]
		: [
				{ kind: "path", text: path.join(" ") },
				...(children.length > 0 && !command.hasAction
					? [{ kind: "command", text: "<command>" } as const]
					: []),
				...argSegments(beforeOptions),
				...exclusiveSegments(command.flags, flags),
				...(flags.some((flag) => flag.group === undefined)
					? [{ kind: "options", text: "[options]" } as const]
					: []),
				...argSegments(afterOptions),
			];
	const usage = usageSegments.map((segment) => segment.text).join(" ");

	return Object.freeze({
		name: command.meta.name,
		path: Object.freeze([...path]),
		description: command.meta.description,
		aliases: Object.freeze([...(command.meta.aliases ?? [])]),
		deprecated: command.meta.deprecated,
		heading,
		examples: Object.freeze([...(command.meta.examples ?? [])]),
		usage,
		usageSegments: Object.freeze(usageSegments.map((segment) => Object.freeze(segment))),
		hasAction: command.hasAction,
		args: Object.freeze(args),
		flags: Object.freeze(flags),
		sections: Object.freeze([...(command.meta.sections ?? [])]),
		children: Object.freeze(children),
	});
}
