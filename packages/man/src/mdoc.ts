import type { CommandSnapshot } from "@crustjs/core";
import {
	buildCommandDocumentation,
	formatDescription,
	type CommandDocumentation,
	type DocumentationFlag,
} from "@crustjs/core/tooling";

function escapeMdocBodyLine(line: string): string {
	return line.startsWith(".") ? `\\&${line}` : line;
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
function flagMacros(flag: DocumentationFlag): string {
	return flag.spellings.map(flagMacro).join(" , ");
}
function longestFlagWidth(flags: readonly DocumentationFlag[]): string {
	let max = 8;
	for (const flag of flags) max = Math.max(max, flag.spellings.join(", ").length);
	return `${max}n`;
}
function commandLabel(command: CommandDocumentation): string {
	return command.aliases.length === 0
		? command.name
		: `${command.name} (${command.aliases.join(", ")})`;
}
function longestSubcommandWidth(command: CommandDocumentation): string {
	let max = 8;
	for (const child of command.children) max = Math.max(max, commandLabel(child).length);
	return `${max}n`;
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
	root: CommandSnapshot;
	name: string;
	section?: number;
	date?: string;
}

/** Render an mdoc(7) manual page for the root command. */
export function renderManPageMdoc(options: RenderManPageMdocOptions): string {
	const { root, name, section = 1, date } = options;
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
		model.usage,
		".Ed",
		".Sh DESCRIPTION",
	];
	for (const line of description.split("\n")) lines.push(escapeMdocBodyLine(line));

	// A man page intentionally summarizes only the root's immediate children;
	// the shared model still resolves the complete visible tree for other adapters.
	if (model.children.length > 0) {
		lines.push(".Sh SUBCOMMANDS", `.Bl -tag -width ${longestSubcommandWidth(model)}`);
		for (const child of [...model.children].sort((a, b) => a.name.localeCompare(b.name))) {
			lines.push(`.It Nm ${commandLabel(child)}`);
			if (child.description)
				lines.push(child.description.trim().split("\n").map(escapeMdocBodyLine).join("\n"));
		}
		lines.push(".El");
	}
	if (model.flags.length > 0) {
		lines.push(".Sh OPTIONS", `.Bl -tag -width ${longestFlagWidth(model.flags)}`);
		for (const flag of [...model.flags].sort((a, b) => a.name.localeCompare(b.name))) {
			lines.push(`.It ${flagMacros(flag)}`);
			const body = formatDescription(flag.description, flag.default, flag.choices);
			if (body) lines.push(body.split("\n").map(escapeMdocBodyLine).join("\n"));
		}
		lines.push(".El");
	}
	if (model.args.length > 0) {
		lines.push(".Sh ARGUMENTS", ".Bl -tag -width 12n");
		for (const arg of model.args) {
			lines.push(`.It Ar ${arg.name}${arg.variadic ? " ..." : ""}`);
			const body = formatDescription(arg.description, arg.default, arg.choices);
			if (body) lines.push(body.split("\n").map(escapeMdocBodyLine).join("\n"));
		}
		lines.push(".El");
	}
	lines.push("");
	return lines.join("\n");
}
