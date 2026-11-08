import type { CommandSnapshot, ExtensionContext, ValueType } from "@crustjs/core";
import type { RunInputValue } from "@crustjs/core/tooling";
import { parseJsonValue } from "@crustjs/utils/json";
import { shellQuote } from "@crustjs/utils/process";

import type { NextStep } from "./next-steps.ts";

/** Argv parses a `json` value with `JSON.parse`, so even a string value needs its JSON encoding. */
function argvValue(value: RunInputValue, type: ValueType | undefined, label: string): string {
	if (typeof value === "string" && type !== "json") return value;
	// Argv reads numbers with `Number()`: it accepts `Infinity` (JSON would print `null`) but rejects `NaN`.
	if (typeof value === "number" && type !== "json") {
		if (Number.isNaN(value)) throw new Error(`${label} value NaN has no argv spelling`);
		return Object.is(value, -0) ? "-0" : String(value);
	}
	if (value instanceof URL) return value.href;
	if (type !== "json") return JSON.stringify(value);
	// Skip values `JSON.stringify` would change (non-finite numbers, `-0`, …) instead of suggesting other data.
	try {
		return JSON.stringify(parseJsonValue(value), (_key, item: unknown) => {
			if (Object.is(item, -0)) throw new TypeError("-0 does not survive JSON");
			return item;
		});
	} catch (cause) {
		const reason = cause instanceof Error ? cause.message : String(cause);
		throw new Error(`${label} value has no JSON spelling (${reason})`, { cause });
	}
}

/** The argv after the application name for `names`' command; throws a reason when `input` does not fit it. */
function stepArgv(
	root: CommandSnapshot,
	names: readonly string[],
	input: NextStep["input"],
): string[] {
	let command = root;
	for (const name of names) command = command.subCommands[name]!;
	const { args = {}, flags = {}, raw = [] } = input ?? {};

	const options: string[] = [];
	for (const [name, value] of Object.entries(flags)) {
		if (value === undefined) continue;
		if (!Object.hasOwn(command.flags, name)) throw new Error(`unknown flag "--${name}"`);
		const flag = command.flags[name]!;
		for (const item of flag.multiple && Array.isArray(value) ? value : [value]) {
			if (flag.type === "boolean") {
				if (typeof item !== "boolean") throw new Error(`"--${name}" value is not a boolean`);
				// `false` on a `noNegate` flag has no spelling: it is the flag left unset.
				if (item) options.push(`--${name}`);
				else if (flag.negatable) options.push(`--no-${name}`);
				continue;
			}
			const text = argvValue(item, flag.type, `"--${name}"`);
			// The parser splits each occurrence on the delimiter and drops empty pieces.
			if (flag.delimiter !== undefined && (text === "" || text.includes(flag.delimiter))) {
				const problem = text === "" ? "is dropped by" : "contains";
				throw new Error(
					`"--${name}" value ${JSON.stringify(text)} ${problem} its delimiter ${JSON.stringify(flag.delimiter)}`,
				);
			}
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
		// hasOwn: an argument named `constructor` or `__proto__` must not read Object.prototype.
		const value = Object.hasOwn(args, arg.name) ? args[arg.name] : undefined;
		if (value === undefined) {
			omitted ??= arg.name;
			continue;
		}
		if (omitted !== undefined)
			throw new Error(`argument "${arg.name}" follows omitted "${omitted}"`);
		positionals.push(
			...(arg.variadic && Array.isArray(value) ? value : [value]).map((item) =>
				argvValue(item, arg.type, `argument "${arg.name}"`),
			),
		);
	}
	// Tokens after `--` fill unfilled positional arguments before they reach `rawArgs`.
	if (raw.length > 0 && (omitted !== undefined || command.args.at(-1)?.variadic)) {
		throw new Error("raw tokens would fill a positional argument");
	}
	// After `--` a positional is never read as a flag, nor routed as a subcommand name or alias.
	const separator =
		raw.length > 0 ||
		(positionals.length > 0 &&
			(Object.keys(command.subCommands).length > 0 ||
				positionals.some((token) => token.startsWith("-"))));
	return [...names, ...options, ...(separator ? ["--"] : []), ...positionals, ...raw];
}

/**
 * The `Next steps:` block for the steps whose command `root`'s application adds and
 * whose input fits it (`text` is empty when none do), and one note per skipped step.
 */
export function renderNextSteps(
	root: CommandSnapshot,
	steps: readonly NextStep[],
	commandPathOf: ExtensionContext["commandPathOf"],
): { readonly notes: readonly string[]; readonly text: string } {
	const notes: string[] = [];
	const lines: string[] = [];
	for (const step of steps) {
		let path: readonly string[] | undefined;
		let argv: string[];
		try {
			path = commandPathOf(step.command);
			if (!path) throw new Error("the application does not add this command");
			argv = stepArgv(root, path.slice(1), step.input);
		} catch (error) {
			const name = path ? path.join(" ") : step.command.name;
			notes.push(`skipped "${name}": ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		const line = [root.meta.name, ...argv].map(shellQuote).join(" ");
		lines.push(...(step.description ? [`  ${step.description}:`, `    ${line}`] : [`  ${line}`]));
	}
	return { notes, text: lines.length > 0 ? ["Next steps:", ...lines].join("\n") : "" };
}
