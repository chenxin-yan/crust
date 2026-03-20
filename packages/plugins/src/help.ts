import type {
	ArgDef,
	CommandMeta,
	CommandNode,
	CrustPlugin,
	FlagDef,
	FlagsDef,
} from "@crustjs/core";
import { bold, cyan, dim, green, padEnd, yellow } from "@crustjs/style";

const FLAG_COLUMN_WIDTH = 26;
const ARG_COLUMN_WIDTH = 18;
const COMMAND_COLUMN_WIDTH = 10;

function formatArgToken(arg: ArgDef): string {
	const base = arg.variadic ? `${arg.name}...` : arg.name;
	const token = arg.required ? `<${base}>` : `[${base}]`;
	return arg.required ? yellow(token) : dim(yellow(token));
}

function formatDefaultValue(value: unknown): string {
	return JSON.stringify(value);
}

function formatDefaultSuffix(value: unknown): string {
	return dim(`[default: ${formatDefaultValue(value)}]`);
}

function formatDescription(
	description: string | undefined,
	defaultValue: unknown,
): string {
	if (defaultValue === undefined) {
		return description ?? "";
	}

	const defaultSuffix = formatDefaultSuffix(defaultValue);
	if (!description) {
		return defaultSuffix;
	}

	return `${description} ${defaultSuffix}`;
}

function formatUsage(
	meta: CommandMeta,
	command: CommandNode,
	path: string[],
): string {
	if (meta.usage) return meta.usage;

	const usageParts: string[] = [green(path.join(" "))];

	if (Object.keys(command.subCommands).length > 0 && !command.run) {
		usageParts.push(cyan("<command>"));
	}

	if (command.args) {
		for (const arg of command.args) {
			usageParts.push(formatArgToken(arg));
		}
	}

	if (Object.keys(command.effectiveFlags).length > 0) {
		usageParts.push(cyan("[options]"));
	}

	return usageParts.join(" ");
}

function formatFlagName(name: string, def: FlagDef): string {
	const labels: string[] = [];

	if (def.short) {
		labels.push(`-${def.short}`);
	}

	labels.push(`--${name}`);

	if (def.type === "boolean") {
		labels.push(`--no-${name}`);
	}

	return cyan(labels.join(", "));
}

function formatFlagsSection(flagsDef: FlagsDef): string[] {
	if (Object.keys(flagsDef).length === 0) return [];

	const lines = [bold(cyan("OPTIONS:"))];
	for (const [name, def] of Object.entries(flagsDef)) {
		const rendered = `${padEnd(formatFlagName(name, def), FLAG_COLUMN_WIDTH, " ")} `;
		lines.push(
			`  ${rendered}${formatDescription(def.description, def.default)}`.trimEnd(),
		);
	}

	return lines;
}

function formatArgsSection(command: CommandNode): string[] {
	if (!command.args || command.args.length === 0) return [];

	const lines = [bold(cyan("ARGS:"))];
	for (const arg of command.args as readonly ArgDef[]) {
		const rendered = `${padEnd(formatArgToken(arg), ARG_COLUMN_WIDTH, " ")} `;
		lines.push(
			`  ${rendered}${formatDescription(arg.description, arg.default)}`.trimEnd(),
		);
	}

	return lines;
}

function formatCommandsSection(command: CommandNode): string[] {
	if (Object.keys(command.subCommands).length === 0) {
		return [];
	}

	const lines = [bold(cyan("COMMANDS:"))];
	for (const [name, subCommand] of Object.entries(command.subCommands)) {
		const rendered = `${padEnd(green(name), COMMAND_COLUMN_WIDTH, " ")} `;
		lines.push(`  ${rendered}${subCommand.meta.description ?? ""}`.trimEnd());
	}

	return lines;
}

export function renderHelp(command: CommandNode, path?: string[]): string {
	const resolvedPath = path ?? [command.meta.name];
	const lines: string[] = [];
	lines.push(
		command.meta.description
			? `${bold(resolvedPath.join(" "))} - ${dim(command.meta.description)}`
			: bold(resolvedPath.join(" ")),
	);
	lines.push("");
	lines.push(bold(cyan("USAGE:")));
	lines.push(`  ${formatUsage(command.meta, command, resolvedPath)}`);

	const commandsSection = formatCommandsSection(command);
	if (commandsSection.length > 0) {
		lines.push("");
		lines.push(...commandsSection);
	}

	const argsSection = formatArgsSection(command);
	if (argsSection.length > 0) {
		lines.push("");
		lines.push(...argsSection);
	}

	const optionsSection = formatFlagsSection(command.effectiveFlags);
	if (optionsSection.length > 0) {
		lines.push("");
		lines.push(...optionsSection);
	}

	return lines.join("\n");
}

const helpFlagDef: FlagDef = {
	type: "boolean",
	short: "h",
	inherit: true,
	description: "Show help",
};

function injectHelpFlags(
	command: CommandNode,
	addFlag: (command: CommandNode, name: string, def: FlagDef) => void,
): void {
	addFlag(command, "help", helpFlagDef);

	for (const sub of Object.values(command.subCommands)) {
		injectHelpFlags(sub, addFlag);
	}
}

export function helpPlugin(): CrustPlugin {
	return {
		name: "help",
		setup(context, actions) {
			injectHelpFlags(context.rootCommand, actions.addFlag);
		},
		async middleware(context, next) {
			if (!context.route) {
				await next();
				return;
			}

			const routedCommand = context.route.command;
			const shouldShowHelp = context.input?.flags.help === true;

			if (!shouldShowHelp && routedCommand.run) {
				await next();
				return;
			}

			console.log(renderHelp(routedCommand, [...context.route.commandPath]));
		},
	};
}
