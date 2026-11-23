import type { ArgSnapshot, CommandSnapshot, ExtensionContext, FlagSnapshot } from "@crustjs/core";
import { checkNumber, type RunInputValue } from "@crustjs/core/tooling";
import { parseJsonValue } from "@crustjs/utils/json";
import { shellQuote } from "@crustjs/utils/process";

import type { NextStep } from "./next-steps.ts";

/** Argv parses a `json` value with `JSON.parse`, so even a string value needs its JSON encoding. */
function argvValue(value: RunInputValue, def: ArgSnapshot | FlagSnapshot, label: string): string {
	const { type } = def;
	if (typeof value === "string" && type !== "json") return value;
	// Argv reads only finite decimals, and checks an `integer` and `min`/`max` as `run()` does.
	if (typeof value === "number" && type !== "json") {
		if (!Number.isFinite(value)) throw new Error(`${label} value ${value} has no argv spelling`);
		checkNumber(def, value, label);
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

function isSubcommandSpelling(command: CommandSnapshot, token: string): boolean {
	return Object.entries(command.subCommands).some(
		([name, child]) => name === token || child.meta.aliases?.includes(token),
	);
}

/** The argv after the application name for `names`' command; throws a reason when `input` does not fit it. */
function stepArgv(
	root: CommandSnapshot,
	names: readonly string[],
	input: NextStep["input"],
): string[] {
	let command = root;
	for (const name of names) command = command.subCommands[name]!;
	const { args = {}, flags = {} } = input ?? {};

	const options: string[] = [];
	for (const [key, given] of Object.entries(flags)) {
		if (given === undefined) continue;
		if (!Object.hasOwn(command.flags, key)) throw new Error(`unknown flag "--${key}"`);
		let [name, flag, value] = [key, command.flags[key]!, given];
		// An exclusive group's value names the member to spell: `{ flag: "all" }` is `--all`.
		if (flag.flags) {
			const member = typeof value === "object" && value !== null && "flag" in value ? value : {};
			if (typeof member.flag !== "string" || !Object.hasOwn(flag.flags, member.flag))
				throw new Error(`"--${key}" value names none of its flags`);
			[name, flag, value] = [member.flag, flag.flags[member.flag]!, member.value ?? true];
		}
		for (const item of flag.multiple && Array.isArray(value) ? value : [value]) {
			if (flag.type === "boolean") {
				if (typeof item !== "boolean") throw new Error(`"--${name}" value is not a boolean`);
				// `false` on a flag that is not negatable has no spelling: it is the flag left unset,
				// which its environment variable may turn on, or which is required.
				if (item) options.push(`--${name}`);
				else if (flag.negatable) options.push(`--no-${name}`);
				else if (flag.env !== undefined)
					throw new Error(
						`"--${name}" false has no spelling, and its environment variable may set it`,
					);
				else if (flag.required)
					throw new Error(`"--${name}" false has no spelling, and the flag is required`);
				continue;
			}
			if (flag.type === "count") {
				if (!Number.isSafeInteger(item) || Number(item) < 0)
					throw new Error(`"--${name}" value is not a count`);
				options.push(...Array.from({ length: Number(item) }, () => `--${name}`));
				continue;
			}
			const text = argvValue(item, flag, `"--${name}"`);
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
	const afterDoubleDash: string[] = [];
	const last = command.args.at(-1);
	let omitted: string | undefined;
	for (const arg of command.args) {
		// hasOwn: an argument named `constructor` or `__proto__` must not read Object.prototype.
		const value = Object.hasOwn(args, arg.name) ? args[arg.name] : undefined;
		const afterSeparator = arg.variadic === "afterDoubleDash";
		if (value === undefined) {
			if (!afterSeparator) omitted ??= arg.name;
			continue;
		}
		// An `"afterDoubleDash"` argument reads only tokens after `--`, so earlier omissions don't shift it.
		if (omitted !== undefined && !afterSeparator)
			throw new Error(`argument "${arg.name}" follows omitted "${omitted}"`);
		(afterSeparator ? afterDoubleDash : positionals).push(
			...(arg.variadic && Array.isArray(value) ? value : [value]).map((item) =>
				argvValue(item, arg, `argument "${arg.name}"`),
			),
		);
	}
	if (last?.variadic === "afterDoubleDash") {
		// `--` belongs to that argument, so the ones before it have no escape from flag and subcommand parsing.
		for (const [index, token] of positionals.entries()) {
			if (token.startsWith("-") && token !== "-") {
				throw new Error(`argument value ${JSON.stringify(token)} starts with "-" before "--"`);
			}
			if (index === 0 && isSubcommandSpelling(command, token)) {
				throw new Error(`argument value ${JSON.stringify(token)} names a subcommand`);
			}
		}
		return [
			...names,
			...options,
			...positionals,
			...(afterDoubleDash.length > 0 ? ["--", ...afterDoubleDash] : []),
		];
	}
	// After `--` a positional is never read as a flag, nor routed as a subcommand name or alias.
	// With a `"passthrough"` argument the parser stops reading flags at the first positional,
	// so only that one can be misread.
	const flagReadable = last?.variadic === "passthrough" ? positionals.slice(0, 1) : positionals;
	const separator =
		positionals.length > 0 &&
		(Object.keys(command.subCommands).length > 0 ||
			flagReadable.some((token) => token.startsWith("-")));
	return [...names, ...options, ...(separator ? ["--"] : []), ...positionals];
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
