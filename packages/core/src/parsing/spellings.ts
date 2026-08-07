import { CrustError } from "../errors.ts";
import type { FlagDef, ValueType } from "../types.ts";

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

const ALLOWED_FLAG_TYPES: ReadonlySet<ValueType> = new Set([
	"string",
	"number",
	"boolean",
	"url",
	"path",
	"json",
]);

export function flagDefinitionSpellings(name: string, def: FlagDefinition): string[] {
	return [name, ...(def.short ? [def.short] : []), ...(def.aliases ?? [])];
}

/** Build the canonical flag-spelling table shared by parsing and routing. */
export function flagSpellings<T extends FlagDefinition = FlagDef>(
	flagsDef: Readonly<Record<string, T>> | undefined,
): Map<string, FlagSpelling<T>> {
	const spellings = new Map<string, FlagSpelling<T>>();
	if (!flagsDef) return spellings;

	// Collision checks mirror the compile-time `ValidateFlagAliases<F>` type —
	// defense-in-depth against type erasure (dynamic construction, `as any`
	// casts, widened generics). Reserve canonical names before aliases so
	// collisions report the canonical owner regardless of definition order.
	const owners = new Map<string, string>();
	for (const name of Object.keys(flagsDef)) owners.set(name, name);

	for (const [canonicalName, def] of Object.entries(flagsDef)) {
		if (canonicalName.startsWith("no-")) {
			const base = canonicalName.slice(3);
			throw new CrustError(
				"DEFINITION",
				`Flag "--${canonicalName}" must not use "no-" prefix; define "${base}" and negate with "--no-${base}"`,
			);
		}

		if (!ALLOWED_FLAG_TYPES.has(def.type)) {
			throw new CrustError(
				"DEFINITION",
				`Flag "--${canonicalName}" must declare a parser type ("string", "number", "boolean", "url", "path", or "json")`,
			);
		}

		const entry = {
			canonicalName,
			def,
			negatable: def.type === "boolean" && def.noNegate !== true,
		} as const;
		spellings.set(canonicalName, { ...entry, spelling: canonicalName, kind: "canonical" });

		if (def.short) {
			if (def.short.startsWith("no-")) {
				throw new CrustError(
					"DEFINITION",
					`Short alias "-${def.short}" on "--${canonicalName}" must not use "no-" prefix (reserved for negation)`,
				);
			}
			const existing = owners.get(def.short);
			if (existing) {
				throw new CrustError(
					"DEFINITION",
					`Alias collision: "-${def.short}" is used by both "--${existing}" and "--${canonicalName}"`,
				);
			}
			owners.set(def.short, canonicalName);
			spellings.set(def.short, { ...entry, spelling: def.short, kind: "short" });
		}

		for (const alias of def.aliases ?? []) {
			if (alias.startsWith("no-")) {
				throw new CrustError(
					"DEFINITION",
					`Alias "--${alias}" on "--${canonicalName}" must not use "no-" prefix (reserved for negation)`,
				);
			}
			const existing = owners.get(alias);
			if (existing) {
				throw new CrustError(
					"DEFINITION",
					`Alias collision: "${alias.length === 1 ? "-" : "--"}${alias}" is used by both "--${existing}" and "--${canonicalName}"`,
				);
			}
			owners.set(alias, canonicalName);
			spellings.set(alias, { ...entry, spelling: alias, kind: "alias" });
		}
	}

	return spellings;
}
