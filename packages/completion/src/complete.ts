import type { CommandSnapshot } from "@crustjs/core";
import { buildCommandDocumentation } from "@crustjs/core/tooling";

import { isScriptChoice } from "./escape.ts";

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

/**
 * The completer that stands in for `choices` the scripts cannot hold as written, such as one
 * with a space: it answers with every choice, which the scripts quote as they insert it.
 */
export function choiceCompleter(choices: readonly string[] | undefined): Completer | undefined {
	return choices?.every(isScriptChoice) === false ? () => choices : undefined;
}

/** The completer at a `__complete` address, if the tree under `root` has one there. */
export function completerAt(root: CommandSnapshot, address: string): Completer | undefined {
	const [, ...path] = address.split(" ");
	const target = path.pop() ?? "";
	let command: CommandSnapshot | undefined = root;
	for (const name of path) {
		command =
			command && Object.hasOwn(command.subCommands, name) ? command.subCommands[name] : undefined;
	}
	if (command === undefined) return undefined;
	const declared = completerOf(command, target);
	if (declared !== undefined) return declared;
	// The choices as the walk read them, schema `enum` included; this command alone, not its subtree.
	const { args, flags } = buildCommandDocumentation({ ...command, subCommands: {} });
	return choiceCompleter(
		target.startsWith("--")
			? flags.find((flag) => flag.name === target.slice(2))?.choices
			: args.find((arg) => arg.name === target)?.choices,
	);
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
