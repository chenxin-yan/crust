import { CrustError } from "../errors.ts";
import type { FlagDef, FlagsDef, ValueType } from "../types.ts";
import { schemaExclusivity } from "./args.rules.ts";

interface FlagDefinition {
	readonly type: ValueType;
	readonly short?: string;
	readonly aliases?: readonly string[];
}

const ALLOWED_FLAG_TYPES: ReadonlySet<ValueType> = new Set([
	"string",
	"number",
	"boolean",
	"url",
	"path",
	"json",
]);
const ALLOWED_FLAG_TYPES_TEXT = [...ALLOWED_FLAG_TYPES]
	.map((type) => `"${type}"`)
	.join(", ")
	.replace(/, (?="[^"]+"$)/, ", or ");

export function flagDefinitionSpellings(name: string, def: FlagDefinition): string[] {
	return [name, ...(def.short ? [def.short] : []), ...(def.aliases ?? [])];
}

/** A flag definition must carry a non-empty name. */
export function nonEmptyName(name: string): void {
	if (typeof name === "string" && name.length > 0) return;
	throw new CrustError("DEFINITION", "Every flag definition must carry a non-empty name", {
		subject: "flag",
		reason: "missing-name",
	});
}

/**
 * The `no-` prefix is reserved for boolean negation.
 *
 * `scope` lets callers interleave `parserType` between the name check and the
 * short/alias checks, preserving the pre-split error precedence for
 * definitions that violate several rules at once.
 */
export function noPrefix(
	name: string,
	def: FlagDefinition,
	ownerLabel?: string,
	scope: "all" | "name" | "spellings" = "all",
): void {
	const subject = ownerLabel ? `${ownerLabel} flag "--${name}"` : `Flag "--${name}"`;
	if (scope !== "spellings" && name.startsWith("no-")) {
		const base = name.slice(3);
		throw new CrustError(
			"DEFINITION",
			`${subject} must not use "no-" prefix; define "${base}" and negate with "--no-${base}"`,
		);
	}
	if (scope === "name") return;
	if (def.short?.startsWith("no-")) {
		throw new CrustError(
			"DEFINITION",
			`${ownerLabel ? `${ownerLabel} short` : "Short"} alias "-${def.short}" on "--${name}" must not use "no-" prefix (reserved for negation)`,
		);
	}
	for (const alias of def.aliases ?? []) {
		if (alias.startsWith("no-")) {
			throw new CrustError(
				"DEFINITION",
				`${ownerLabel ? `${ownerLabel} alias` : "Alias"} "--${alias}" on "--${name}" must not use "no-" prefix (reserved for negation)`,
			);
		}
	}
}

/** A flag must declare one of the parser's supported token types. */
export function parserType(name: string, def: FlagDefinition, ownerLabel?: string): void {
	if (ALLOWED_FLAG_TYPES.has(def.type)) return;
	const subject = ownerLabel ? `${ownerLabel} flag "--${name}"` : `Flag "--${name}"`;
	throw new CrustError(
		"DEFINITION",
		`${subject} must declare a parser type (${ALLOWED_FLAG_TYPES_TEXT})`,
	);
}

/** `__proto__` cannot safely be stored in plain-object flag records. */
export function reservedSpelling(name: string, def: FlagDefinition, ownerLabel?: string): void {
	if (!flagDefinitionSpellings(name, def).includes("__proto__")) return;
	const subject = ownerLabel ? `${ownerLabel} flag "--${name}"` : `Flag "--${name}"`;
	throw new CrustError("DEFINITION", `${subject} uses reserved spelling "__proto__"`, {
		subject: "flag",
		name,
		reason: "reserved-name",
	});
}

/** Canonical names and aliases share one namespace. */
export function aliasCollision(
	incoming: { name: string; def: FlagDef },
	existing: FlagsDef,
	ownerLabel: string,
): void {
	const subject = `${ownerLabel} flag "--${incoming.name}"`;
	const incomingSpellings = flagDefinitionSpellings(incoming.name, incoming.def);
	const duplicate = incomingSpellings.find(
		(spelling, index) => incomingSpellings.indexOf(spelling) !== index,
	);
	if (duplicate !== undefined) {
		throw new CrustError("DEFINITION", `${subject} repeats spelling "${duplicate}"`, {
			subject: "flag",
			name: incoming.name,
			reason: "flag-collision",
		});
	}
	schemaExclusivity("flag", incoming.name, incoming.def);
	for (const [existingName, existingDef] of Object.entries(existing)) {
		const existingSpellings = new Set(flagDefinitionSpellings(existingName, existingDef));
		const collision = incomingSpellings.find((spelling) => existingSpellings.has(spelling));
		if (collision !== undefined) {
			throw new CrustError(
				"DEFINITION",
				`${subject} spelling "${collision}" collides with flag "--${existingName}"`,
				{ subject: "flag", name: incoming.name, reason: "flag-collision" },
			);
		}
	}
}
