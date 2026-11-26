import type { CommandSnapshot, ExtensionId } from "@crustjs/core";
import {
	type CommandDocumentation,
	buildCommandDocumentation,
	commandInputSchema,
	formatDescription,
	sectionsFor,
} from "@crustjs/core/tooling";

import { resolveCommand } from "./resolve-command.ts";
import type { CommandSchema } from "./schema.ts";

/**
 * Describe the command at `path` (canonical names or aliases, like routing) under `root`.
 * Hidden commands resolve too.
 *
 * @throws {CrustError} `COMMAND_NOT_FOUND` naming the path up to the unknown segment
 */
export function commandSchema(root: CommandSnapshot, path: readonly string[]): CommandSchema {
	const { command, path: canonical } = resolveCommand(root, path);
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
		const description = formatDescription(
			doc.description,
			undefined,
			undefined,
			undefined,
			undefined,
			doc.deprecated,
		);
		if (description) lines.push("", description);
		if (doc.examples.length > 0) lines.push("", "Examples:", "", "```", ...doc.examples, "```");
		if (doc.args.length > 0) {
			lines.push("", "Arguments:", "");
			for (const arg of doc.args) {
				lines.push(
					item(
						`\`${arg.token}\``,
						valueLabel(arg.type, false, false),
						formatDescription(arg.description, arg.default, arg.choices),
					),
				);
			}
		}
		let heading: string | undefined;
		for (const flag of doc.flags) {
			const next = flag.inherited ? "Global flags" : (flag.heading ?? "Flags");
			if (next !== heading) lines.push("", `${(heading = next)}:`, "");
			// A declared value name says more than the type the label already gives.
			const value =
				flag.valueName === undefined || flag.valueName === flag.type ? "" : ` <${flag.valueName}>`;
			lines.push(
				item(
					flag.spellings
						.map(
							(spelling, index, all) => `\`${spelling}${index === all.length - 1 ? value : ""}\``,
						)
						.join(", "),
					valueLabel(flag.type, flag.multiple, flag.required),
					formatDescription(
						flag.description,
						flag.default,
						flag.choices,
						undefined,
						flag.env,
						flag.deprecated,
					),
				),
			);
		}
		for (const section of sectionsFor(doc.sections, consumer)) {
			lines.push("", `### ${section.title}`, "", section.body);
		}
		for (const child of doc.children) visit(child);
	};
	visit(buildCommandDocumentation(root));
	return lines.join("\n");
}
