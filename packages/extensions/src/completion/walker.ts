import { stripVTControlCharacters } from "node:util";

import type {
	CommandDocumentation,
	DocumentationArg,
	DocumentationFlag,
} from "@crustjs/core/tooling";

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
 * Project a single documentation flag onto a `CompletionFlag`.
 */
function walkFlag(def: DocumentationFlag): CompletionFlag {
	assertSafeIdentifier(def.name, "flag name");
	const aliases = def.aliases.filter((alias) => alias.length > 0);
	for (const alias of aliases) assertSafeIdentifier(alias, "flag alias");
	if (def.short !== undefined && def.short.length > 0) {
		assertSafeIdentifier(def.short, "flag short alias");
	}

	const description = normaliseDescription(def.description);
	const common = {
		name: def.name,
		...(def.short !== undefined && def.short.length > 0 ? { short: def.short } : {}),
		...(aliases.length > 0 ? { aliases } : {}),
		...(description === undefined ? {} : { description }),
		...(def.multiple ? { multiple: true as const } : {}),
		negatable: def.negatable,
	};

	if (def.type === "boolean") {
		return {
			...common,
			type: "boolean",
			takesValue: false,
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

/** Project a single documentation argument onto a `CompletionArg`. */
function walkArg(def: DocumentationArg): CompletionArg {
	assertSafeIdentifier(def.name, "arg name");
	const description = normaliseDescription(def.description);
	const common = {
		name: def.name,
		required: def.required,
		variadic: def.variadic,
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
 * Build a completion command from the shared documentation model.
 */
export function walkCommandNode(node: CommandDocumentation): CompletionCommand {
	assertSafeIdentifier(node.name, "command name");
	for (const alias of node.aliases) {
		assertSafeIdentifier(alias, "command alias");
	}
	const flags = node.flags.map(walkFlag);
	const args = node.args.map(walkArg);
	const subCommands = node.children.map(walkCommandNode);

	const result: CompletionCommand = {
		name: node.name,
		flags,
		args,
		subCommands,
	};

	if (node.aliases.length > 0) {
		result.aliases = node.aliases;
	}

	const description = normaliseDescription(node.description);
	if (description !== undefined) {
		result.description = description;
	}

	return result;
}
