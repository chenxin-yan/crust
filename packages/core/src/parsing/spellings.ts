import type { FlagDef, FlagsDef } from "../types.ts";

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
