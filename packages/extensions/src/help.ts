import {
	type CommandSnapshot,
	type Extension,
	type SectionConsumer,
	defineExtension,
	sectionsFor,
} from "@crustjs/core";
import {
	buildCommandDocumentation,
	formatDescription,
	type CommandDocumentation,
	type DocumentationArg,
	type DocumentationFlag,
	type UsageSegment,
} from "@crustjs/core/tooling";
import { bold, cyan, dim, green, padEnd, yellow } from "@crustjs/style";

const FLAG_COLUMN_WIDTH = 28;
const ARG_COLUMN_WIDTH = 18;
const COMMAND_COLUMN_WIDTH = 10;

export const HELP: SectionConsumer = "help";

function formatArgToken(arg: DocumentationArg): string {
	return arg.required ? yellow(arg.token) : dim(yellow(arg.token));
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
			return segment.required ? yellow(segment.text) : dim(yellow(segment.text));
	}
}

function formatFlagsSection(flags: readonly DocumentationFlag[]): string[] {
	if (flags.length === 0) return [];
	const lines = [bold(cyan("Options:"))];
	for (const flag of flags) {
		const rendered = `${padEnd(cyan(flag.spellings.join(", ")), FLAG_COLUMN_WIDTH, " ")} `;
		lines.push(
			`  ${rendered}${formatDescription(flag.description, flag.default, flag.choices, dim)}`.trimEnd(),
		);
	}
	return lines;
}

function formatArgsSection(command: CommandDocumentation): string[] {
	if (command.args.length === 0) return [];
	const lines = [bold(cyan("Arguments:"))];
	for (const arg of command.args) {
		const rendered = `${padEnd(formatArgToken(arg), ARG_COLUMN_WIDTH, " ")} `;
		lines.push(
			`  ${rendered}${formatDescription(arg.description, arg.default, arg.choices, dim)}`.trimEnd(),
		);
	}
	return lines;
}

function formatCommandLabel(command: CommandDocumentation): string {
	const name = green(command.name);
	return command.aliases.length === 0 ? name : `${name} (${command.aliases.join(", ")})`;
}

function formatCommandsSection(command: CommandDocumentation): string[] {
	if (command.children.length === 0) return [];
	const lines = [bold(cyan("Commands:"))];
	for (const child of command.children) {
		const rendered = `${padEnd(formatCommandLabel(child), COMMAND_COLUMN_WIDTH, " ")} `;
		lines.push(`  ${rendered}${child.description ?? ""}`.trimEnd());
	}
	return lines;
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
		formatCommandsSection(model),
		formatArgsSection(model),
		formatFlagsSection(model.flags),
	]) {
		if (section.length > 0) lines.push("", ...section);
	}
	for (const section of sectionsFor(command.meta.sections, HELP)) {
		lines.push(
			"",
			bold(cyan(`${section.title}:`)),
			...section.body.split("\n").map((l) => `  ${l}`),
		);
	}
	return lines.join("\n");
}

export function help(): Extension {
	return defineExtension("help", {
		flags: [
			{ name: "help", type: "boolean", short: "h", noNegate: true, description: "Show help" },
		],
		hooks: {
			preRun(context) {
				if (context.flags.help !== true && context.command.hasAction) return;
				context.stdout(renderHelp(context.command, context.commandPath));
				return context.finish();
			},
		},
	});
}
