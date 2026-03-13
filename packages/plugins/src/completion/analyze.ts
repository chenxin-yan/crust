import type { ArgDef, CommandNode, FlagDef, FlagsDef } from "@crustjs/core";
import { getCompletionSource } from "./metadata.ts";
import type {
	CompletionContext,
	CompletionPosition,
	CompletionShell,
	CompletionSource,
} from "./types.ts";

interface FlagRef {
	name: string;
	def: FlagDef;
}

interface FlagLookup {
	ordered: FlagRef[];
	longNames: string[];
	longRefs: Map<string, FlagRef>;
	shortRefs: Map<string, FlagRef>;
}

interface ParseState {
	afterDoubleDash: boolean;
	expectingValueFor?: FlagRef;
	parsedFlags: Record<string, unknown>;
	parsedArgs: string[];
}

interface CompletionAnalysis {
	command: CommandNode;
	commandPath: string[];
	position: CompletionPosition;
	currentToken: string;
	currentIndex: number;
	tokensBeforeCurrent: readonly string[];
	parsedFlags: Record<string, unknown>;
	parsedArgs: string[];
	flagName?: string;
	arg?: ArgDef;
}

interface NormalizedCompletionItem {
	value: string;
	description?: string;
}

function isVisibleCommand(command: CommandNode): boolean {
	return command.meta.hidden !== true;
}

function visibleSubCommands(
	command: CommandNode,
): Array<[string, CommandNode]> {
	return Object.entries(command.subCommands).filter(([, subCommand]) =>
		isVisibleCommand(subCommand),
	);
}

function buildFlagLookup(flags: FlagsDef): FlagLookup {
	const ordered: FlagRef[] = [];
	const longNames: string[] = [];
	const longRefs = new Map<string, FlagRef>();
	const shortRefs = new Map<string, FlagRef>();

	for (const [name, def] of Object.entries(flags)) {
		const ref = { name, def };
		ordered.push(ref);

		longNames.push(name);
		longRefs.set(name, ref);

		for (const alias of def.aliases ?? []) {
			longNames.push(alias);
			longRefs.set(alias, ref);
		}

		if (def.short) {
			shortRefs.set(def.short, ref);
		}
	}

	return { ordered, longNames, longRefs, shortRefs };
}

function storeFlagValue(
	parsedFlags: Record<string, unknown>,
	ref: FlagRef,
	value: unknown,
): void {
	if (ref.def.multiple) {
		const existing = parsedFlags[ref.name];
		if (Array.isArray(existing)) {
			existing.push(value);
			return;
		}
		parsedFlags[ref.name] = [value];
		return;
	}

	parsedFlags[ref.name] = value;
}

function consumeShortToken(
	token: string,
	lookup: FlagLookup,
	state: ParseState,
): void {
	for (let index = 1; index < token.length; index++) {
		const key = token[index];
		if (!key) continue;

		const ref = lookup.shortRefs.get(key);
		if (!ref) {
			return;
		}

		if (ref.def.type === "boolean") {
			storeFlagValue(state.parsedFlags, ref, true);
			continue;
		}

		const attached = token.slice(index + 1);
		if (attached) {
			storeFlagValue(state.parsedFlags, ref, attached);
			return;
		}

		state.expectingValueFor = ref;
		return;
	}
}

function parsePriorTokens(
	command: CommandNode,
	tokens: readonly string[],
): ParseState {
	const lookup = buildFlagLookup(command.effectiveFlags);
	const state: ParseState = {
		afterDoubleDash: false,
		parsedFlags: {},
		parsedArgs: [],
	};

	for (const token of tokens) {
		if (state.expectingValueFor) {
			storeFlagValue(state.parsedFlags, state.expectingValueFor, token);
			state.expectingValueFor = undefined;
			continue;
		}

		if (state.afterDoubleDash) {
			state.parsedArgs.push(token);
			continue;
		}

		if (token === "--") {
			state.afterDoubleDash = true;
			continue;
		}

		if (token.startsWith("--")) {
			if (token.startsWith("--no-")) {
				const ref = lookup.longRefs.get(token.slice(5));
				if (ref?.def.type === "boolean") {
					storeFlagValue(state.parsedFlags, ref, false);
					continue;
				}
			}

			const separatorIndex = token.indexOf("=");
			if (separatorIndex > 2) {
				const name = token.slice(2, separatorIndex);
				const ref = lookup.longRefs.get(name);
				if (ref) {
					const value = token.slice(separatorIndex + 1);
					storeFlagValue(
						state.parsedFlags,
						ref,
						ref.def.type === "boolean" ? value !== "false" : value,
					);
					continue;
				}
			}

			const ref = lookup.longRefs.get(token.slice(2));
			if (!ref) continue;
			if (ref.def.type === "boolean") {
				storeFlagValue(state.parsedFlags, ref, true);
				continue;
			}
			state.expectingValueFor = ref;
			continue;
		}

		if (token.startsWith("-") && token !== "-") {
			consumeShortToken(token, lookup, state);
			continue;
		}

		state.parsedArgs.push(token);
	}

	return state;
}

