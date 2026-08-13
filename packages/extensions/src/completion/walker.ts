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
	const stripped = sanitizeFreeText(Bun.stripANSI(value)).trim();
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

	// url/path/json all consume a string token at the shell-completion layer.
	// We normalise them to `"string"` and surface the original kind via a
	// single `valueCompletion` field so templates can branch on intent
	// ("files" / "none") rather than the source type literal.
	const sourceType = def.type;
	const specType: "string" | "number" | "boolean" =
		sourceType === "url" || sourceType === "path" || sourceType === "json" ? "string" : sourceType;

	const flag: CompletionFlag = {
		name,
		type: specType,
		takesValue: sourceType !== "boolean",
	};

	if (sourceType === "path") flag.valueCompletion = "files";
	else if (sourceType === "url" || sourceType === "json") flag.valueCompletion = "none";

	if (def.short !== undefined && def.short.length > 0) {
		flag.short = def.short;
	}
	if (aliases !== undefined && aliases.length > 0) {
		flag.aliases = aliases;
	}

	const description = normaliseDescription(def.description);
	if (description !== undefined) {
		flag.description = description;
	}

	if (def.multiple === true) {
		flag.multiple = true;
	}

	// `noNegate` is a `boolean`-flag-only opt-out from auto `--no-<name>`
	// rendering; it lives on both single and multi boolean variants in
	// core's `FlagDef` discriminated union.
	if (def.type === "boolean" && def.noNegate === true) {
		flag.noNegate = true;
	}

	// `choices` lives only on string-typed flags (see `types.ts`).
	// We accept the field via discriminated narrowing rather than an `as`
	// cast to keep the reader honest about which branches actually carry it.
	if (def.type === "string") {
		const choices = def.choices;
		if (choices !== undefined && choices.length > 0) {
			flag.choices = choices.map(assertSafeChoiceValue);
		}
	}

	return flag;
}

/** Project a single `ArgDef` onto a `CompletionArg`. */
function walkArg(def: ArgSnapshot): CompletionArg {
	assertSafeIdentifier(def.name, "arg name");
	const sourceType = def.type;
	const specType: "string" | "number" | "boolean" =
		sourceType === "url" || sourceType === "path" || sourceType === "json"
			? "string"
			: (sourceType ?? "string");

	const arg: CompletionArg = {
		name: def.name,
		type: specType,
		required: def.required === true,
		variadic: def.variadic === true,
	};

	if (sourceType === "path") arg.valueCompletion = "files";
	else if (sourceType === "url" || sourceType === "json") arg.valueCompletion = "none";

	const description = normaliseDescription(def.description);
	if (description !== undefined) {
		arg.description = description;
	}

	// `choices` is only present on string-typed args.
	if (def.type === "string") {
		const choices = def.choices;
		if (choices !== undefined && choices.length > 0) {
			arg.choices = choices.map(assertSafeChoiceValue);
		}
	}

	return arg;
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
