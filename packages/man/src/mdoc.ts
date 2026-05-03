import type {
	ArgDef,
	CommandMeta,
	CommandNode,
	FlagDef,
	FlagsDef,
} from "@crustjs/core";

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

function formatDescription(
	description: string | undefined,
	defaultValue: unknown,
): string {
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

function formatUsagePlain(
	meta: CommandMeta,
	command: CommandNode,
	path: string[],
): string {
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

function formatFlagLabels(name: string, def: FlagDef): string {
	const labels: string[] = [];
	if (def.short) labels.push(`-${def.short}`);
	labels.push(`--${name}`);
	if (def.type === "boolean" && !def.noNegate) {
		labels.push(`--no-${name}`);
	}
	return labels.join(", ");
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
function formatSubcommandLabel(
	name: string,
	aliases: readonly string[] | undefined,
): string {
	if (!aliases || aliases.length === 0) return name;
	return `${name} (${aliases.join(", ")})`;
}

function longestSubcommandWidth(command: CommandNode): string {
	let max = 8;
	for (const [name, sub] of Object.entries(command.subCommands)) {
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
	const description =
		root.meta.description?.trim() || "No description provided.";

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

	const subNames = Object.keys(root.subCommands);
	if (subNames.length > 0) {
		lines.push(".Sh SUBCOMMANDS");
		lines.push(`.Bl -tag -width ${longestSubcommandWidth(root)}`);
		for (const subName of subNames.sort()) {
			const sub = root.subCommands[subName];
			if (!sub) continue;
			// `.It Nm <name> (alias1, alias2)` keeps the canonical name marked up
			// as a name macro while letting aliases ride along as plain text.
			// Parens and commas are not mdoc macros, so no escaping is needed.
			const aliases = sub.meta.aliases;
			const aliasSuffix =
				aliases && aliases.length > 0 ? ` (${aliases.join(", ")})` : "";
			lines.push(`.It Nm ${subName}${aliasSuffix}`);
			const desc = sub.meta.description?.trim() || "";
			if (desc) {
				lines.push(desc.split("\n").map(escapeMdocBodyLine).join("\n"));
			}
		}
		lines.push(".El");
	}

	const flagEntries = Object.entries(root.effectiveFlags).sort(([a], [b]) =>
		a.localeCompare(b),
	);
	if (flagEntries.length > 0) {
		lines.push(".Sh OPTIONS");
		lines.push(`.Bl -tag -width ${longestFlagWidth(root.effectiveFlags)}`);
		for (const [flagName, def] of flagEntries) {
			const labels = formatFlagLabels(flagName, def);
			lines.push(`.It Sy ${labels}`);
			const body = formatDescription(def.description, def.default).trim();
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
			const body = formatDescription(arg.description, arg.default).trim();
			if (body) {
				lines.push(body.split("\n").map(escapeMdocBodyLine).join("\n"));
			}
		}
		lines.push(".El");
	}

	lines.push("");
	return lines.join("\n");
}
