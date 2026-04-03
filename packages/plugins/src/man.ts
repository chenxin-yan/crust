import { writeFileSync } from "node:fs";
import type {
	ArgDef,
	CommandMeta,
	CommandNode,
	CrustPlugin,
	FlagDef,
	FlagsDef,
} from "@crustjs/core";
import { Crust } from "@crustjs/core";

// ────────────────────────────────────────────────────────────────────────────
// Options
// ────────────────────────────────────────────────────────────────────────────

/** One titled block of plain text (escaped for troff). */
export interface ManPageSectionBlock {
	title: string;
	body: string;
}

/** Per-command path extra prose (keys are space-separated paths, e.g. `"app deploy"`). */
export interface ManPageCommandSection {
	/** Plain text; escaped like flag descriptions. */
	extra?: string;
	/** Raw troff body; not escaped. */
	rawExtra?: string;
}

export interface ManPageGeneratorOptions {
	/** Manual section number (default `"1"`). */
	section?: string;
	/** `.TH` title (default `root.meta.name`). */
	title?: string;
	/** `.TH` date string (optional). */
	date?: string;
	/** `.TH` source/footer center (optional). */
	source?: string;
	/** `.TH` manual name (default `"User Commands"`). */
	manual?: string;
	/** Inserted after DESCRIPTION, before COMMANDS / command reference. */
	extraSectionsBefore?: ManPageSectionBlock[];
	/** Appended after command reference. */
	extraSectionsAfter?: ManPageSectionBlock[];
	rawTroffSectionsBefore?: ManPageSectionBlock[];
	rawTroffSectionsAfter?: ManPageSectionBlock[];
	commandSections?: Record<string, ManPageCommandSection>;
}

export type ManPagePluginOptions = ManPageGeneratorOptions & {
	/** Injected subcommand name (default `"man"`). */
	command?: string;
};

// ────────────────────────────────────────────────────────────────────────────
// Troff escaping (plain text)
// ────────────────────────────────────────────────────────────────────────────

function escapeManLine(line: string): string {
	let s = line.replace(/\\/g, "\\e");
	if (s.startsWith(".") || s.startsWith("'")) {
		s = `\\&${s}`;
	}
	return s;
}

function escapeManParagraphs(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return "";

	const blocks = trimmed.split(/\n{2,}/);
	const out: string[] = [];
	for (const block of blocks) {
		out.push(".PP");
		for (const line of block.split("\n")) {
			out.push(escapeManLine(line));
		}
	}
	return out.join("\n");
}

/** Body lines after a `.TP` tag (no leading `.PP` on the first paragraph). */
function appendFlowAfterTp(lines: string[], text: string): void {
	const trimmed = text.trim();
	if (!trimmed) return;

	const blocks = trimmed.split(/\n{2,}/);
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i] ?? "";
		if (i > 0) lines.push(".PP");
		for (const line of block.split("\n")) {
			lines.push(escapeManLine(line));
		}
	}
}

