import type { ArgDef, CommandMeta, CommandNode, FlagDef, FlagsDef } from "@crustjs/core";

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

/** Escape a line so it is not interpreted as an mdoc directive. */
function escapeMdocBodyLine(line: string): string {
	if (line.startsWith(".")) {
		return `\\&${line}`;
	}
	return line;
}

function formatDefaultValue(value: unknown): string {
	if (typeof value === "number" && !Number.isFinite(value)) {
		return String(value);
	}
	if (Array.isArray(value)) return value.map(String).join(", ");
	return JSON.stringify(value);
}

function formatDefaultSuffix(value: unknown): string {
	return `[default: ${formatDefaultValue(value)}]`;
}

function formatDescription(description: string | undefined, defaultValue: unknown): string {
	if (defaultValue === undefined) {
		return description ?? "";
	}
	const suffix = formatDefaultSuffix(defaultValue);
	if (!description) return suffix;
	return `${description} ${suffix}`;
}

function formatArgToken(arg: ArgDef): string {
	const base = arg.variadic ? `${arg.name}...` : arg.name;
	return arg.required ? `<${base}>` : `[${base}]`;
}

function formatUsagePlain(meta: CommandMeta, command: CommandNode, path: string[]): string {
	if (meta.usage) return meta.usage;

	const parts: string[] = [path.join(" ")];

	if (Object.keys(command.subCommands).length > 0 && !command.run) {
		parts.push("<command>");
	}

	if (command.args) {
		for (const arg of command.args) {
			parts.push(formatArgToken(arg));
		}
	}

	if (Object.keys(command.effectiveFlags).length > 0) {
		parts.push("[options]");
	}

	return parts.join(" ");
}

/**
 * Render the labels for a single flag definition for the `OPTIONS`
 * tagged-list. The output is a comma-joined sequence of spellings:
 *
 *   `-o, --output, --out, --no-output, --no-out`
 *
 * Order: short flag first (when present), canonical long form, every
 * declared long alias (`def.aliases`), then — for boolean flags that
 * have not opted out of negation — the `--no-<spelling>` forms in the
 * same order. Long aliases are surfaced so the man page documents the
 * complete callable surface of the flag; without them users only see
 * the canonical name and have no way to discover that `--out` is
 * equivalent.
 */
function formatFlagLabels(name: string, def: FlagDef): string {
	const longNames: string[] = [name];
	if (def.aliases) {
		for (const alias of def.aliases) longNames.push(alias);
	}
	const labels: string[] = [];
	if (def.short) labels.push(`-${def.short}`);
	for (const long of longNames) labels.push(`--${long}`);
	if (def.type === "boolean" && !def.noNegate) {
		for (const long of longNames) labels.push(`--no-${long}`);
	}
	return labels.join(", ");
}

/**
 * Render a trailing `[choices: a, b, c]` hint when the supplied list is
 * non-empty. Returns an empty string otherwise so the caller can
 * unconditionally concatenate.
 *
 * Takes the raw `choices` array directly rather than a `def` object —
 * `FlagDef` and `ArgDef` are discriminated unions whose number/boolean
 * variants do not carry `choices` at all, so a structural `{ choices? }`
 * parameter fails TS excess-property checks. Each caller already has
 * access to `def.choices` (typed as `readonly string[] | undefined`),
 * so passing it directly avoids the union narrowing.
 */
function formatChoicesSuffix(choices: readonly string[] | undefined): string {
	if (!choices || choices.length === 0) return "";
	return `[choices: ${choices.join(", ")}]`;
}

/**
 * Join a flag/arg description, its default-value suffix, and its
 * choices-suffix into a single mdoc body. Each piece is optional;
 * separators collapse so we never emit a stray double-space.
 */
function formatDescriptionWithChoices(
	description: string | undefined,
	defaultValue: unknown,
	choices: readonly string[] | undefined,
): string {
	const base = formatDescription(description, defaultValue);
	const suffix = formatChoicesSuffix(choices);
	if (!suffix) return base;
	if (!base) return suffix;
	return `${base} ${suffix}`;
}

function dtTitle(name: string): string {
	const upper = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
	return upper.replace(/^_|_$/g, "") || "COMMAND";
}

function ndOneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Single-line `.Nd` argument must not start with `.` (troff directive). */
function ndArgument(text: string): string {
	const line = ndOneLine(text);
	if (line.startsWith(".")) {
		return `\\&${line}`;
	}
	return line;
}

function longestFlagWidth(flags: FlagsDef): string {
	let max = 8;
	for (const [name, def] of Object.entries(flags)) {
		max = Math.max(max, formatFlagLabels(name, def).length);
	}
	return `${max}n`;
}

/**
 * Render the canonical subcommand name plus any aliases inline:
 *   `name`                       — no aliases
 *   `name (alias1, alias2)`      — one or more aliases
 *
 * Matches the inline format used by `helpPlugin.formatCommandsSection`.
 * Used for both the `.It Nm` line in SUBCOMMANDS and the column-width
 * calculation so alignment stays consistent.
 */
function formatSubcommandLabel(name: string, aliases: readonly string[] | undefined): string {
	if (!aliases || aliases.length === 0) return name;
	return `${name} (${aliases.join(", ")})`;
}

