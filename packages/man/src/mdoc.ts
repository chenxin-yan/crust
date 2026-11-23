import {
	buildCommandDocumentation,
	type CommandSnapshot,
	formatDescription,
	sectionsFor,
	visibleSectionsFor,
	type CommandDocumentation,
	type DocumentationFlag,
} from "@crustjs/core/tooling";

import { MAN } from "./id.ts";

function escapeMdocBodyLine(line: string): string {
	// Plain text: backslashes would start roff escapes; `.` and `'` start control lines.
	const text = macroArgument(line);
	return /^[.']/.test(text) ? `\\&${text}` : text;
}
function bodyLines(text: string): string[] {
	return text.split("\n").map(escapeMdocBodyLine);
}
function byName(a: { readonly name: string }, b: { readonly name: string }): number {
	return a.name.localeCompare(b.name);
}
function macroArgument(text: string): string {
	// Backslashes would otherwise start roff escape sequences (`\e` prints a literal one).
	return text.replace(/\\/g, "\\e");
}
function shTitle(title: string): string {
	return macroArgument(title.toUpperCase());
}
function dtTitle(name: string): string {
	const upper = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
	return upper.replace(/^_|_$/g, "") || "COMMAND";
}
function ndArgument(text: string): string {
	return escapeMdocBodyLine(text.replace(/\s+/g, " ").trim());
}
function flagMacro(spelling: string): string {
	return spelling.startsWith("--") ? `Fl Fl ${spelling.slice(2)}` : `Fl ${spelling.slice(1)}`;
}
function repeats(flag: DocumentationFlag): string {
	return flag.multiple || flag.type === "count" ? " ..." : "";
}
function flagMacros(flag: DocumentationFlag): string {
	const value = flag.valueName === undefined ? "" : ` Ar ${macroArgument(flag.valueName)}`;
	return flag.spellings.map(flagMacro).join(" , ") + value + repeats(flag);
}
function flagLabel(flag: DocumentationFlag): string {
	const value = flag.valueName === undefined ? "" : ` ${flag.valueName}`;
	return flag.spellings.join(", ") + value + repeats(flag);
}
/** Entries by `.group()` heading, in first-seen order; ungrouped ones under `undefined`. */
function byHeading<T extends { readonly heading?: string }>(
	entries: readonly T[],
): Map<string | undefined, T[]> {
	const groups = new Map<string | undefined, T[]>();
	for (const entry of entries)
		groups.set(entry.heading, [...(groups.get(entry.heading) ?? []), entry]);
	return groups;
}
function commandLabel(command: CommandDocumentation): string {
	return command.aliases.length === 0
		? command.name
		: `${command.name} (${command.aliases.join(", ")})`;
}
function resolveDdLine(explicit?: string): string {
	if (explicit) return explicit;
	const sec = Number.parseInt(process.env.SOURCE_DATE_EPOCH ?? "", 10);
	const fromEpoch = !Number.isNaN(sec) && sec >= 0;
	return new Date(fromEpoch ? sec * 1000 : Date.now()).toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
		timeZone: fromEpoch ? "UTC" : undefined,
	});
}

export interface RenderManPageMdocOptions {
	/** Prepared, validated Command Snapshot for the CLI. */
	root: CommandSnapshot;
	/**
	 * Manual section.
	 *
	 * @default 1
	 */
	section?: number;
	/** Overrides `.Dd`; otherwise `SOURCE_DATE_EPOCH` (UTC), then today's local date. */
	date?: string;
}

/** Render an mdoc(7) manual page for the root command. */
export function renderManPageMdoc(options: RenderManPageMdocOptions): string {
	const { root, section = 1, date } = options;
	const { name } = root.meta;
	const model = buildCommandDocumentation(root);
	const description = model.description?.trim() || "No description provided.";
	const lines = [
		`.Dd ${resolveDdLine(date)}`,
		`.Dt ${dtTitle(name)} ${section}`,
		".Os",
		".Sh NAME",
		`.Nm ${name}`,
		`.Nd ${ndArgument(description)}`,
		".Sh SYNOPSIS",
		".Bd -literal",
		...bodyLines(model.usage),
		".Ed",
		".Sh DESCRIPTION",
		...bodyLines(description),
	];

	// A man page intentionally summarizes only the root's immediate children;
	// the shared model still resolves the complete visible tree for other adapters.
	if (model.children.length > 0) {
		lines.push(".Sh SUBCOMMANDS");
		const groups = byHeading(model.children);
		for (const [heading, children] of groups) {
			if (groups.size > 1) lines.push(`.Ss ${macroArgument(heading ?? "Additional commands")}`);
			lines.push(
				`.Bl -tag -width ${Math.max(8, ...children.map((child) => commandLabel(child).length))}n`,
			);
			for (const child of children.sort(byName)) {
				lines.push(`.It Nm ${commandLabel(child)}`);
				const body = formatDescription(
					child.description?.trim(),
					undefined,
					undefined,
					undefined,
					undefined,
					child.deprecated,
				);
				if (body) lines.push(...bodyLines(body));
			}
			lines.push(".El");
		}
	}
	if (model.flags.length > 0) {
		lines.push(".Sh OPTIONS");
		// Ungrouped flags, own and inherited, open the section without a heading.
		const flagGroups = new Map([[undefined, []], ...byHeading(model.flags)]);
		for (const [heading, flags] of flagGroups) {
			if (flags.length === 0) continue;
			if (heading !== undefined) lines.push(`.Ss ${macroArgument(heading)}`);
			lines.push(`.Bl -tag -width ${Math.max(8, ...flags.map((flag) => flagLabel(flag).length))}n`);
			for (const flag of flags.sort(byName)) {
				lines.push(`.It ${flagMacros(flag)}`);
				const body = formatDescription(
					flag.description,
					flag.default,
					flag.choices,
					undefined,
					flag.env,
					flag.deprecated,
				);
				if (body) lines.push(...bodyLines(body));
			}
			lines.push(".El");
		}
	}
	if (model.args.length > 0) {
		lines.push(".Sh ARGUMENTS", ".Bl -tag -width 12n");
		for (const arg of model.args) {
			const separator = arg.variadic === "afterDoubleDash" ? "Fl \\- " : "";
			lines.push(`.It ${separator}Ar ${arg.name}${arg.variadic ? " ..." : ""}`);
			const body = formatDescription(arg.description, arg.default, arg.choices);
			if (body) lines.push(...bodyLines(body));
		}
		lines.push(".El");
	}
	if (model.examples.length > 0) {
		lines.push(
			".Sh EXAMPLES",
			".Bd -literal -offset indent",
			...model.examples.flatMap(bodyLines),
			".Ed",
		);
	}
	for (const metadataSection of sectionsFor(model.sections, MAN)) {
		lines.push(`.Sh ${shTitle(metadataSection.title)}`);
		lines.push(...bodyLines(metadataSection.body));
	}
	const commandSections = visibleSectionsFor(root, MAN).filter(({ path }) => path.length > 0);
	if (commandSections.length > 0) {
		lines.push(".Sh COMMANDS");
		for (const group of commandSections) {
			lines.push(`.Ss ${macroArgument(group.path.join(" "))}`);
			group.sections.forEach((commandSection, index) => {
				// mandoc -Tlint warns on .Pp directly after .Ss; only separate consecutive sections.
				if (index > 0) lines.push(".Pp");
				lines.push(`.Sy ${shTitle(commandSection.title)}`);
				lines.push(...bodyLines(commandSection.body));
			});
		}
	}
	lines.push("");
	return lines.join("\n");
}
