import { CrustError } from "../errors.ts";
import type { ArgDef, FlagDef, FlagsDef } from "../types.ts";

// Array-index keys (below 2 ** 32 - 1) are enumerated first, ahead of insertion order. Every
// canonical decimal integer (`0`, or digits without a leading zero) is rejected at any length so
// the rule matches the type-level check; `01` is not one and keeps its insertion order.
const INTEGER_LIKE = /^(0|[1-9]\d*)$/;

/**
 * Child command names and aliases are matched against a single argv token: one
 * without whitespace that does not start with `-`, which would make it a flag.
 * Flag spellings follow the same rule, since the parser adds their dashes.
 */
export function isBareToken(token: string): boolean {
	return token !== "" && !/[ \t\n\r\v\f]/.test(token) && !token.startsWith("-");
}

// Compile-time brands (FIX_EMPTY_SPELLING, FIX_NO_PREFIX, FIX_SPELLING_SHAPE) own literal
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

/** Whether a flag accepts generated `--no-` spellings. */
export function isFlagNegatable(def: FlagDef): boolean {
	return def.type === "boolean" && def.noNegate !== true;
}

function invalidFlags(message: string): CrustError {
	return new CrustError("DEFINITION", message, { subject: "flag", reason: "invalid-flags" });
}

/**
 * Read the `[name, def]` entries of a `.flags()` call: exactly one plain-object
 * record keyed by canonical name. Only own enumerable string keys count.
 */
export function flagRecordEntries(
	record: unknown,
): readonly (readonly [name: string, def: FlagDef])[] {
	// Without strictNullChecks a nullish record typechecks. A `Record`-typed literal can hold
	// `{ __proto__: def }`, which sets the prototype instead of adding a key.
	const nullish = record === null || record === undefined;
	const proto: unknown = nullish ? undefined : Object.getPrototypeOf(record);
	if (proto !== Object.prototype && proto !== null) {
		throw invalidFlags(
			nullish
				? ".flags() expects a plain object record"
				: ".flags() expects a plain object record; a `__proto__` key sets its prototype instead of naming a flag",
		);
	}
	const entries = Object.entries(record as object);
	for (const [name, def] of entries) {
		// `FlagsInput` admits `undefined` definitions (and `null` without strictNullChecks).
		if (def === undefined || def === null) {
			throw new CrustError("DEFINITION", `Flag "${name}" definition must be an object`, {
				subject: "flag",
				name,
				reason: "invalid-flags",
			});
		}
	}
	return entries as [string, FlagDef][];
}

/** Convert flag entries to the runtime flag record, rejecting spelling collisions. */
export function toFlagsRecord(
	entries: readonly (readonly [name: string, def: FlagDef])[],
	initial: Readonly<FlagsDef> = {},
): FlagsDef {
	const flags: FlagsDef = { ...initial };
	const seen = new Set(Object.entries(initial).flatMap(([name, def]) => flagSpellings(name, def)));
	for (const [name, flag] of entries) {
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
export function ownDefinition<const D extends ArgDef | FlagDef>(
	def: D,
	subject: "flag" | "argument",
	name: string | undefined,
): D {
	if (def.choices && def.default !== undefined) {
		const values = "multiple" in def && def.multiple ? def.default : [def.default];
		for (const value of values) {
			if (!def.choices.includes(value)) {
				throw new CrustError(
					"DEFINITION",
					`${subject === "flag" ? "Flag" : "Argument"}${name === undefined ? "" : ` "${name}"`} default must be one of choices`,
					{ subject, ...(name === undefined ? {} : { name }), reason: "default-outside-choices" },
				);
			}
		}
	}
	return Object.freeze({
		...def,
		...("aliases" in def && def.aliases ? { aliases: Object.freeze([...def.aliases]) } : {}),
		...(def.choices ? { choices: Object.freeze([...def.choices]) } : {}),
		...("env" in def && def.env
			? { env: Object.freeze({ name: def.env.name, delimiter: def.env.delimiter }) }
			: {}),
		...("multiple" in def && def.multiple && Array.isArray(def.default)
			? { default: Object.freeze([...def.default]) }
			: {}),
	});
}

function isEnvBinding(value: unknown): value is NonNullable<FlagDef["env"]> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		"name" in value &&
		typeof value.name === "string" &&
		(!("delimiter" in value) ||
			value.delimiter === undefined ||
			typeof value.delimiter === "string")
	);
}

// `name` is undefined for a name-less `defineFlag(def)`; attachment re-normalizes under its key.
export function normalizeFlag<const D extends FlagDef>(name: string | undefined, def: D): D {
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
	// One code point, as the types count it: an astral short is two UTF-16 units.
	if (def.short !== undefined && !/^.$/su.test(def.short)) {
		throw new CrustError("DEFINITION", `${label} short "${def.short}" must be one character`, {
			subject: "flag",
			...named,
			reason: "invalid-short",
		});
	}
	if (def.env !== undefined && !isEnvBinding(def.env)) {
		throw new CrustError(
			"DEFINITION",
			`${label} env must be an object with a string name and optional string delimiter`,
			{
				subject: "flag",
				...named,
				reason: "invalid-env",
			},
		);
	}
	if (def.env?.name === "") {
		throw new CrustError("DEFINITION", `${label} env variable name must be non-empty`, {
			subject: "flag",
			...named,
			reason: "empty-env",
		});
	}
	if (def.required === true && def.default !== undefined) {
		throw new CrustError("DEFINITION", `${label} cannot be both required and defaulted`, {
			subject: "flag",
			...named,
			reason: "required-default",
		});
	}
	for (const [field, delimiter] of [
		["delimiter", def.delimiter],
		["env.delimiter", def.env?.delimiter],
	] as const) {
		if (delimiter === undefined) continue;
		if (!def.multiple) {
			throw new CrustError("DEFINITION", `${label} ${field} requires multiple: true`, {
				subject: "flag",
				...named,
				reason: "delimiter-without-multiple",
			});
		}
		if (delimiter === "") {
			throw new CrustError("DEFINITION", `${label} ${field} must be non-empty`, {
				subject: "flag",
				...named,
				reason: "empty-delimiter",
			});
		}
	}
	return ownDefinition(def, "flag", name);
}

export function normalizeArg<const D extends ArgDef>(def: D): D {
	if (def.name === "") {
		throw new CrustError("DEFINITION", "Argument names must be non-empty", {
			subject: "argument",
			name: def.name,
			reason: "empty-name",
		});
	}
	return ownDefinition(def, "argument", def.name);
}