function longestSubcommandWidth(command: CommandNode): string {
	let max = 8;
	for (const [name, sub] of Object.entries(command.subCommands)) {
		// Hidden subcommands are not rendered (see SUBCOMMANDS loop) and
		// therefore must not influence the column width — a long hidden
		// internal command name would otherwise stretch the layout for
		// every visible peer.
		if (sub.meta.hidden === true) continue;
		const label = formatSubcommandLabel(name, sub.meta.aliases);
		max = Math.max(max, label.length);
	}
	return `${max}n`;
}

/**
 * `.Dd` date line: explicit string, else `SOURCE_DATE_EPOCH` (UTC, reproducible
 * builds), else local calendar date.
 */
function resolveDdLine(explicit?: string): string {
	if (explicit) return explicit;
	const epoch = process.env.SOURCE_DATE_EPOCH;
	if (epoch !== undefined) {
		const sec = Number.parseInt(epoch, 10);
		if (!Number.isNaN(sec) && sec >= 0) {
			const d = new Date(sec * 1000);
			return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
		}
	}
	const now = new Date();
	return `${MONTH_NAMES[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}

export interface RenderManPageMdocOptions {
	/** Frozen root command node (e.g. from `prepareCommandTree()`). */
	root: CommandNode;
	/** Name shown in `man <name>` / `.Nm` (often matches the binary). */
	name: string;
	/** Manual section; user commands use `1`. */
	section?: number;
	/**
	 * Override the `.Dd` date (e.g. `"April 1, 2026"`). If omitted, uses
	 * `SOURCE_DATE_EPOCH` when set, otherwise today.
	 */
	date?: string;
}

/**
 * Render an mdoc(7) manual page (section 1) for the root command tree.
 */
export function renderManPageMdoc(options: RenderManPageMdocOptions): string {
	const { root, name, section = 1, date } = options;
	const dd = resolveDdLine(date);

	const path = [root.meta.name];
	const usage = formatUsagePlain(root.meta, root, path);
	const description = root.meta.description?.trim() || "No description provided.";

	const lines: string[] = [
		`.Dd ${dd}`,
		`.Dt ${dtTitle(name)} ${section}`,
		".Os",
		".Sh NAME",
		`.Nm ${name}`,
		`.Nd ${ndArgument(description)}`,
		".Sh SYNOPSIS",
		".Bd -literal",
		usage,
		".Ed",
		".Sh DESCRIPTION",
	];

	for (const rawLine of description.split("\n")) {
		lines.push(escapeMdocBodyLine(rawLine));
	}

	// Filter subcommands marked `meta.hidden: true`. Hidden subcommands
	// remain invocable by direct name (the router does not consult
	// `meta.hidden`); they are excluded from generated documentation so
	// internal commands (e.g. `__complete`) do not surface in published
	// man pages. Matches the contract upheld by `helpPlugin` and
	// `completionPlugin`.
	const visibleSubEntries = Object.entries(root.subCommands).filter(
		([, sub]) => sub.meta.hidden !== true,
	);
	if (visibleSubEntries.length > 0) {
		lines.push(".Sh SUBCOMMANDS");
		lines.push(`.Bl -tag -width ${longestSubcommandWidth(root)}`);
		for (const [subName, sub] of visibleSubEntries.sort(([a], [b]) => a.localeCompare(b))) {
			// `.It Nm <name> (alias1, alias2)` keeps the canonical name marked up
			// as a name macro while letting aliases ride along as plain text.
			// Parens and commas are not mdoc macros, so no escaping is needed.
			// Reuse `formatSubcommandLabel` so the rendered label stays in sync
			// with the column-width calculation in `longestSubcommandWidth`.
			lines.push(`.It Nm ${formatSubcommandLabel(subName, sub.meta.aliases)}`);
			const desc = sub.meta.description?.trim() || "";
			if (desc) {
				lines.push(desc.split("\n").map(escapeMdocBodyLine).join("\n"));
			}
		}
		lines.push(".El");
	}

	const flagEntries = Object.entries(root.effectiveFlags).sort(([a], [b]) => a.localeCompare(b));
	if (flagEntries.length > 0) {
		lines.push(".Sh OPTIONS");
		lines.push(`.Bl -tag -width ${longestFlagWidth(root.effectiveFlags)}`);
		for (const [flagName, def] of flagEntries) {
			const labels = formatFlagLabels(flagName, def);
			lines.push(`.It Sy ${labels}`);
			// `choices` only exists on string-typed flag variants; number/
			// boolean flags narrow to `undefined` and `formatChoicesSuffix`
			// renders that as the empty string.
			const choices = def.type === "string" ? def.choices : undefined;
			const body = formatDescriptionWithChoices(def.description, def.default, choices).trim();
			if (body) {
				lines.push(body.split("\n").map(escapeMdocBodyLine).join("\n"));
			}
		}
		lines.push(".El");
	}

	if (root.args && root.args.length > 0) {
		lines.push(".Sh ARGUMENTS");
		lines.push(".Bl -tag -width 12n");
		for (const arg of root.args) {
			lines.push(`.It Ql ${formatArgToken(arg)}`);
			const choices = arg.type === "string" ? arg.choices : undefined;
			const body = formatDescriptionWithChoices(arg.description, arg.default, choices).trim();
			if (body) {
				lines.push(body.split("\n").map(escapeMdocBodyLine).join("\n"));
			}
		}
		lines.push(".El");
	}

	lines.push("");
	return lines.join("\n");
}
