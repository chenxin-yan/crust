import type {
	ArgDef,
	CommandMeta,
	CommandNode,
	CrustPlugin,
	FlagDef,
	FlagsDef,
} from "@crustjs/core";

/**
 * A structural type for objects that renderHelp can accept.
 * Both CommandNode and legacy shapes satisfy this interface.
 */
interface HelpableCommand {
	meta: CommandMeta;
	subCommands?: Record<string, HelpableCommand>;
	run?: (...args: unknown[]) => unknown;
	args?: readonly ArgDef[];
	flags?: FlagsDef;
	effectiveFlags?: FlagsDef;
	localFlags?: FlagsDef;
}

/** Resolve the flags to display in help — effectiveFlags takes precedence. */
function resolveHelpFlags(command: HelpableCommand): FlagsDef | undefined {
	if (
		command.effectiveFlags &&
		Object.keys(command.effectiveFlags).length > 0
	) {
		return command.effectiveFlags;
	}
	return command.flags;
}

function formatArgToken(arg: ArgDef): string {
	const base = arg.variadic ? `${arg.name}...` : arg.name;
	return arg.required ? `<${base}>` : `[${base}]`;
}

function formatUsage(
	meta: CommandMeta,
	command: HelpableCommand,
	path: string[],
): string {
	if (meta.usage) return meta.usage;

	const usageParts: string[] = [path.join(" ")];

	if (
		command.subCommands &&
		Object.keys(command.subCommands).length > 0 &&
		!command.run
	) {
		usageParts.push("<command>");
	}

	if (command.args) {
		for (const arg of command.args) {
			usageParts.push(formatArgToken(arg));
		}
	}

	const flags = resolveHelpFlags(command);
	if (flags && Object.keys(flags).length > 0) {
		usageParts.push("[options]");
	}

	return usageParts.join(" ");
}

function formatFlagName(name: string, def: FlagDef): string {
	if (!def.alias) return `--${name}`;

	const aliases = Array.isArray(def.alias) ? def.alias : [def.alias];
	const shortAlias = aliases.find((alias) => alias.length === 1);

	if (shortAlias) {
		return `-${shortAlias}, --${name}`;
	}

	return `--${name}`;
}

function formatFlagsSection(flagsDef: FlagsDef | undefined): string[] {
	if (!flagsDef || Object.keys(flagsDef).length === 0) return [];

	const lines = ["OPTIONS:"];
	for (const [name, def] of Object.entries(flagsDef)) {
		const rendered = formatFlagName(name, def).padEnd(18, " ");
		lines.push(`  ${rendered}${def.description ?? ""}`.trimEnd());
	}

	return lines;
}

function formatArgsSection(command: HelpableCommand): string[] {
	if (!command.args || command.args.length === 0) return [];

	const lines = ["ARGS:"];
	for (const arg of command.args) {
		const rendered = formatArgToken(arg).padEnd(18, " ");
		lines.push(`  ${rendered}${arg.description ?? ""}`.trimEnd());
	}

	return lines;
}

function formatCommandsSection(command: HelpableCommand): string[] {
	if (!command.subCommands || Object.keys(command.subCommands).length === 0) {
		return [];
	}

	const lines = ["COMMANDS:"];
	for (const [name, subCommand] of Object.entries(command.subCommands)) {
		const rendered = name.padEnd(10, " ");
		lines.push(`  ${rendered}${subCommand.meta.description ?? ""}`.trimEnd());
	}

	return lines;
}

export function renderHelp(command: HelpableCommand, path?: string[]): string {
	const resolvedPath = path ?? [command.meta.name];
	const lines: string[] = [];
	lines.push(
		command.meta.description
			? `${resolvedPath.join(" ")} - ${command.meta.description}`
			: resolvedPath.join(" "),
	);
	lines.push("");
	lines.push("USAGE:");
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

	const optionsSection = formatFlagsSection(resolveHelpFlags(command));
	if (optionsSection.length > 0) {
		lines.push("");
		lines.push(...optionsSection);
	}

	return lines.join("\n");
}

const helpFlagDef: FlagDef = {
	type: "boolean",
	alias: "h",
	description: "Show help",
};

function injectHelpFlags(
	command: CommandNode,
	addFlag: (command: CommandNode, name: string, def: FlagDef) => void,
): void {
	addFlag(command, "help", helpFlagDef);

	if (command.subCommands) {
		for (const sub of Object.values(command.subCommands)) {
			injectHelpFlags(sub, addFlag);
		}
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
