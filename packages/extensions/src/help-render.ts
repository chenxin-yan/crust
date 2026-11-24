import type { CommandSnapshot, ExtensionId } from "@crustjs/core";
import {
	buildCommandDocumentation,
	formatDescription,
	sectionsFor,
	type CommandDocumentation,
	type DocumentationFlag,
	type UsageSegment,
} from "@crustjs/core/tooling";
import { bold, cyan, dim, green, padEnd, stringWidth, style, yellow } from "@crustjs/style";

const FLAG_COLUMN_WIDTH = 28;
const ARG_COLUMN_WIDTH = 18;
const COMMAND_COLUMN_WIDTH = 10;

function formatArgText(text: string, required: boolean): string {
	return required ? yellow(text) : dim(yellow(text));
}

function formatUsageSegment(segment: UsageSegment): string {
	switch (segment.kind) {
		case "path":
		case "custom":
			return green(segment.text);
		case "command":
		case "exclusive":
		case "options":
			return cyan(segment.text);
		case "arg":
			return formatArgText(segment.text, segment.required);
	}
}

/** Break `text` at spaces into lines of at most `width` columns; a longer word keeps a line of its own. */
function wrap(text: string, width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(" ")) {
		if (line !== "" && stringWidth(line) + 1 + stringWidth(word) > width) {
			lines.push(line);
			line = word;
		} else {
			line = line === "" ? word : `${line} ${word}`;
		}
	}
	return [...lines, line];
}

/** Rows under one heading each; consecutive rows with the same heading share it. */
type Row = readonly [heading: string, label: string, description: string];

function formatRows(width: number, rows: readonly Row[], columns: number | undefined): string[][] {
	if (rows.length === 0) return [];
	// A label wider than the column widens it, keeping two spaces before every description.
	const column = Math.max(width, ...rows.map(([, label]) => stringWidth(label) + 1));
	const indent = " ".repeat(column + 3);
	const sections: string[][] = [];
	for (const [heading, label, description] of rows) {
		const title = bold(cyan(`${heading}:`));
		if (sections.at(-1)?.[0] !== title) sections.push([title]);
		const [first, ...rest] =
			columns === undefined
				? [description]
				: description
						.split("\n")
						.flatMap((line) => wrap(line, Math.max(columns - indent.length, 20)));
		sections
			.at(-1)!
			.push(`  ${padEnd(label, column)} ${first}`.trimEnd(), ...rest.map((line) => indent + line));
	}
	return sections;
}

function formatCommandLabel(command: CommandDocumentation): string {
	const name = green(command.name);
	return command.aliases.length === 0 ? name : `${name} (${command.aliases.join(", ")})`;
}

function formatFlagLabel(flag: DocumentationFlag): string {
	const value = flag.valueName === undefined ? "" : ` <${flag.valueName}>`;
	// clap marks a count flag as repeatable the same way.
	const repeats = flag.multiple || flag.type === "count" ? "..." : "";
	return cyan(flag.spellings.join(", ") + value + repeats);
}

function formatCommandDescription(command: CommandDocumentation): string {
	return formatDescription(
		command.description,
		undefined,
		undefined,
		dim,
		undefined,
		command.deprecated,
	);
}

export function renderHelpText(
	command: CommandSnapshot,
	path: readonly string[] | undefined,
	consumer: ExtensionId,
	columns: number | undefined,
): string {
	// Help lists children by static metadata only; reading anything else from a
	// child would build it, running its recipe.
	const model = buildCommandDocumentation(
		{
			...command,
			subCommands: Object.fromEntries(
				Object.entries(command.subCommands).map(([name, { meta }]) => [
					name,
					{
						meta: {
							name: meta.name,
							description: meta.description,
							aliases: meta.aliases,
							hidden: meta.hidden,
							deprecated: meta.deprecated,
						},
						hasAction: false,
						args: [],
						flags: {},
						subCommands: {},
					},
				]),
			),
		},
		path,
	);
	const heading = model.path.join(" ");
	const description = formatCommandDescription(model);
	const lines = [
		description ? `${bold(heading)} - ${dim(description)}` : bold(heading),
		"",
		bold(cyan("Usage:")),
		`  ${model.usageSegments.map(formatUsageSegment).join(" ")}`,
	];
	if (model.examples.length > 0) {
		lines.push("", bold(cyan("Examples:")), ...model.examples.map((example) => `  ${example}`));
	}
	if (model.aliases.length > 0) {
		lines.push("", bold(cyan("Aliases:")), `  ${model.aliases.join(", ")}`);
	}
	const ungrouped = model.children.some((child) => child.heading !== undefined)
		? "Additional commands"
		: "Commands";
	for (const section of [
		...formatRows(
			COMMAND_COLUMN_WIDTH,
			model.children.map(
				(child) =>
					[
						child.heading ?? ungrouped,
						formatCommandLabel(child),
						formatCommandDescription(child),
					] as const,
			),
			columns,
		),
		...formatRows(
			ARG_COLUMN_WIDTH,
			model.args.map(
				(arg) =>
					[
						"Arguments",
						formatArgText(arg.token, arg.required),
						formatDescription(arg.description, arg.default, arg.choices, dim),
					] as const,
			),
			columns,
		),
		...formatRows(
			FLAG_COLUMN_WIDTH,
			model.flags.map(
				(flag) =>
					[
						flag.inherited ? "Global options" : (flag.heading ?? "Options"),
						formatFlagLabel(flag),
						[
							formatDescription(
								flag.description,
								flag.default,
								flag.choices,
								dim,
								flag.env,
								flag.deprecated,
							),
							flag.required && dim("[required]"),
						]
							.filter(Boolean)
							.join(" "),
					] as const,
			),
			columns,
		),
	]) {
		lines.push("", ...section);
	}
	// A body styled when its module loaded keeps its colors; drop them once color is off (`--no-color`).
	const plain = !style.colorsEnabled;
	for (const section of sectionsFor(model.sections, consumer)) {
		const body = plain
			? process.getBuiltinModule("node:util").stripVTControlCharacters(section.body)
			: section.body;
		lines.push("", bold(cyan(`${section.title}:`)), ...body.split("\n").map((l) => `  ${l}`));
	}
	return lines.join("\n");
}
