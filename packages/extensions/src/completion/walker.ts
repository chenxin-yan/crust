import { stripVTControlCharacters } from "node:util";

import type { ValueType } from "@crustjs/core";
import type {
	CommandDocumentation,
	DocumentationArg,
	DocumentationFlag,
} from "@crustjs/core/tooling";

import { assertSafeChoiceValue, assertSafeIdentifier, sanitizeFreeText } from "./escape.ts";
import type { CompletionArg, CompletionCommand, CompletionFlag, StringCompletion } from "./spec.ts";

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

type ValueShape =
	| { type: "boolean" }
	| { type: "number" }
	| ({ type: "string" } & StringCompletion);

/**
 * Map a Core value type onto its completion shape. url/path/json consume
 * string tokens but keep their completion intent; schema-backed args
 * (`undefined`) complete as free-form strings.
 */
function valueShape(
	type: ValueType | undefined,
	choices: readonly string[] | undefined,
): ValueShape {
	switch (type) {
		case "boolean":
		case "number":
			return { type };
		case "path":
			return { type: "string", valueCompletion: "files" };
		case "url":
		case "json":
			return { type: "string", valueCompletion: "none" };
		case "string":
			return choices !== undefined && choices.length > 0
				? { type: "string", choices: choices.map(assertSafeChoiceValue) }
				: { type: "string" };
		case undefined:
			return { type: "string" };
	}
}

/**
 * Project a single documentation flag onto a `CompletionFlag`.
 */
function walkFlag(def: DocumentationFlag): CompletionFlag {
	assertSafeIdentifier(def.name, "flag name");
	for (const alias of def.aliases) assertSafeIdentifier(alias, "flag alias");
	if (def.short !== undefined) assertSafeIdentifier(def.short, "flag short alias");

	const description = normaliseDescription(def.description);
	const common = {
		name: def.name,
		...(def.short === undefined ? {} : { short: def.short }),
		...(def.aliases.length > 0 ? { aliases: def.aliases } : {}),
		...(description === undefined ? {} : { description }),
		...(def.multiple ? { multiple: true as const } : {}),
		negatable: def.negatable,
	};

	const shape = valueShape(def.type, def.choices);
	return shape.type === "boolean"
		? { ...common, ...shape, takesValue: false }
		: { ...common, ...shape, takesValue: true };
}

/** Project a single documentation argument onto a `CompletionArg`. */
function walkArg(def: DocumentationArg): CompletionArg {
	assertSafeIdentifier(def.name, "arg name");
	const description = normaliseDescription(def.description);
	return {
		name: def.name,
		required: def.required,
		variadic: def.variadic,
		...(description === undefined ? {} : { description }),
		...valueShape(def.type, def.choices),
	};
}

/**
 * Build a completion command from the shared documentation model.
 */
export function walkCommand(node: CommandDocumentation): CompletionCommand {
	assertSafeIdentifier(node.name, "command name");
	for (const alias of node.aliases) {
		assertSafeIdentifier(alias, "command alias");
	}
	const flags = node.flags.map(walkFlag);
	const args = node.args.map(walkArg);
	const subCommands = node.children.map(walkCommand);

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
