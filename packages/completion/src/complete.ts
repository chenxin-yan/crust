import type { CommandSnapshot } from "@crustjs/core";

/**
 * Live values for an argument or a flag that takes a value: called with the word being
 * completed (possibly empty), it returns that word's candidates. The shell keeps those that
 * start with the word.
 */
export type Completer = (typed: string) => readonly string[] | Promise<readonly string[]>;

/**
 * The hidden command the generated scripts call for a {@link Completer}'s values:
 * `__complete -- <address> [word]`. The address is the canonical command path from the root
 * name, then `--<flag>` or the argument's name, joined with spaces; it never starts with `-`,
 * and the word comes last, so a shell that drops an empty argument still calls it right.
 */
export const COMPLETE_COMMAND = "__complete";

/** The completer at a `__complete` address, if the tree under `root` has one there. */
export function completerAt(root: CommandSnapshot, address: string): Completer | undefined {
	const [, ...path] = address.split(" ");
	const target = path.pop() ?? "";
	let command: CommandSnapshot | undefined = root;
	for (const name of path) command = command?.subCommands[name];
	return command && completerOf(command, target);
}

/**
 * The completer `target` names on `command`: `--<name>` for a flag (an exclusive group's
 * member too), any other word for an argument.
 */
export function completerOf(command: CommandSnapshot, target: string): Completer | undefined {
	if (!target.startsWith("--")) return command.args.find((arg) => arg.name === target)?.complete;
	const name = target.slice(2);
	for (const [key, flag] of Object.entries(command.flags)) {
		if (key === name) return flag.complete;
		const member = flag.flags?.[name];
		if (member !== undefined) return member.complete;
	}
	return undefined;
}
