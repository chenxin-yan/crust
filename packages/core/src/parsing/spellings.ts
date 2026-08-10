import type { FlagDef, FlagsDef, ValueType } from "../types.ts";

interface FlagDefinition {
	readonly type: ValueType;
	readonly short?: string;
	readonly aliases?: readonly string[];
	readonly noNegate?: boolean;
	readonly multiple?: boolean;
}

export interface FlagSpelling<T extends FlagDefinition = FlagDef> {
	canonicalName: string;
	spelling: string;
	def: T;
	kind: "canonical" | "short" | "alias";
	negatable: boolean;
}

/** Add one normalized flag to a command's cached spelling table. */
export function addFlagSpellingEntries<T extends FlagDefinition = FlagDef>(
	spellings: Map<string, FlagSpelling<T>>,
	canonicalName: string,
	def: T,
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