function getNextArgDef(
	args: readonly ArgDef[] | undefined,
	parsedArgs: readonly string[],
): ArgDef | undefined {
	if (!args || args.length === 0) return undefined;
	const index = parsedArgs.length;
	const variadic = args.find((arg) => arg.variadic === true);
	if (variadic && index >= args.length - 1) {
		return args[args.length - 1];
	}
	return args[index];
}

function resolvePartialRoute(
	rootCommand: CommandNode,
	tokensBeforeCurrent: readonly string[],
): {
	command: CommandNode;
	commandPath: string[];
	remainingTokens: string[];
} {
	const commandPath = [rootCommand.meta.name];
	let command = rootCommand;
	let index = 0;

	while (index < tokensBeforeCurrent.length) {
		const token = tokensBeforeCurrent[index];
		if (!token || token.startsWith("-") || token === "--") {
			break;
		}

		const next = command.subCommands[token];
		if (next) {
			command = next;
			commandPath.push(token);
			index += 1;
			continue;
		}

		if (command.run) {
			break;
		}

		break;
	}

	return {
		command,
		commandPath,
		remainingTokens: tokensBeforeCurrent.slice(index),
	};
}

function analyzeCurrentShortToken(
	command: CommandNode,
	currentToken: string,
): { position: CompletionPosition; flagName?: string; currentValue: string } {
	const lookup = buildFlagLookup(command.effectiveFlags);
	if (!currentToken.startsWith("-") || currentToken.startsWith("--")) {
		return { position: "flag-name", currentValue: currentToken };
	}

	const currentValue = currentToken;
	for (let index = 1; index < currentToken.length; index++) {
		const key = currentToken[index];
		if (!key) continue;
		const ref = lookup.shortRefs.get(key);
		if (!ref) {
			return { position: "flag-name", currentValue };
		}

		if (ref.def.type === "boolean") {
			continue;
		}

		return {
			position: "flag-value",
			flagName: ref.name,
			currentValue: currentToken.slice(index + 1),
		};
	}

	return { position: "flag-name", currentValue };
}

function analyzeCompletion(
	rootCommand: CommandNode,
	tokensBeforeCurrent: readonly string[],
	currentToken: string,
): CompletionAnalysis {
	const route = resolvePartialRoute(rootCommand, tokensBeforeCurrent);
	const parsed = parsePriorTokens(route.command, route.remainingTokens);
	const nextArg = getNextArgDef(route.command.args, parsed.parsedArgs);
	const visibleCommands = visibleSubCommands(route.command);

	if (parsed.afterDoubleDash) {
		return {
			command: route.command,
			commandPath: route.commandPath,
			position: "arg",
			currentToken,
			currentIndex: tokensBeforeCurrent.length,
			tokensBeforeCurrent,
			parsedFlags: parsed.parsedFlags,
			parsedArgs: parsed.parsedArgs,
			arg: nextArg,
		};
	}

	if (parsed.expectingValueFor) {
		return {
			command: route.command,
			commandPath: route.commandPath,
			position: "flag-value",
			currentToken,
			currentIndex: tokensBeforeCurrent.length,
			tokensBeforeCurrent,
			parsedFlags: parsed.parsedFlags,
			parsedArgs: parsed.parsedArgs,
			flagName: parsed.expectingValueFor.name,
		};
	}

	if (currentToken.startsWith("--")) {
		const separatorIndex = currentToken.indexOf("=");
		if (separatorIndex > 2) {
			const lookup = buildFlagLookup(route.command.effectiveFlags);
			const ref = lookup.longRefs.get(currentToken.slice(2, separatorIndex));
			if (ref && ref.def.type !== "boolean") {
				return {
					command: route.command,
					commandPath: route.commandPath,
					position: "flag-value",
					currentToken: currentToken.slice(separatorIndex + 1),
					currentIndex: tokensBeforeCurrent.length,
					tokensBeforeCurrent,
					parsedFlags: parsed.parsedFlags,
					parsedArgs: parsed.parsedArgs,
					flagName: ref.name,
				};
			}
		}

		return {
			command: route.command,
			commandPath: route.commandPath,
			position: "flag-name",
			currentToken,
			currentIndex: tokensBeforeCurrent.length,
			tokensBeforeCurrent,
			parsedFlags: parsed.parsedFlags,
			parsedArgs: parsed.parsedArgs,
		};
	}

	if (currentToken.startsWith("-") && currentToken !== "-") {
		const current = analyzeCurrentShortToken(route.command, currentToken);
		return {
			command: route.command,
			commandPath: route.commandPath,
			position: current.position,
			currentToken: current.currentValue,
			currentIndex: tokensBeforeCurrent.length,
			tokensBeforeCurrent,
			parsedFlags: parsed.parsedFlags,
			parsedArgs: parsed.parsedArgs,
			flagName: current.flagName,
		};
	}

	if (!route.command.run && visibleCommands.length > 0) {
		return {
			command: route.command,
			commandPath: route.commandPath,
			position: "subcommand",
			currentToken,
			currentIndex: tokensBeforeCurrent.length,
			tokensBeforeCurrent,
			parsedFlags: parsed.parsedFlags,
			parsedArgs: parsed.parsedArgs,
		};
	}

	if (
		route.command.run &&
		visibleCommands.length > 0 &&
		parsed.parsedArgs.length === 0
	) {
		return {
			command: route.command,
			commandPath: route.commandPath,
			position: "subcommand-or-arg",
			currentToken,
			currentIndex: tokensBeforeCurrent.length,
			tokensBeforeCurrent,
			parsedFlags: parsed.parsedFlags,
			parsedArgs: parsed.parsedArgs,
			arg: nextArg,
		};
	}

	return {
		command: route.command,
		commandPath: route.commandPath,
		position: "arg",
		currentToken,
		currentIndex: tokensBeforeCurrent.length,
		tokensBeforeCurrent,
		parsedFlags: parsed.parsedFlags,
		parsedArgs: parsed.parsedArgs,
		arg: nextArg,
	};
}

