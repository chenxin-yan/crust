import type { CommandSnapshot, ExtensionId } from "@crustjs/core";
import {
	buildCommandDocumentation,
	formatDescription,
	sectionsFor,
	type CommandDocumentation,
	type UsageSegment,
} from "@crustjs/core/tooling";
import { bold, cyan, dim, green, padEnd, stringWidth, yellow } from "@crustjs/style";

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
		case "options":
			return cyan(segment.text);
		case "arg":
			return formatArgText(segment.text, segment.required);
	}
}

function formatSection(
	title: string,
	width: number,
	rows: readonly (readonly [label: string, description: string])[],
): string[] {
	if (rows.length === 0) return [];
	// A label wider than the column widens it, keeping two spaces before every description.
	const column = Math.max(width, ...rows.map(([label]) => stringWidth(label) + 1));
	return [
		bold(cyan(`${title}:`)),
		...rows.map(([label, description]) => `  ${padEnd(label, column)} ${description}`.trimEnd()),
	];
}

function formatCommandLabel(command: CommandDocumentation): string {
	const name = green(command.name);
	return command.aliases.length === 0 ? name : `${name} (${command.aliases.join(", ")})`;
}

export function renderHelpText(
	command: CommandSnapshot,
	path: readonly string[] | undefined,
	consumer: ExtensionId,
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
	const lines = [
		model.description ? `${bold(heading)} - ${dim(model.description)}` : bold(heading),
		"",
		bold(cyan("Usage:")),
		`  ${model.usageSegments.map(formatUsageSegment).join(" ")}`,
	];
	for (const section of [
		formatSection(
			"Commands",
			COMMAND_COLUMN_WIDTH,
			model.children.map((child) => [formatCommandLabel(child), child.description ?? ""] as const),
		),
		formatSection(
			"Arguments",
			ARG_COLUMN_WIDTH,
			model.args.map(
				(arg) =>
					[
						formatArgText(arg.token, arg.required),
						formatDescription(
							arg.description,
							arg.default,
							arg.choices,
							dim,
							undefined,
							arg.sensitive,
						),
					] as const,
			),
		),
		formatSection(
			"Options",
			FLAG_COLUMN_WIDTH,
			model.flags.map(
				(flag) =>
					[
						cyan(flag.spellings.join(", ") + (flag.type === "boolean" ? "" : ` <${flag.type}>`)),
						formatDescription(
							flag.description,
							flag.default,
							flag.choices,
							dim,
							flag.env?.name,
							flag.sensitive,
						),
					] as const,
			),
		),
	]) {
		if (section.length > 0) lines.push("", ...section);
	}
	for (const section of sectionsFor(model.sections, consumer)) {
		lines.push(
			"",
			bold(cyan(`${section.title}:`)),
			...section.body.split("\n").map((l) => `  ${l}`),
		);
	}
	return lines.join("\n");
}
