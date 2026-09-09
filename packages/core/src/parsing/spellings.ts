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

/**
 * Called by normalizeFlag on checked definitions, before a plain-object
 * registry could swallow a reserved __proto__ key.
 */
export function assertDefinableFlag(name: string, def: FlagDef): void {
	assertUsableSpelling(name, "canonical");
	if (def.short !== undefined) assertUsableSpelling(def.short, "short");
	for (const alias of def.aliases ?? []) assertUsableSpelling(alias, "alias");
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

/** Add one flag to a command's cached spelling table. */
export function addFlagSpellingEntries(
	spellings: Map<string, FlagSpelling>,
	canonicalName: string,
	def: FlagDef,
): void {
	for (const [spelling, entry] of spellings) {
		if (entry.canonicalName === canonicalName) spellings.delete(spelling);
	}
	const entry = {
		canonicalName,
		def,
		negatable: isFlagNegatable(def),
	} as const;
	spellings.set(canonicalName, { ...entry, kind: "canonical" });
	if (def.short) spellings.set(def.short, { ...entry, kind: "short" });
	for (const alias of def.aliases ?? []) spellings.set(alias, { ...entry, kind: "alias" });
}

/** Convert named authoring definitions to the runtime flag record. */
export function toFlagsRecord(definitions: readonly NamedFlagDef[], checked = false): FlagsDef {
	const flags: FlagsDef = {};
	const spellings = new Map<string, FlagSpelling>();
	for (const definition of definitions) {
		const { name, ...flag } = normalizeFlag(definition.name, definition, checked);
		if (checked) {
			for (const spelling of [name, flag.short, ...(flag.aliases ?? [])]) {
				if (spelling !== undefined && spellings.has(spelling)) {
					throw new CrustError("DEFINITION", `Flag "${name}" collides with an existing flag`, {
						subject: "flag",
						name,
						reason: "flag-collision",
					});
				}
			}
			addFlagSpellingEntries(spellings, name, flag);
		}
		flags[name] = ownDefinition(flag, false);
	}
	return flags;
}

/** Clone a cached table while rebinding entries to cloned flag definitions. */
export function cloneFlagSpellings(
	spellings: ReadonlyMap<string, FlagSpelling>,
	flags: FlagsDef,
): Map<string, FlagSpelling> {
	return new Map(
		[...spellings]
			.filter(([, entry]) => Object.hasOwn(flags, entry.canonicalName))
			.map(([spelling, entry]) => [spelling, { ...entry, def: flags[entry.canonicalName]! }]),
	);
}

/** Private local provenance survives internal sharing, not author spreads or destination changes. */
const localDefinition: unique symbol = Symbol("crust.localDefinition");

/** Copy only the collections that carry local proof, not JSON/URL/schema payloads. */
export function ownDefinition<const D extends ArgDef | FlagDef>(def: D, checked: boolean): D {
	if (localDefinition in def) return def;
	if (checked && def.choices && def.default !== undefined) {
		const values = "multiple" in def && def.multiple ? def.default : [def.default];
		for (const value of values) {
			if (!def.choices.includes(value)) {
				throw new CrustError("DEFINITION", "default must be one of choices");
			}
		}
	}
	// Helper results expose the local-proof cache: Object.assign must not rewrite facts
	// before later checked consumption skips already-established local validation.
	const parse = def.parse;
	const owned = {
		...def,
		...(checked && parse
			? {
					parse(raw: string) {
						const result = parse(raw);
						if (result instanceof Promise) {
							result.catch(() => {});
							throw new Error("parse must be synchronous");
						}
						return result;
					},
				}
			: {}),
		...("aliases" in def && def.aliases ? { aliases: Object.freeze([...def.aliases]) } : {}),
		...(def.choices ? { choices: Object.freeze([...def.choices]) } : {}),
		...("multiple" in def && def.multiple && Array.isArray(def.default)
			? { default: Object.freeze([...def.default]) }
			: {}),
	};
	Object.defineProperty(owned, localDefinition, { value: true });
	return Object.freeze(owned);
}

export function normalizeFlag<const D extends FlagDef>(
	name: string,
	def: D,
	checked: boolean,
	checkedFields: boolean = checked,
): D {
	if (checked && !(localDefinition in def)) {
		if (checkedFields) assertDefinableFlag(name, def);
		else assertUsableSpelling(name, "canonical");
		const spellings = [
			name,
			...(def.short === undefined ? [] : [def.short]),
			...(def.aliases ?? []),
		];
		if (
			checkedFields
				? new Set(spellings).size !== spellings.length
				: def.short === name || def.aliases?.includes(name)
		) {
			throw new CrustError("DEFINITION", `Flag "${name}" repeats one of its own spellings`, {
				subject: "flag",
				name,
				reason: "flag-collision",
			});
		}
		if (checkedFields && def.short !== undefined && def.short.length !== 1) {
			throw new CrustError("DEFINITION", "Short flags must be one character");
		}
	}
	return ownDefinition(def, checkedFields);
}

export function normalizeArg<const D extends ArgDef>(
	def: D,
	checked: boolean,
	checkedFields: boolean = checked,
): D {
	if (checked && !(localDefinition in def) && def.name === "") {
		throw new CrustError("DEFINITION", "Argument names must be non-empty", {
			subject: "argument",
			name: def.name,
			reason: "empty-name",
		});
	}
	return ownDefinition(def, checkedFields);
}
