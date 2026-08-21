import { stripVTControlCharacters } from "node:util";

import type { ArgSnapshot, CommandSnapshot, FlagSnapshot } from "@crustjs/core";

import { assertSafeChoiceValue, assertSafeIdentifier, sanitizeFreeText } from "./escape.ts";
import type { CompletionArg, CompletionCommand, CompletionFlag } from "./spec.ts";

/**
 * Normalise an optional description: strip ANSI, then drop empty results.
 * Returning `undefined` (rather than `""`) makes templates' presence checks
 * easy and keeps generated scripts tidy.
 */
function normaliseDescription(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const stripped = sanitizeFreeText(stripVTControlCharacters(value)).trim();
	return stripped.length === 0 ? undefined : stripped;
}

/**
 * Project a single `FlagDef` (keyed by `name` in the snapshot `flags`) onto a
 * `CompletionFlag`. The walker calls this for every entry of every visible
 * command's `flags` map so propagating flags surface at the right
 * depth.
 */
function walkFlag(name: string, def: FlagSnapshot): CompletionFlag {
	assertSafeIdentifier(name, "flag name");
	const aliases = def.aliases?.filter((alias) => alias.length > 0);
	if (aliases !== undefined) {
		for (const alias of aliases) assertSafeIdentifier(alias, "flag alias");
	}
	if (def.short !== undefined && def.short.length > 0) {
		assertSafeIdentifier(def.short, "flag short alias");
	}

	const description = normaliseDescription(def.description);
	const common = {
		name,
		...(def.short !== undefined && def.short.length > 0 ? { short: def.short } : {}),
		...(aliases !== undefined && aliases.length > 0 ? { aliases } : {}),
		...(description === undefined ? {} : { description }),
		...(def.multiple === true ? { multiple: true as const } : {}),
	};

	if (def.type === "boolean") {
		return {
			...common,
			type: "boolean",
			takesValue: false,
			...(def.noNegate === true ? { noNegate: true as const } : {}),
		};
	}
	if (def.type === "number") return { ...common, type: "number", takesValue: true };

	// url/path/json all consume string tokens; preserve their completion intent.
	if (def.type === "path") {
		return { ...common, type: "string", takesValue: true, valueCompletion: "files" };
	}
	if (def.type === "url" || def.type === "json") {
		return { ...common, type: "string", takesValue: true, valueCompletion: "none" };
	}

	const choices = def.choices;
	if (choices !== undefined && choices.length > 0) {
		return {
			...common,
			type: "string",
			takesValue: true,
			choices: choices.map(assertSafeChoiceValue),
		};
	}
	return { ...common, type: "string", takesValue: true };
}

/** Project a single `ArgDef` onto a `CompletionArg`. */
function walkArg(def: ArgSnapshot): CompletionArg {
	assertSafeIdentifier(def.name, "arg name");
	const description = normaliseDescription(def.description);
	const common = {
		name: def.name,
		required: def.required === true,
		variadic: def.variadic === true,
		...(description === undefined ? {} : { description }),
	};

	if (def.type === "number" || def.type === "boolean") {
		return { ...common, type: def.type };
	}
	if (def.type === "path") {
		return { ...common, type: "string", valueCompletion: "files" };
	}
	if (def.type === "url" || def.type === "json") {
		return { ...common, type: "string", valueCompletion: "none" };
	}

	const choices = def.type === "string" ? def.choices : undefined;
	if (choices !== undefined && choices.length > 0) {
		return { ...common, type: "string", choices: choices.map(assertSafeChoiceValue) };
	}
	return { ...common, type: "string" };
}

/**
 * Build a completion command from a `CommandSnapshot`, recursively filtering
 * hidden subcommands at every level.
 */
export function walkCommandNode(node: CommandSnapshot): CompletionCommand {
	assertSafeIdentifier(node.meta.name, "command name");
	const nodeAliases = node.meta.aliases;
	if (nodeAliases !== undefined) {
		for (const alias of nodeAliases) {
			assertSafeIdentifier(alias, "command alias");
		}
	}
	const flags: CompletionFlag[] = [];
	for (const [flagName, flagDef] of Object.entries(node.flags)) {
		flags.push(walkFlag(flagName, flagDef));
	}

	const args: CompletionArg[] = [];
	for (const argDef of node.args) {
		args.push(walkArg(argDef));
	}

	const subCommands: CompletionCommand[] = [];
	for (const subNode of Object.values(node.subCommands)) {
		// Mirror the help renderer's contract: skip listing-hidden nodes.
		// Routing in `packages/core/src/command/router.ts` still resolves them by
		// direct name — they are only invisible to enumeration.
		if (subNode.meta.hidden === true) continue;
		subCommands.push(walkCommandNode(subNode));
	}

	const result: CompletionCommand = {
		name: node.meta.name,
		flags,
		args,
		subCommands,
	};

	const aliases = node.meta.aliases;
	if (aliases !== undefined && aliases.length > 0) {
		// `CommandMeta.aliases` is `readonly string[] | undefined`. Preserve
		// readonly-ness; template code only needs to enumerate.
		result.aliases = aliases;
	}

	const description = normaliseDescription(node.meta.description);
	if (description !== undefined) {
		result.description = description;
	}

	return result;
}
