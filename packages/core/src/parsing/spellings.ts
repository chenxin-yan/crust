import { CrustError } from "../errors.ts";
import type { ArgDef, FlagDef, FlagsDef } from "../types.ts";

// Array-index keys (below 2 ** 32 - 1) are enumerated first, ahead of insertion order. Every
// canonical decimal integer (`0`, or digits without a leading zero) is rejected at any length;
// `01` is not one and keeps its insertion order.
const INTEGER_LIKE = /^(0|[1-9]\d*)$/;

/**
 * Child command names and aliases are matched against a single argv token: one
 * without whitespace that does not start with `-`, which would make it a flag.
 * Flag spellings follow the same rule, since the parser adds their dashes.
 */
export function isBareToken(token: string): boolean {
	return token !== "" && !/[ \t\n\r\v\f]/.test(token) && !token.startsWith("-");
}

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
	// Records list integer-like keys first, so help and snapshots would reorder the flag.
	if (kind === "canonical" && INTEGER_LIKE.test(spelling)) {
		throw new CrustError(
			"DEFINITION",
			`Flag name "${spelling}" must not be integer-like; JavaScript reorders such keys`,
			{ subject: "flag", name: spelling, reason: "integer-like-name" },
		);
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
	// `--a=b` splits at `=`, so a long spelling containing it can never be matched.
	if (!isBareToken(spelling) || (kind !== "short" && spelling.includes("="))) {
		throw new CrustError(
			"DEFINITION",
			`Flag ${kind} "${spelling}" must not contain whitespace${kind === "short" ? "" : ' or "="'} or start with "-"`,
			{ subject: "flag", name: spelling, reason: "invalid-spelling" },
		);
	}
}

/** All canonical, short, and alias spellings carried by a flag definition. */
export function flagSpellings(name: string | undefined, def: FlagDef): string[] {
	return [
		...(name === undefined ? [] : [name]),
		...(def.short === undefined ? [] : [def.short]),
		...(def.aliases ?? []),
	];
}

/**
 * One spelling of an effective flag. Entries are immutable and `def` is the
 * same object as `node.effectiveFlags[canonicalName]`, so node clones may
 * share entries and only copy the Map container. Writers (`registerFlag`)
 * always create fresh entries; never mutate one in place.
 */
export interface FlagSpelling {
	readonly canonicalName: string;
	readonly def: FlagDef;
	readonly kind: "canonical" | "short" | "alias";
	readonly negatable: boolean;
}

/** Whether a flag accepts generated `--no-` spellings: a boolean with `default: true` or `negatable: true`. */
export function isFlagNegatable(def: FlagDef): boolean {
	return def.type === "boolean" && (def.default === true || def.negatable === true);
}

/** Whether a flag reads a value; a boolean or a count is complete by its spelling. */
export function flagTakesValue(def: FlagDef): boolean {
	return def.type !== "boolean" && def.type !== "count";
}

/**
 * Read the `[name, def]` entries of a `.flags()` call: exactly one plain-object
 * record keyed by canonical name. Only own enumerable string keys count.
 */
export function flagRecordEntries(
	record: object,
): readonly (readonly [name: string, def: FlagDef])[] {
	// A `Record`-typed literal can hold `{ __proto__: def }`, which sets the prototype instead of adding a key.
	if (process.env.CRUST_INTERNAL_BUILD !== "1") {
		const proto: unknown = Object.getPrototypeOf(record);
		if (proto !== Object.prototype && proto !== null) {
			throw new CrustError(
				"DEFINITION",
				".flags() expects a plain object record; a `__proto__` key sets its prototype instead of naming a flag",
				{ subject: "flag", reason: "invalid-flags" },
			);
		}
	}
	return Object.entries(record) as [string, FlagDef][];
}

/** Convert flag entries to the runtime flag record, rejecting spelling collisions. */
export function toFlagsRecord(
	entries: readonly (readonly [name: string, def: FlagDef])[],
	initial: Readonly<FlagsDef> = {},
): FlagsDef {
	const flags: FlagsDef = { ...initial };
	for (const [name, flag] of entries) flags[name] = normalizeFlag(name, flag);
	if (process.env.CRUST_INTERNAL_BUILD !== "1") checkSpellingCollisions(entries, initial);
	return flags;
}

function checkSpellingCollisions(
	entries: readonly (readonly [name: string, def: FlagDef])[],
	initial: Readonly<FlagsDef>,
): void {
	const seen = new Set(Object.entries(initial).flatMap(([name, def]) => flagSpellings(name, def)));
	for (const [name, flag] of entries) {
		for (const spelling of flagSpellings(name, flag)) {
			if (seen.has(spelling)) {
				throw new CrustError("DEFINITION", `Flag "${name}" collides with an existing flag`, {
					subject: "flag",
					name,
					reason: "flag-collision",
				});
			}
			seen.add(spelling);
		}
	}
}

/** Copy only definition-owned collections, not JSON/URL/schema payloads. */
export function ownDefinition<const D extends ArgDef | FlagDef>(def: D): D {
	return Object.freeze({
		...def,
		...("aliases" in def && def.aliases ? { aliases: Object.freeze([...def.aliases]) } : {}),
		...(def.choices ? { choices: Object.freeze([...def.choices]) } : {}),
		...("env" in def && typeof def.env === "object" ? { env: Object.freeze([...def.env]) } : {}),
		...("multiple" in def && def.multiple && Array.isArray(def.default)
			? { default: Object.freeze([...def.default]) }
			: {}),
	});
}

// `name` is undefined for a name-less `defineFlag(def)`; attachment re-normalizes under its key.
export function normalizeFlag<const D extends FlagDef>(name: string | undefined, def: D): D {
	if (process.env.CRUST_INTERNAL_BUILD !== "1") checkFlagStrings(name, def);
	return ownDefinition(def);
}

function checkFlagStrings(name: string | undefined, def: FlagDef): void {
	const label = name === undefined ? "Flag" : `Flag "${name}"`;
	const named = name === undefined ? {} : { name };
	if (name !== undefined) assertUsableSpelling(name, "canonical");
	if (def.short !== undefined) assertUsableSpelling(def.short, "short");
	for (const alias of def.aliases ?? []) assertUsableSpelling(alias, "alias");
	const spellings = flagSpellings(name, def);
	if (new Set(spellings).size !== spellings.length) {
		throw new CrustError("DEFINITION", `${label} repeats one of its own spellings`, {
			subject: "flag",
			...named,
			reason: "flag-collision",
		});
	}
	// One code point: an astral short is two UTF-16 units.
	if (def.short !== undefined && !/^.$/su.test(def.short)) {
		throw new CrustError("DEFINITION", `${label} short "${def.short}" must be one character`, {
			subject: "flag",
			...named,
			reason: "invalid-short",
		});
	}
	if ([def.env ?? []].flat().some((variable) => variable === "")) {
		throw new CrustError("DEFINITION", `${label} env variable name must be non-empty`, {
			subject: "flag",
			...named,
			reason: "empty-env",
		});
	}
	if (def.delimiter === "") {
		throw new CrustError("DEFINITION", `${label} delimiter must be non-empty`, {
			subject: "flag",
			...named,
			reason: "empty-delimiter",
		});
	}
}

export function normalizeArg<const D extends ArgDef>(def: D): D {
	if (process.env.CRUST_INTERNAL_BUILD !== "1" && def.name === "") {
		throw new CrustError("DEFINITION", "Argument names must be non-empty", {
			subject: "argument",
			name: def.name,
			reason: "empty-name",
		});
	}
	return ownDefinition(def);
}
