import type { CommandSnapshot, ValueType } from "@crustjs/core";
import {
	buildCommandDocumentation,
	type CommandDocumentation,
	type DocumentationArg,
	type DocumentationFlag,
} from "@crustjs/core/tooling";

import { completerOf } from "./complete.ts";
import { assertSafeChoiceValue, assertSafeIdentifier, sanitizeFreeText } from "./escape.ts";
import type { CompletionArg, CompletionCommand, CompletionFlag, StringCompletion } from "./spec.ts";

/**
 * Normalise an optional description: strip ANSI, then drop empty results.
 * Returning `undefined` (rather than `""`) makes templates' presence checks
 * easy and keeps generated scripts tidy.
 */
function normaliseDescription(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const stripped = sanitizeFreeText(
		process.getBuiltinModule("node:util").stripVTControlCharacters(value),
	).trim();
	return stripped.length === 0 ? undefined : stripped;
}

type ValueShape =
	| { type: "boolean" }
	| { type: "number" }
	| ({ type: "string" } & StringCompletion);

/**
 * Map a Core value type onto its completion shape. url/path/json consume
 * string tokens but keep their completion intent; schema-backed args
 * (`undefined`) complete as free-form strings. A count takes no value, as a boolean.
 */
function valueShape(
	type: ValueType | "count" | undefined,
	choices: readonly string[] | undefined,
): ValueShape {
	switch (type) {
		case "boolean":
		case "number":
			return { type };
		case "count":
			return { type: "boolean" };
		case "integer":
			return { type: "number" };
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

/** The `complete` address of the definition at `target` when `command` has a completer for it. */
function completeAddress(
	command: CommandSnapshot,
	node: CommandDocumentation,
	target: string,
): { complete?: string } {
	return completerOf(command, target) === undefined
		? {}
		: { complete: [...node.path, target].join(" ") };
}

/**
 * Project a single documentation flag onto a `CompletionFlag`. A short may be any
 * character Core accepts (ripgrep's `-.`): the templates quote spellings for their shell.
 */
function walkFlag(
	def: DocumentationFlag,
	command: CommandSnapshot,
	node: CommandDocumentation,
): CompletionFlag {
	assertSafeIdentifier(def.name, "flag name");
	for (const alias of def.aliases) assertSafeIdentifier(alias, "flag alias");

	const description = normaliseDescription(def.description);
	const common = {
		name: def.name,
		spellings: def.spellings,
		...(description === undefined ? {} : { description }),
		...(def.multiple || def.type === "count" ? { multiple: true as const } : {}),
	};

	const shape = valueShape(def.type, def.choices);
	return shape.type === "boolean"
		? { ...common, ...shape, takesValue: false }
		: { ...common, ...shape, ...completeAddress(command, node, `--${def.name}`), takesValue: true };
}

/** Project a single documentation argument onto a `CompletionArg`. */
function walkArg(
	def: DocumentationArg,
	command: CommandSnapshot,
	node: CommandDocumentation,
): CompletionArg {
	assertSafeIdentifier(def.name, "arg name");
	const description = normaliseDescription(def.description);
	return {
		name: def.name,
		required: def.required,
		variadic: def.variadic,
		...(description === undefined ? {} : { description }),
		...valueShape(def.type, def.choices),
		...completeAddress(command, node, def.name),
	};
}

/** Build the completion model of a root Command Snapshot's visible tree. */
export function walkCommand(root: CommandSnapshot): CompletionCommand {
	return walkNode(root, buildCommandDocumentation(root));
}

function walkNode(command: CommandSnapshot, node: CommandDocumentation): CompletionCommand {
	assertSafeIdentifier(node.name, "command name");
	for (const alias of node.aliases) {
		assertSafeIdentifier(alias, "command alias");
	}
	const flags = node.flags.map((flag) => walkFlag(flag, command, node));
	const args = node.args.map((arg) => walkArg(arg, command, node));
	const subCommands = node.children.map((child) =>
		walkNode(command.subCommands[child.path.at(-1)!]!, child),
	);

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
