import { CrustError } from "../errors.ts";
import type { ArgDef, FlagDef, FlagsDef, NamedFlagDef } from "../types.ts";

// Compile-time brands (FIX_EMPTY_SPELLING, FIX_NO_PREFIX) own literal
// definitions; this guard owns the dynamic path (config-built flag defs).
// Empty spellings register flags no argv token can address; "no-" spellings
// collide with boolean negation (the parser inverts every `--no-` rawName).
function assertUsableSpelling(spelling: string, kind: "canonical" | "short" | "alias"): void {
	if (spelling === "") {
		throw new CrustError("DEFINITION", `Flag ${kind} spellings must be non-empty`, {
			subject: "flag",
			name: spelling,
			reason: "empty-spelling",
		});
	}
	if (kind !== "short" && spelling.startsWith("no-")) {
		throw new CrustError(
			"DEFINITION",
			`Flag ${kind} "${spelling}" must not start with "no-"; the prefix is reserved for boolean negation`,
			{ subject: "flag", name: spelling, reason: "reserved-no-prefix" },
		);
	}
	// A `__proto__` key never becomes an own property of the plain records the
	// parser and snapshots iterate — it swaps their prototype instead.
	if (spelling === "__proto__") {
		throw new CrustError("DEFINITION", `Flag ${kind} "__proto__" is a reserved spelling`, {
			subject: "flag",
			name: spelling,
			reason: "reserved-spelling",
		});
	}
}

/** All canonical, short, and alias spellings carried by a flag definition. */
export function flagSpellings(name: string, def: FlagDef): string[] {
	return [name, ...(def.short === undefined ? [] : [def.short]), ...(def.aliases ?? [])];
}

export interface FlagSpelling {
	canonicalName: string;
	def: FlagDef;
	kind: "canonical" | "short" | "alias";
	negatable: boolean;
}

/** Whether a flag accepts generated `--no-` spellings. */
export function isFlagNegatable(def: FlagDef): boolean {
	return def.type === "boolean" && def.noNegate !== true;
}

/** Convert named authoring definitions to the runtime flag record. */
export function toFlagsRecord(definitions: readonly NamedFlagDef[]): FlagsDef {
	const flags: FlagsDef = {};
	const seen = new Set<string>();
	for (const definition of definitions) {
		const { name, ...flag } = definition;
		const normalized = normalizeFlag(name, flag);
		for (const spelling of flagSpellings(name, normalized)) {
			if (seen.has(spelling)) {
				throw new CrustError("DEFINITION", `Flag "${name}" collides with an existing flag`, {
					subject: "flag",
					name,
					reason: "flag-collision",
				});
			}
			seen.add(spelling);
		}
		flags[name] = normalized;
	}
	return flags;
}

/** Copy only definition-owned collections, not JSON/URL/schema payloads. */
export function ownDefinition<const D extends ArgDef | FlagDef>(def: D): D {
	if (def.choices && def.default !== undefined) {
		const values = "multiple" in def && def.multiple ? def.default : [def.default];
		for (const value of values) {
			if (!def.choices.includes(value)) {
				throw new CrustError("DEFINITION", "default must be one of choices");
			}
		}
	}
	return Object.freeze({
		...def,
		...("aliases" in def && def.aliases ? { aliases: Object.freeze([...def.aliases]) } : {}),
		...(def.choices ? { choices: Object.freeze([...def.choices]) } : {}),
		...("multiple" in def && def.multiple && Array.isArray(def.default)
			? { default: Object.freeze([...def.default]) }
			: {}),
	});
}

export function normalizeFlag<const D extends FlagDef>(name: string, def: D): D {
	assertUsableSpelling(name, "canonical");
	if (def.short !== undefined) assertUsableSpelling(def.short, "short");
	for (const alias of def.aliases ?? []) assertUsableSpelling(alias, "alias");
	const spellings = flagSpellings(name, def);
	if (new Set(spellings).size !== spellings.length) {
		throw new CrustError("DEFINITION", `Flag "${name}" repeats one of its own spellings`, {
			subject: "flag",
			name,
			reason: "flag-collision",
		});
	}
	if (def.short !== undefined && def.short.length !== 1) {
		throw new CrustError("DEFINITION", "Short flags must be one character");
	}
	return ownDefinition(def);
}

export function normalizeArg<const D extends ArgDef>(def: D): D {
	if (def.name === "") {
		throw new CrustError("DEFINITION", "Argument names must be non-empty", {
			subject: "argument",
			name: def.name,
			reason: "empty-name",
		});
	}
	return ownDefinition(def);
}
