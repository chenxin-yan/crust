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

function formatDefaultValue(value: unknown): string {
	if (typeof value === "number" && !Number.isFinite(value)) {
		return String(value);
	}
	if (Array.isArray(value)) return value.map(String).join(", ");

	return JSON.stringify(value);
}

function formatDefaultSuffix(value: unknown): string {
	return dim(`[default: ${formatDefaultValue(value)}]`);
}

function formatDescription(description: string | undefined, defaultValue: unknown): string {
	if (defaultValue === undefined) {
		return description ?? "";
	}

	const defaultSuffix = formatDefaultSuffix(defaultValue);
	if (!description) {
		return defaultSuffix;
	}

	return `${description} ${defaultSuffix}`;
}

/**
 * Render a `[choices: a, b, c]` hint when a non-empty `choices` list is
 * present. The hint is colour-dimmed so it blends with the default-value
 * suffix style. Returns the empty string when no choices are declared
 * so the caller can unconditionally concatenate.
 *
 * Takes the raw `choices` array directly rather than a `def` object.
 * `FlagDef` and `ArgDef` are discriminated unions whose number/boolean
 * variants do not carry `choices` at all, so a structural `{ choices? }`
 * parameter would fail TS excess-property checks at every call site.
 * Each caller already has access to `def.choices` (typed as
 * `readonly string[] | undefined`), so passing it directly is clearer
 * and avoids the union narrowing.
 */
function formatChoicesSuffix(choices: readonly string[] | undefined): string {
	if (!choices || choices.length === 0) return "";
	return dim(`[choices: ${choices.join(", ")}]`);
}

/**
 * Compose description + default + choices suffixes into a single help
 * body line. Each segment is optional; separators collapse so we never
 * emit a stray double-space when one piece is missing.
 */
function formatDescriptionWithChoices(
	description: string | undefined,
	defaultValue: unknown,
	choices: readonly string[] | undefined,
): string {
	const base = formatDescription(description, defaultValue);
	const suffix = formatChoicesSuffix(choices);
	if (!suffix) return base;
	if (!base) return suffix;
	return `${base} ${suffix}`;
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
			`  ${rendered}${formatDescriptionWithChoices(def.description, def.default, def.choices)}`.trimEnd(),
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
			`  ${rendered}${formatDescriptionWithChoices(arg.description, arg.default, arg.choices)}`.trimEnd(),
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
