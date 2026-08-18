import type { ContextInstance } from "../api/context.ts";
import { addFlagSpellingEntries, type FlagSpelling } from "../parsing/spellings.ts";
import type { ArgDef, ArgsDef, FlagDef, FlagsDef } from "../types.ts";
import {
	asyncParse,
	defaultWithinChoices,
	duplicateArg,
	nonEmptyName,
	schemaExclusivity,
	variadicPosition,
} from "./args.rules.ts";
import { definitionProvenance, duplicateContext } from "./contexts.rules.ts";
import { aliasCollision, noPrefix, parserType, reservedSpelling } from "./flags.rules.ts";

/**
 * Normalize one raw flag before adding it to a trusted flag namespace.
 *
 * Per-definition rules re-run even for Context/Extension-owned flags:
 * `Extension` and `ContextInstance` are public structural types, so a
 * hand-written object (never passed through `defineExtension`/`defineContext`)
 * typechecks and would otherwise inject unvalidated definitions. Attachment
 * runs once per prepare/provide, so the re-check is off the parse hot path.
 */
export function normalizeFlag(
	incoming: { name: string; def: FlagDef },
	existing: FlagsDef,
	spellings: Map<string, FlagSpelling>,
	ownerLabel: string,
): void {
	nonEmptyName(incoming.name, "flag");
	noPrefix(incoming.name, incoming.def, ownerLabel, "name");
	parserType(incoming.name, incoming.def, ownerLabel);
	noPrefix(incoming.name, incoming.def, ownerLabel, "spellings");
	reservedSpelling(incoming.name, incoming.def, ownerLabel);
	aliasCollision(incoming, existing, ownerLabel);
	asyncParse(incoming.def.parse, "flag", incoming.name);
	defaultWithinChoices(incoming.def, `--${incoming.name}`, "flag", incoming.name);
	addFlagSpellingEntries(spellings, incoming.name, incoming.def);
}

/** Normalize positional arguments as one ordered definition. */
export function normalizeArgs(existing: ArgsDef | undefined, incoming: ArgsDef): ArgsDef {
	const prior = existing ?? [];
	const added = incoming.map((def) => ({ ...def })) as ArgsDef;
	const args = [...prior, ...added] as ArgsDef;
	const names = new Set(prior.map((def) => def.name));

	// Appending can invalidate the previous tail: only the last arg may be
	// variadic, so re-check just that one prior def alongside the new ones.
	const firstAffected = added.length > 0 && prior.length > 0 ? prior.length - 1 : prior.length;
	for (let index = firstAffected; index < args.length; index++) {
		const def = args[index]!;
		if (index >= prior.length) {
			const name = def.name;
			nonEmptyName(name, "arg");
			duplicateArg(name, names);
			names.add(name);
			schemaExclusivity("arg", name, def as ArgDef);
			asyncParse(def.parse, "arg", name);
			defaultWithinChoices(def, `<${name}>`, "arg", name);
		}
		variadicPosition(def, index, args.length);
	}
	return args;
}

/** Normalize one Context batch. */
export function normalizeContext(
	incoming: readonly ContextInstance[],
	existing: readonly ContextInstance[],
	effectiveFlags: FlagsDef,
	spellings: Map<string, FlagSpelling>,
	where: string,
): ContextInstance[] {
	const contexts = [...existing];
	for (const instance of incoming) {
		definitionProvenance(instance);
		duplicateContext(instance, contexts, where);
		for (const [name, def] of Object.entries(instance.ownedFlags)) {
			normalizeFlag({ name, def }, effectiveFlags, spellings, `Context "${instance.name}"`);
			effectiveFlags[name] = def;
		}
		contexts.push(instance);
	}
	return contexts;
}
