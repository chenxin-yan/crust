import type { CommandSnapshot } from "@crustjs/core";
import { isListed } from "@crustjs/core/tooling";
import { createSearchIndex } from "@crustjs/utils/search";

import type { SearchMatch } from "./search.ts";

/** The five visible commands under `root` that best match `task`, best first, ties in command tree order. */
export function searchCommands(root: CommandSnapshot, task: string): readonly SearchMatch[] {
	const commands: { path: readonly string[]; command: CommandSnapshot }[] = [];
	const visit = (command: CommandSnapshot, path: readonly string[]) => {
		if (!isListed(command)) return;
		commands.push({ path, command });
		for (const [name, sub] of Object.entries(command.subCommands)) visit(sub, [...path, name]);
	};
	visit(root, []);
	const search = createSearchIndex(
		commands.map(({ path, command }) => ({
			names: [...path, command.meta.name, ...(command.meta.aliases ?? [])],
			descriptions: [command.meta.description],
			details: [
				...command.args.flatMap((arg) => [arg.name, arg.description]),
				...Object.entries(command.flags).flatMap(([name, flag]) =>
					flag.extension === undefined ? [name, flag.description] : [],
				),
			],
		})),
	);
	return search(task, 5).map((at) => {
		const { path, command } = commands[at]!;
		return {
			command: [root.meta.name, ...path].join(" "),
			...(command.meta.description === undefined ? {} : { description: command.meta.description }),
			hasAction: command.hasAction,
		};
	});
}

/** One line per match: the command, padded, then its description. */
export function formatMatches(matches: readonly SearchMatch[], task: string): string {
	if (matches.length === 0) return `No command matches ${JSON.stringify(task)}.`;
	const width = Math.max(...matches.map((match) => match.command.length));
	return matches
		.map((match) =>
			match.description === undefined
				? match.command
				: `${match.command.padEnd(width)}  ${match.description}`,
		)
		.join("\n");
}
