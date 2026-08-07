import { flagSpellings } from "../parsing/spellings.ts";
import type { CommandSnapshot, FlagSnapshot } from "./snapshot.ts";

export interface DocumentationArg {
	readonly name: string;
	readonly token: string;
	readonly type?: CommandSnapshot["args"][number]["type"];
	readonly description?: string;
	readonly required: boolean;
	readonly variadic: boolean;
	readonly choices?: readonly string[];
	readonly default?: unknown;
}

export interface DocumentationFlag {
	readonly name: string;
	/** All accepted CLI spellings, ordered short, canonical, aliases, then negations. */
	readonly spellings: readonly string[];
	readonly short?: string;
	readonly aliases: readonly string[];
	readonly negatable: boolean;
	readonly type: FlagSnapshot["type"];
	readonly description?: string;
	readonly required: boolean;
	readonly multiple: boolean;
	readonly choices?: readonly string[];
	readonly default?: unknown;
}

export interface CommandDocumentation {
	readonly name: string;
	readonly path: readonly string[];
	readonly description?: string;
	readonly aliases: readonly string[];
	readonly usage: string;
	readonly hasHandler: boolean;
	readonly args: readonly DocumentationArg[];
	readonly flags: readonly DocumentationFlag[];
	/** Visible children only; hidden commands remain invocable but are not documentation. */
	readonly children: readonly CommandDocumentation[];
}

function argToken(arg: CommandSnapshot["args"][number]): string {
	const name = arg.variadic ? `${arg.name}...` : arg.name;
	return arg.required ? `<${name}>` : `[${name}]`;
}

function documentationFlags(flags: CommandSnapshot["flags"]): readonly DocumentationFlag[] {
	const table = flagSpellings(flags);
	return Object.entries(flags).map(([name, def]) => {
		const entries = [...table.values()].filter((entry) => entry.canonicalName === name);
		const short = entries.filter((entry) => entry.kind === "short");
		const long = entries.filter((entry) => entry.kind !== "short");
		return Object.freeze({
			name,
			spellings: Object.freeze([
				...short.map((entry) => `-${entry.spelling}`),
				...long.map((entry) => `--${entry.spelling}`),
				...long.filter((entry) => entry.negatable).map((entry) => `--no-${entry.spelling}`),
			]),
			short: def.short,
			aliases: Object.freeze([...(def.aliases ?? [])]),
			negatable: def.type === "boolean" && def.noNegate !== true,
			type: def.type,
			description: def.description,
			required: def.required === true,
			multiple: def.multiple === true,
			choices: def.choices,
			default: def.default,
		});
	});
}

function buildNode(command: CommandSnapshot, path: readonly string[]): CommandDocumentation {
	const args = command.args.map((arg) =>
		Object.freeze({
			...arg,
			token: argToken(arg),
			required: arg.required === true,
			variadic: arg.variadic === true,
		}),
	);
	const children = Object.entries(command.subCommands)
		.filter(([, child]) => child.meta.hidden !== true)
		.map(([name, child]) => buildNode(child, [...path, name]));
	const flags = documentationFlags(command.flags);
	const usage =
		command.meta.usage ??
		[
			path.join(" "),
			children.length > 0 && !command.hasHandler ? "<command>" : undefined,
			...args.map((arg) => arg.token),
			flags.length > 0 ? "[options]" : undefined,
		]
			.filter(Boolean)
			.join(" ");

	return Object.freeze({
		name: command.meta.name,
		path: Object.freeze([...path]),
		description: command.meta.description,
		aliases: Object.freeze([...(command.meta.aliases ?? [])]),
		usage,
		hasHandler: command.hasHandler,
		args: Object.freeze(args),
		flags: Object.freeze(flags),
		children: Object.freeze(children),
	});
}

/** Build the presentation-neutral documentation model for a full command tree. */
export function buildCommandDocumentation(
	command: CommandSnapshot,
	path: readonly string[] = [command.meta.name],
): CommandDocumentation {
	return buildNode(command, path);
}
