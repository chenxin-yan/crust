import { type CommandSnapshot, CrustError } from "@crustjs/core";
import { isListed } from "@crustjs/core/tooling";

/**
 * Resolve `path` (canonical names or aliases, like routing) under `root`. Hidden
 * commands resolve too.
 *
 * @returns The command and its canonical path below `root`
 * @throws {CrustError} `COMMAND_NOT_FOUND` naming the path up to the unknown segment
 */
export function resolveCommand(
	root: CommandSnapshot,
	path: readonly string[],
): { readonly command: CommandSnapshot; readonly path: readonly string[] } {
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
	return { command, path: canonical };
}
