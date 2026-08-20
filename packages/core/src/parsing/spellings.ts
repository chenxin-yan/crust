import { CrustError } from "../errors.ts";
import type { FlagDef, FlagsDef } from "../types.ts";

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
 * Validate every spelling a flag definition carries. Called where flag
 * records are first built (defineContext/defineExtension) because a
 * `__proto__` key is swallowed by the record before any spelling table
 * would see it, and at the spelling table itself for builder paths.
 */
export function assertDefinableFlag(name: string, def: FlagDef): void {
	assertUsableSpelling(name, "canonical");
	if (def.short !== undefined) assertUsableSpelling(def.short, "short");
	for (const alias of def.aliases ?? []) assertUsableSpelling(alias, "alias");
}

export interface FlagSpelling {
	canonicalName: string;
	spelling: string;
	def: FlagDef;
	kind: "canonical" | "short" | "alias";
	negatable: boolean;
}

/** Add one flag to a command's cached spelling table. */
export function addFlagSpellingEntries(
	spellings: Map<string, FlagSpelling>,
	canonicalName: string,
	def: FlagDef,
): void {
	assertDefinableFlag(canonicalName, def);
	for (const [spelling, entry] of spellings) {
		if (entry.canonicalName === canonicalName) spellings.delete(spelling);
	}
	const entry = {
		canonicalName,
		def,
		negatable: def.type === "boolean" && def.noNegate !== true,
	} as const;
	spellings.set(canonicalName, { ...entry, spelling: canonicalName, kind: "canonical" });
	if (def.short) {
		spellings.set(def.short, { ...entry, spelling: def.short, kind: "short" });
	}
	for (const alias of def.aliases ?? []) {
		spellings.set(alias, { ...entry, spelling: alias, kind: "alias" });
	}
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
