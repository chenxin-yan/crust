import type { CommandSnapshot } from "@crustjs/core";
import { createCommandIndex, isListed } from "@crustjs/core/tooling";

import type { SearchMatch } from "./search.ts";

/** The five visible commands under `root` that best match `task`, best first. */
export function searchCommands(root: CommandSnapshot, task: string): readonly SearchMatch[] {
	const commands: { path: readonly string[]; command: CommandSnapshot }[] = [];
	const visit = (command: CommandSnapshot, path: readonly string[]) => {
		if (!isListed(command)) return;
		commands.push({ path, command });
		for (const [name, sub] of Object.entries(command.subCommands)) visit(sub, [...path, name]);
	};
	visit(root, []);
	const byPath = new Map(commands.map(({ path, command }) => [path.join(" "), command]));
	return createCommandIndex(commands)
		.search(task, 5)
		.map((path) => {
			const { meta, hasAction } = byPath.get(path.join(" "))!;
			return {
				command: [root.meta.name, ...path].join(" "),
				...(meta.description === undefined ? {} : { description: meta.description }),
				hasAction,
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
