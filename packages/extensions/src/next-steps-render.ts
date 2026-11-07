import type { CommandSnapshot } from "@crustjs/core";
import type { RunInputValue } from "@crustjs/core/tooling";

import type { NextStep } from "./next-steps.ts";

function shellQuote(token: string): string {
	return /^[A-Za-z0-9_./:=@%+-]+$/.test(token)
		? token
		: `'${token.replaceAll("'", String.raw`'\''`)}'`;
}

function argvValue(value: RunInputValue): string {
	if (typeof value === "string") return value;
	return value instanceof URL ? value.href : JSON.stringify(value);
}

/** The step's argv after the application name; throws a reason when it does not fit the command tree. */
function stepArgv(root: CommandSnapshot, step: NextStep): string[] {
	let command = root;
	for (const name of step.command) {
		if (!Object.hasOwn(command.subCommands, name)) throw new Error("unknown command");
		command = command.subCommands[name]!;
	}
	const { args = {}, flags = {}, raw = [] } = step.input ?? {};

	const options: string[] = [];
	for (const [name, value] of Object.entries(flags)) {
		if (value === undefined) continue;
		if (!Object.hasOwn(command.flags, name)) throw new Error(`unknown flag "--${name}"`);
		const flag = command.flags[name]!;
		for (const item of flag.multiple && Array.isArray(value) ? value : [value]) {
			if (flag.type === "boolean") {
				// `false` on a `noNegate` flag has no spelling: it is the flag left unset.
				if (item === true) options.push(`--${name}`);
				else if (flag.negatable) options.push(`--no-${name}`);
				continue;
			}
			const text = argvValue(item);
			// The parser reads a separate token starting with "-" as a flag, not a value.
			options.push(...(text.startsWith("-") ? [`--${name}=${text}`] : [`--${name}`, text]));
		}
	}

	for (const name of Object.keys(args)) {
		if (!command.args.some((arg) => arg.name === name))
			throw new Error(`unknown argument "${name}"`);
	}
	const positionals: string[] = [];
	let omitted: string | undefined;
	for (const arg of command.args) {
		const value = args[arg.name];
		if (value === undefined) {
			omitted ??= arg.name;
			continue;
		}
		if (omitted !== undefined)
			throw new Error(`argument "${arg.name}" follows omitted "${omitted}"`);
		positionals.push(...(arg.variadic && Array.isArray(value) ? value : [value]).map(argvValue));
	}
	// Tokens after `--` fill unfilled positional arguments before they reach `rawArgs`.
	if (raw.length > 0 && (omitted !== undefined || command.args.at(-1)?.variadic)) {
		throw new Error("raw tokens would fill a positional argument");
	}
	const separator = raw.length > 0 || positionals.some((token) => token.startsWith("-"));
	return [...step.command, ...options, ...(separator ? ["--"] : []), ...positionals, ...raw];
}

/**
 * The `Next steps:` block for the steps that fit `root`'s command tree (`text` is
 * empty when none do), and one note per skipped step.
 */
export function renderNextSteps(
	root: CommandSnapshot,
	steps: readonly NextStep[],
): { readonly notes: readonly string[]; readonly text: string } {
	const notes: string[] = [];
	const lines: string[] = [];
	for (const step of steps) {
		let argv: string[];
		try {
			argv = stepArgv(root, step);
		} catch (error) {
			const name = [root.meta.name, ...step.command].join(" ");
			notes.push(`skipped "${name}": ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		const line = [root.meta.name, ...argv].map(shellQuote).join(" ");
		lines.push(...(step.description ? [`  ${step.description}:`, `    ${line}`] : [`  ${line}`]));
	}
	return { notes, text: lines.length > 0 ? ["Next steps:", ...lines].join("\n") : "" };
}