async function runCompletionSource(
	source: CompletionSource | undefined,
	context: CompletionContext,
): Promise<NormalizedCompletionItem[]> {
	if (!source) return [];

	try {
		const resolved =
			typeof source === "function" ? await source(context) : source;
		const items = Array.isArray(resolved) ? resolved : [resolved];
		return items.flatMap((item) =>
			typeof item === "string" ? [{ value: item }] : [item],
		);
	} catch {
		return [];
	}
}

function filterByPrefix(
	items: readonly NormalizedCompletionItem[],
	prefix: string,
): NormalizedCompletionItem[] {
	return items.filter((item) => item.value.startsWith(prefix));
}

function dedupeItems(
	items: readonly NormalizedCompletionItem[],
): NormalizedCompletionItem[] {
	const seen = new Set<string>();
	const result: NormalizedCompletionItem[] = [];

	for (const item of items) {
		if (seen.has(item.value)) continue;
		seen.add(item.value);
		result.push(item);
	}

	return result;
}

function flagDisplayItems(command: CommandNode): NormalizedCompletionItem[] {
	const items: NormalizedCompletionItem[] = [];
	for (const [name, def] of Object.entries(command.effectiveFlags)) {
		items.push({ value: `--${name}`, description: def.description });
		for (const alias of def.aliases ?? []) {
			items.push({ value: `--${alias}`, description: def.description });
		}
		if (def.short) {
			items.push({ value: `-${def.short}`, description: def.description });
		}
		if (def.type === "boolean") {
			items.push({ value: `--no-${name}`, description: def.description });
		}
	}
	return items;
}

function subCommandItems(command: CommandNode): NormalizedCompletionItem[] {
	return visibleSubCommands(command).map(([name, subCommand]) => ({
		value: name,
		description: subCommand.meta.description,
	}));
}

function formatCompletionItems(
	items: readonly NormalizedCompletionItem[],
): string[] {
	return items.map((item) =>
		item.description ? `${item.value}\t${item.description}` : item.value,
	);
}

export async function generateCompletionCandidates(params: {
	rootCommand: CommandNode;
	shell: CompletionShell;
	tokensBeforeCurrent: readonly string[];
	currentToken: string;
}): Promise<string[]> {
	const analysis = analyzeCompletion(
		params.rootCommand,
		params.tokensBeforeCurrent,
		params.currentToken,
	);
	const context: CompletionContext = {
		shell: params.shell,
		command: analysis.command,
		commandPath: analysis.commandPath,
		position: analysis.position,
		tokensBeforeCurrent: analysis.tokensBeforeCurrent,
		currentToken: analysis.currentToken,
		currentIndex: analysis.currentIndex,
		parsedFlags: analysis.parsedFlags,
		parsedArgs: analysis.parsedArgs,
		flagName: analysis.flagName,
		arg: analysis.arg,
	};

	const items: NormalizedCompletionItem[] = [];

	if (
		analysis.position === "subcommand" ||
		analysis.position === "subcommand-or-arg"
	) {
		items.push(...subCommandItems(analysis.command));
	}

	if (analysis.position === "flag-name") {
		items.push(...flagDisplayItems(analysis.command));
	}

	if (
		analysis.position === "arg" ||
		analysis.position === "subcommand-or-arg"
	) {
		const source = getCompletionSource(analysis.arg);
		items.push(...(await runCompletionSource(source, context)));
		if (!source && analysis.arg?.type === "boolean") {
			items.push({ value: "true" }, { value: "false" });
		}
	}

	if (analysis.position === "flag-value" && analysis.flagName) {
		const flagDef = analysis.command.effectiveFlags[analysis.flagName];
		const source = getCompletionSource(flagDef);
		items.push(...(await runCompletionSource(source, context)));
	}

	return formatCompletionItems(
		dedupeItems(filterByPrefix(items, analysis.currentToken)),
	);
}
