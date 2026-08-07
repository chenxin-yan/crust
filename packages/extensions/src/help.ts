import { type CommandSnapshot, type Extension, defineExtension } from "@crustjs/core";
import {
	buildCommandDocumentation,
	type CommandDocumentation,
	type DocumentationArg,
	type DocumentationFlag,
} from "@crustjs/core/tooling";
import { bold, cyan, dim, green, padEnd, yellow } from "@crustjs/style";

const FLAG_COLUMN_WIDTH = 28;
const ARG_COLUMN_WIDTH = 18;
const COMMAND_COLUMN_WIDTH = 10;

function formatArgToken(arg: DocumentationArg): string {
	return arg.required ? yellow(arg.token) : dim(yellow(arg.token));
}

function formatDescription(
	description: string | undefined,
	defaultValue: unknown,
	choices: readonly string[] | undefined,
): string {
	const parts = description ? [description] : [];
	if (defaultValue !== undefined) {
		const value =
			typeof defaultValue === "number" && !Number.isFinite(defaultValue)
				? String(defaultValue)
				: Array.isArray(defaultValue)
					? defaultValue.map(String).join(", ")
					: JSON.stringify(defaultValue);
		parts.push(dim(`[default: ${value}]`));
	}
	if (choices?.length) parts.push(dim(`[choices: ${choices.join(", ")}]`));
	return parts.join(" ");
}

function formatFlagsSection(flags: readonly DocumentationFlag[]): string[] {
	if (flags.length === 0) return [];
	const lines = [bold(cyan("Options:"))];
	for (const flag of flags) {
		const rendered = `${padEnd(cyan(flag.spellings.join(", ")), FLAG_COLUMN_WIDTH, " ")} `;
		lines.push(
			`  ${rendered}${formatDescription(flag.description, flag.default, flag.choices)}`.trimEnd(),
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
			`  ${rendered}${formatDescription(arg.description, arg.default, arg.choices)}`.trimEnd(),
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
		`  ${green(model.usage)}`,
	];
	for (const section of [
		formatCommandsSection(model),
		formatArgsSection(model),
		formatFlagsSection(model.flags),
	]) {
		if (section.length > 0) lines.push("", ...section);
	}
	return lines.join("\n");
}

export function helpExtension(): Extension {
	return defineExtension("help", {
		flags: { help: { type: "boolean", short: "h", noNegate: true, description: "Show help" } },
		hooks: {
			preRun(context) {
				if (context.flags.help !== true && context.command.hasHandler) return;
				context.stdout(renderHelp(context.command, context.commandPath));
				return context.finish();
			},
		},
	});
}
