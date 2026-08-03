import {
	type ArgSnapshot,
	type CommandMeta,
	type CommandSnapshot,
	type Extension,
	defineExtension,
	type FlagSnapshot,
} from "@crustjs/core";
import { bold, cyan, dim, green, padEnd, yellow } from "@crustjs/style";

const FLAG_COLUMN_WIDTH = 28;
const ARG_COLUMN_WIDTH = 18;
const COMMAND_COLUMN_WIDTH = 10;

function formatArgToken(arg: ArgSnapshot): string {
	const base = arg.variadic ? `${arg.name}...` : arg.name;
	const token = arg.required ? `<${base}>` : `[${base}]`;
	return arg.required ? yellow(token) : dim(yellow(token));
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

function formatUsage(
	meta: Readonly<CommandMeta>,
	command: CommandSnapshot,
	path: string[],
): string {
	if (meta.usage) return green(meta.usage);

	const usageParts: string[] = [green(path.join(" "))];

	const hasVisibleSubCommands = Object.values(command.subCommands).some(
		(sub) => sub.meta.hidden !== true,
	);
	if (hasVisibleSubCommands && !command.hasHandler) {
		usageParts.push(cyan("<command>"));
	}

	for (const arg of command.args) {
		usageParts.push(formatArgToken(arg));
	}

	if (Object.keys(command.flags).length > 0) {
		usageParts.push(cyan("[options]"));
	}

	return usageParts.join(" ");
}

function formatFlagName(name: string, def: FlagSnapshot): string {
	const labels: string[] = [];

	if (def.short) {
		labels.push(`-${def.short}`);
	}

	labels.push(`--${name}`);

	// Long aliases are callable, so help discloses them. Negation is shown
	// for the canonical name only — "any long spelling negates" is the rule,
	// and the man page documents the exhaustive --no-<alias> surface.
	if (def.aliases) {
		for (const alias of def.aliases) labels.push(`--${alias}`);
	}

	if (def.type === "boolean" && !def.noNegate) {
		labels.push(`--no-${name}`);
	}

	return cyan(labels.join(", "));
}

function formatFlagsSection(flags: Readonly<Record<string, FlagSnapshot>>): string[] {
	if (Object.keys(flags).length === 0) return [];

	const lines = [bold(cyan("OPTIONS:"))];
	for (const [name, def] of Object.entries(flags)) {
		const rendered = `${padEnd(formatFlagName(name, def), FLAG_COLUMN_WIDTH, " ")} `;
		lines.push(
			`  ${rendered}${formatDescription(def.description, def.default, def.choices)}`.trimEnd(),
		);
	}

	return lines;
}

function formatArgsSection(command: CommandSnapshot): string[] {
	if (command.args.length === 0) return [];

	const lines = [bold(cyan("ARGS:"))];
	for (const arg of command.args) {
		const rendered = `${padEnd(formatArgToken(arg), ARG_COLUMN_WIDTH, " ")} `;
		lines.push(
			`  ${rendered}${formatDescription(arg.description, arg.default, arg.choices)}`.trimEnd(),
		);
	}

	return lines;
}

/**
 * Render the canonical command name with any aliases inline. The canonical
 * name is styled green; the `(a, b)` suffix is rendered in the default
 * colour so the canonical spelling stands out at a glance.
 *
 * `name`                       — no aliases
 * `name (alias1, alias2)`      — one or more aliases
 *
 * `padEnd` (from `@crustjs/style`) is ANSI-aware: it pads against the
 * *visible* width so styling codes don't throw column alignment off. If the
 * combined label exceeds `COMMAND_COLUMN_WIDTH`, padEnd is a no-op and the
 * label overflows the column rather than truncating — truncating aliases
 * would hide which alternative names exist, defeating the point.
 */
function formatCommandLabel(name: string, aliases: readonly string[] | undefined): string {
	const styledName = green(name);
	if (!aliases || aliases.length === 0) return styledName;
	return `${styledName} (${aliases.join(", ")})`;
}

function formatCommandsSection(command: CommandSnapshot): string[] {
	// Filter out subcommands marked `meta.hidden: true`. Hidden
	// commands remain resolvable by direct invocation — routing in
	// `packages/core/src/command/router.ts` does not consult `meta.hidden`. Filtering
	// happens after `Object.entries` so insertion order is preserved for the
	// surviving entries.
	const visibleEntries = Object.entries(command.subCommands).filter(
		([, subCommand]) => subCommand.meta.hidden !== true,
	);

	if (visibleEntries.length === 0) {
		return [];
	}

	const lines = [bold(cyan("COMMANDS:"))];
	for (const [name, subCommand] of visibleEntries) {
		const label = formatCommandLabel(name, subCommand.meta.aliases);
		const rendered = `${padEnd(label, COMMAND_COLUMN_WIDTH, " ")} `;
		lines.push(`  ${rendered}${subCommand.meta.description ?? ""}`.trimEnd());
	}

	return lines;
}

export function renderHelp(command: CommandSnapshot, path?: readonly string[]): string {
	const resolvedPath = [...(path ?? [command.meta.name])];
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

	const optionsSection = formatFlagsSection(command.flags);
	if (optionsSection.length > 0) {
		lines.push("");
		lines.push(...optionsSection);
	}

	return lines.join("\n");
}

export function helpExtension(): Extension {
	return defineExtension("help", {
		flags: {
			help: {
				type: "boolean",
				short: "h",
				noNegate: true,
				inherit: true,
				description: "Show help",
			},
		},
		hooks: {
			preRun(context) {
				if (context.flags.help !== true && context.command.hasHandler) return;

				// Explicit --help, or a container command without a handler
				context.stdout(renderHelp(context.command, context.commandPath));
				return context.finish();
			},
		},
	});
}
