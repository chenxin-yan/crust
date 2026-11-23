import {
	buildCommandDocumentation,
	type CommandSnapshot,
	formatDescription,
	sectionsFor,
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
	 * Canonical command names below the root, naming the command whose page to render
	 * (`["remote", "add"]`). Hidden commands have no page.
	 *
	 * @default [] (the root's page)
	 */
	path?: readonly string[];
	/**
	 * Manual section.
	 *
	 * @default 1
	 */
	section?: number;
	/** Overrides `.Dd`; otherwise `SOURCE_DATE_EPOCH` (UTC), then today's local date. */
	date?: string;
}

/** A command's manual page name: its full path joined with `-`, as `git-commit` for `git commit`. */
export function manPageName(command: CommandDocumentation): string {
	return command.path.join("-");
}

/** Render the mdoc(7) manual page of one command: the root's, or the one at `path`. */
export function renderManPageMdoc(options: RenderManPageMdocOptions): string {
	const { root, path = [], section = 1, date } = options;
	let command = buildCommandDocumentation(root);
	let parent: CommandDocumentation | undefined;
	for (const name of path) {
		const child = command.children.find((candidate) => candidate.name === name);
		if (!child) {
			throw new Error(
				`No manual page for "${[...command.path, name].join(" ")}": no visible command has that path`,
			);
		}
		parent = command;
		command = child;
	}
	return renderCommandPage(command, parent, section, date);
}

/** Render the page of a documented command; `parent` is undefined for the root. */
export function renderCommandPage(
	command: CommandDocumentation,
	parent: CommandDocumentation | undefined,
	section: number,
	date?: string,
): string {
	const name = manPageName(command);
	const description = command.description?.trim() || "No description provided.";
	const lines = [
		`.Dd ${resolveDdLine(date)}`,
		`.Dt ${dtTitle(name)} ${section}`,
		".Os",
		".Sh NAME",
		`.Nm ${name}`,
		`.Nd ${ndArgument(description)}`,
		".Sh SYNOPSIS",
		".Bd -literal",
		...bodyLines(command.usage),
		".Ed",
		".Sh DESCRIPTION",
		...bodyLines(description),
	];

	// Each child has its own page; this one lists only the immediate children.
	if (command.children.length > 0) {
		lines.push(".Sh SUBCOMMANDS");
		const groups = byHeading(command.children);
		for (const [heading, children] of groups) {
			if (heading !== undefined || groups.size > 1)
				lines.push(`.Ss ${macroArgument(heading ?? "Additional commands")}`);
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
	if (command.flags.length > 0) {
		lines.push(".Sh OPTIONS");
		// Ungrouped flags, own and inherited, open the section without a heading.
		const flagGroups = new Map([[undefined, []], ...byHeading(command.flags)]);
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
	if (command.args.length > 0) {
		lines.push(".Sh ARGUMENTS", ".Bl -tag -width 12n");
		for (const arg of command.args) {
			const separator = arg.variadic === "afterDoubleDash" ? "Fl \\- " : "";
			lines.push(`.It ${separator}Ar ${arg.name}${arg.variadic ? " ..." : ""}`);
			const body = formatDescription(arg.description, arg.default, arg.choices);
			if (body) lines.push(...bodyLines(body));
		}
		lines.push(".El");
	}
	if (command.examples.length > 0) {
		lines.push(
			".Sh EXAMPLES",
			".Bd -literal -offset indent",
			...command.examples.flatMap(bodyLines),
			".Ed",
		);
	}
	for (const metadataSection of sectionsFor(command.sections, MAN)) {
		lines.push(`.Sh ${shTitle(metadataSection.title)}`);
		lines.push(...bodyLines(metadataSection.body));
	}
	const related = [...(parent ? [parent] : []), ...command.children];
	if (related.length > 0) {
		lines.push(
			".Sh SEE ALSO",
			...related.map(
				(page, index) =>
					`.Xr ${manPageName(page)} ${section}${index < related.length - 1 ? " ," : ""}`,
			),
		);
	}
	lines.push("");
	return lines.join("\n");
}
