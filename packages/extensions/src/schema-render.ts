import { type CommandSnapshot, CrustError, type ExtensionId } from "@crustjs/core";
import {
	type CommandDocumentation,
	buildCommandDocumentation,
	commandInputSchema,
	formatDescription,
	isListed,
	sectionsFor,
} from "@crustjs/core/tooling";

import type { CommandSchema } from "./schema.ts";

/**
 * Resolve `path` (canonical names or aliases, like routing) under `root` and
 * describe that command. Hidden commands resolve too.
 *
 * @throws {CrustError} `COMMAND_NOT_FOUND` naming the path up to the unknown segment
 */
export function commandSchema(root: CommandSnapshot, path: readonly string[]): CommandSchema {
	let command = root;
	const canonical: string[] = [];
	for (const segment of path) {
		const match = Object.hasOwn(command.subCommands, segment)
			? ([segment, command.subCommands[segment]!] as const)
			: Object.entries(command.subCommands).find(([, child]) =>
					child.meta.aliases?.includes(segment),
				);
		if (!match) {
			const subCommands = command.subCommands;
			throw new CrustError(
				"COMMAND_NOT_FOUND",
				`Unknown command "${[...canonical, segment].join(" ")}".`,
				{
					input: segment,
					available: Object.keys(subCommands).filter((name) => isListed(subCommands[name]!)),
					commandPath: [root.meta.name, ...canonical],
					parentCommand: command,
				},
			);
		}
		canonical.push(match[0]);
		command = match[1];
	}
	return {
		input: commandInputSchema(command, canonical),
		...(command.outputSchema ? { output: command.outputSchema } : {}),
	};
}

function valueLabel(type: string | undefined, multiple: boolean, required: boolean): string {
	const parts = [
		...(type ? [type] : []),
		...(multiple ? ["multiple"] : []),
		...(required ? ["required"] : []),
	];
	return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

function item(token: string, label: string, description: string): string {
	return `- ${token}${label}${description ? `: ${description}` : ""}`;
}

/**
 * Compact Markdown index of every visible command: usage, description, args,
 * flags, and the documentation sections visible to `consumer`.
 */
export function renderCommandIndex(root: CommandSnapshot, consumer: ExtensionId): string {
	const lines = [`# ${root.meta.name}`];
	const visit = (doc: CommandDocumentation) => {
		lines.push("", `## \`${doc.usage}\``);
		if (doc.description) lines.push("", doc.description);
		if (doc.args.length > 0) {
			lines.push("", "Arguments:", "");
			for (const arg of doc.args) {
				lines.push(
					item(
						`\`${arg.token}\``,
						valueLabel(arg.type, false, false),
						formatDescription(
							arg.description,
							arg.default,
							arg.choices,
							undefined,
							undefined,
							arg.sensitive,
						),
					),
				);
			}
		}
		if (doc.flags.length > 0) {
			lines.push("", "Flags:", "");
			for (const flag of doc.flags) {
				lines.push(
					item(
						flag.spellings.map((spelling) => `\`${spelling}\``).join(", "),
						valueLabel(flag.type, flag.multiple, flag.required),
						formatDescription(
							flag.description,
							flag.default,
							flag.choices,
							undefined,
							flag.env?.name,
							flag.sensitive,
						),
					),
				);
			}
		}
		for (const section of sectionsFor(doc.sections, consumer)) {
			lines.push("", `### ${section.title}`, "", section.body);
		}
		for (const child of doc.children) visit(child);
	};
	visit(buildCommandDocumentation(root));
	return lines.join("\n");
}