function manShMacro(title: string): string {
	if (/[\s"]/.test(title)) {
		return `.SH "${title.replace(/\\/g, "\\e").replace(/"/g, '\\"')}"`;
	}
	return `.SH ${title}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Plain formatters (help parity, no styling)
// ────────────────────────────────────────────────────────────────────────────

function formatArgTokenPlain(arg: ArgDef): string {
	const base = arg.variadic ? `${arg.name}...` : arg.name;
	return arg.required ? `<${base}>` : `[${base}]`;
}

function formatDefaultValuePlain(value: unknown): string {
	if (typeof value === "number" && !Number.isFinite(value)) {
		return String(value);
	}
	if (Array.isArray(value)) return value.map(String).join(", ");

	return JSON.stringify(value);
}

function formatDescriptionPlain(
	description: string | undefined,
	defaultValue: unknown,
): string {
	if (defaultValue === undefined) {
		return description ?? "";
	}

	const suffix = `[default: ${formatDefaultValuePlain(defaultValue)}]`;
	if (!description) return suffix;
	return `${description} ${suffix}`;
}

function formatUsagePlain(
	meta: CommandMeta,
	command: CommandNode,
	path: string[],
): string {
	if (meta.usage) return meta.usage;

	const parts: string[] = [path.join(" ")];

	if (Object.keys(command.subCommands).length > 0 && !command.run) {
		parts.push("<command>");
	}

	if (command.args) {
		for (const arg of command.args) {
			parts.push(formatArgTokenPlain(arg));
		}
	}

	if (Object.keys(command.effectiveFlags).length > 0) {
		parts.push("[options]");
	}

	return parts.join(" ");
}

function formatFlagLabelsPlain(name: string, def: FlagDef): string {
	const labels: string[] = [];
	if (def.short) {
		labels.push(`-${def.short}`);
	}
	labels.push(`--${name}`);
	if (def.type === "boolean" && !def.noNegate) {
		labels.push(`--no-${name}`);
	}
	return labels.join(", ");
}

function commandPathKey(path: string[]): string {
	return path.join(" ");
}

function collectNodesPreorder(
	node: CommandNode,
	path: string[],
	out: Array<{ node: CommandNode; path: string[] }>,
): void {
	out.push({ node, path });
	const names = Object.keys(node.subCommands).sort();
	for (const name of names) {
		const sub = node.subCommands[name];
		if (sub) collectNodesPreorder(sub, [...path, name], out);
	}
}

function emitOptionsTp(flagsDef: FlagsDef): string[] {
	const lines: string[] = [];
	const names = Object.keys(flagsDef).sort();
	for (const name of names) {
		const def = flagsDef[name];
		if (!def) continue;
		const tag = formatFlagLabelsPlain(name, def);
		const desc = formatDescriptionPlain(def.description, def.default);
		lines.push(".TP");
		lines.push(`\\fB${tag.replace(/\\/g, "\\e").replace(/-/g, "\\-")}\\fR`);
		if (desc) {
			appendFlowAfterTp(lines, desc);
		}
	}
	return lines;
}

/** Escape text for inline bold-ish display in NAME (single line). */
function escapeManInline(text: string): string {
	return text.replace(/\\/g, "\\e").replace(/-/g, "\\-").replace(/\./g, "\\&.");
}

function emitSectionBlocks(
	sections: ManPageSectionBlock[] | undefined,
	escapeBody: boolean,
): string[] {
	if (!sections?.length) return [];
	const out: string[] = [];
	for (const { title, body } of sections) {
		out.push(manShMacro(title));
		out.push(escapeBody ? escapeManParagraphs(body) : body.trimEnd());
	}
	return out;
}

function emitCommandReference(
	root: CommandNode,
	commandSections: Record<string, ManPageCommandSection> | undefined,
): string[] {
	const rootPath = [root.meta.name];
	const entries: Array<{ node: CommandNode; path: string[] }> = [];
	collectNodesPreorder(root, rootPath, entries);

	const lines: string[] = [];
	lines.push(manShMacro("COMMAND REFERENCE"));

	for (const { node, path } of entries) {
		const key = commandPathKey(path);
		lines.push(`.SS ${key.replace(/-/g, "\\-")}`);
		lines.push(".nf");
		lines.push(escapeManLine(formatUsagePlain(node.meta, node, path)));
		lines.push(".fi");

		if (node.args?.length) {
			lines.push(manShMacro("ARGS"));
			for (const arg of node.args) {
				const tag = formatArgTokenPlain(arg);
				const desc = formatDescriptionPlain(arg.description, arg.default);
				lines.push(".TP");
				lines.push(`\\fB${tag.replace(/\\/g, "\\e").replace(/-/g, "\\-")}\\fR`);
				if (desc) appendFlowAfterTp(lines, desc);
			}
		}

		if (Object.keys(node.effectiveFlags).length > 0) {
			lines.push(manShMacro("OPTIONS"));
			lines.push(...emitOptionsTp(node.effectiveFlags));
		}

		const cs = commandSections?.[key];
		if (cs?.extra?.trim()) {
			lines.push(manShMacro("NOTES"));
			lines.push(escapeManParagraphs(cs.extra));
		}
		if (cs?.rawExtra?.trim()) {
			lines.push(cs.rawExtra.trimEnd());
		}
	}

	return lines;
}

function emitCommandsList(root: CommandNode): string[] {
	const names = Object.keys(root.subCommands).sort();
	if (names.length === 0) return [];

	const lines: string[] = [];
	lines.push(manShMacro("COMMANDS"));
	for (const name of names) {
		const sub = root.subCommands[name];
		if (!sub) continue;
		lines.push(".TP");
		lines.push(`\\fB${escapeManInline(name)}\\fR`);
		const d = sub.meta.description?.trim();
		if (d) appendFlowAfterTp(lines, d);
	}
	return lines;
}

/**
 * Build a troff `-man` document for a command tree.
 *
 * Mirrors {@link renderHelp} semantics (usage, args, flags, boolean negation)
 * without terminal styling.
 */
export function renderManPage(
	root: CommandNode,
	options: ManPageGeneratorOptions = {},
): string {
	const section = options.section ?? "1";
	const title = options.title ?? root.meta.name;
	const date = options.date ?? "";
	const source = options.source ?? "";
	const manual = options.manual ?? "User Commands";

	const lines: string[] = [];

	lines.push(`.TH ${title} ${section} "${date}" "${source}" "${manual}"`);
	lines.push(manShMacro("NAME"));
	const nameDesc = root.meta.description?.trim() ?? "";
	if (nameDesc) {
		lines.push(
			`\\fB${escapeManInline(root.meta.name)}\\fR \\fB\\-\\fR ${escapeManInline(nameDesc)}`,
		);
	} else {
		lines.push(`\\fB${escapeManInline(root.meta.name)}\\fR`);
	}

	lines.push(manShMacro("SYNOPSIS"));
	lines.push(".nf");
	lines.push(
		escapeManLine(formatUsagePlain(root.meta, root, [root.meta.name])),
	);
	lines.push(".fi");

	if (root.meta.description?.trim()) {
		lines.push(manShMacro("DESCRIPTION"));
		lines.push(escapeManParagraphs(root.meta.description));
	}

	lines.push(
		...emitSectionBlocks(options.extraSectionsBefore, true),
		...emitSectionBlocks(options.rawTroffSectionsBefore, false),
	);

	lines.push(...emitCommandsList(root));
	lines.push(...emitCommandReference(root, options.commandSections));

	lines.push(
		...emitSectionBlocks(options.extraSectionsAfter, true),
		...emitSectionBlocks(options.rawTroffSectionsAfter, false),
	);

	return `${lines.filter(Boolean).join("\n")}\n`;
}

function toGeneratorOptions(
	opts: ManPagePluginOptions,
): ManPageGeneratorOptions {
	const { command: _command, ...rest } = opts;
	return rest;
}

function buildManSubcommandNode(
	root: CommandNode,
	generatorOptions: ManPageGeneratorOptions,
): CommandNode {
	return new Crust("man")
		.meta({
			description: "Print troff man page source for this program",
		})
		.flags({
			output: {
				type: "string",
				short: "o",
				description: "Write man page to file instead of stdout",
			},
		})
		.run((ctx) => {
			const body = renderManPage(root, generatorOptions);
			const path = ctx.flags.output as string | undefined;
			if (path) {
				writeFileSync(path, body, "utf8");
			} else {
				console.log(body);
			}
		})._node;
}

/**
 * Registers a `man` subcommand (configurable) that prints or writes {@link renderManPage} output.
 *
 * Generator options are the same as for {@link renderManPage}, plus `command` for the subcommand name.
 */
export function manPagePlugin(options: ManPagePluginOptions = {}): CrustPlugin {
	const commandName = options.command ?? "man";
	const generatorOptions = toGeneratorOptions(options);

	return {
		name: "man-page",
		setup(context, actions) {
			const node = buildManSubcommandNode(
				context.rootCommand,
				generatorOptions,
			);
			actions.addSubCommand(context.rootCommand, commandName, node);
		},
	};
}
