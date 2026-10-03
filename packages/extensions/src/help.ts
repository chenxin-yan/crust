import {
	type CommandSnapshot,
	type ExtensionFactory,
	type ExtensionId,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import {
	buildCommandDocumentation,
	formatDescription,
	sectionsFor,
	type CommandDocumentation,
	type UsageSegment,
} from "@crustjs/core/tooling";
import { bold, cyan, dim, green, padEnd, yellow } from "@crustjs/style";

const FLAG_COLUMN_WIDTH = 28;
const ARG_COLUMN_WIDTH = 18;
const COMMAND_COLUMN_WIDTH = 10;

const HELP: ExtensionId = defineExtensionId("crust:help");

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
	return [
		bold(cyan(`${title}:`)),
		...rows.map(([label, description]) => `  ${padEnd(label, width)} ${description}`.trimEnd()),
	];
}

function formatCommandLabel(command: CommandDocumentation): string {
	const name = green(command.name);
	return command.aliases.length === 0 ? name : `${name} (${command.aliases.join(", ")})`;
}

export function renderHelp(command: CommandSnapshot, path?: readonly string[]): string {
	const model = buildCommandDocumentation(command, path);
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
						formatDescription(arg.description, arg.default, arg.choices, dim),
					] as const,
			),
		),
		formatSection(
			"Options",
			FLAG_COLUMN_WIDTH,
			model.flags.map(
				(flag) =>
					[
						cyan(flag.spellings.join(", ")),
						formatDescription(flag.description, flag.default, flag.choices, dim, flag.env?.name),
					] as const,
			),
		),
	]) {
		if (section.length > 0) lines.push("", ...section);
	}
	for (const section of sectionsFor(model.sections, HELP)) {
		lines.push(
			"",
			bold(cyan(`${section.title}:`)),
			...section.body.split("\n").map((l) => `  ${l}`),
		);
	}
	return lines.join("\n");
}

const helpFlags = [
	{ name: "help", type: "boolean", short: "h", noNegate: true, description: "Show help" },
] as const;

export const help: ExtensionFactory<[], {}, [], typeof helpFlags> = defineExtension(HELP).factory(
	(extension) =>
		extension.flags(...helpFlags).preRun((context) => {
			if (context.flags.help !== true && context.command.hasAction) return;
			context.stdout(renderHelp(context.command, context.commandPath));
			return context.handled();
		}),
);
