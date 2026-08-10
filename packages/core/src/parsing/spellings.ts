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

/**
 * Shape rules for one flag definition — the single runtime rulebook shared by
 * every entry gate (`validateIncomingFlag`) and the spelling table
 * (`flagSpellings`): non-empty name, reserved `no-` prefixes, parser type,
 * the reserved `"__proto__"` spelling, and self-duplicate spellings.
 *
 * These mirror the compile-time brands in `validation/flags.ts` —
 * defense-in-depth against type erasure (dynamic construction, `as any`
 * casts, widened generics).
 *
 * `ownerLabel` (e.g. `Command "cli"`, `Extension "docs" on "root"`) attributes
 * owner-specific messages at entry gates; the table path omits it.
 *
 * Returns the definition's spellings so callers don't recompute them.
 *
 * @throws {CrustError} `DEFINITION` on violation
 */
export function validateFlagDefinitionShape(
	name: string,
	def: FlagDefinition,
	ownerLabel?: string,
): string[] {
	// Guard for plain-JS callers: a nameless def would otherwise register
	// under the literal key "undefined" and surface as `--undefined` in help.
	if (typeof name !== "string" || name.length === 0) {
		throw new CrustError("DEFINITION", "Every flag definition must carry a non-empty name", {
			subject: "flag",
			reason: "missing-name",
		});
	}
	const subject = ownerLabel ? `${ownerLabel} flag "--${name}"` : `Flag "--${name}"`;

	if (name.startsWith("no-")) {
		const base = name.slice(3);
		throw new CrustError(
			"DEFINITION",
			`${subject} must not use "no-" prefix; define "${base}" and negate with "--no-${base}"`,
		);
	}

	if (!ALLOWED_FLAG_TYPES.has(def.type)) {
		throw new CrustError(
			"DEFINITION",
			`${subject} must declare a parser type ("string", "number", "boolean", "url", "path", or "json")`,
		);
	}

	if (def.short?.startsWith("no-")) {
		throw new CrustError(
			"DEFINITION",
			`Short alias "-${def.short}" on "--${name}" must not use "no-" prefix (reserved for negation)`,
		);
	}
	for (const alias of def.aliases ?? []) {
		if (alias.startsWith("no-")) {
			throw new CrustError(
				"DEFINITION",
				`Alias "--${alias}" on "--${name}" must not use "no-" prefix (reserved for negation)`,
			);
		}
	}

	const spellings = flagDefinitionSpellings(name, def);
	// Flag defs and parse results live in plain-object records; a "__proto__"
	// key hits the Object.prototype setter and the flag silently vanishes.
	if (spellings.includes("__proto__")) {
		throw new CrustError("DEFINITION", `${subject} uses reserved spelling "__proto__"`, {
			subject: "flag",
			name,
			reason: "reserved-name",
		});
	}
	const duplicate = spellings.find((spelling, index) => spellings.indexOf(spelling) !== index);
	if (duplicate !== undefined) {
		throw new CrustError("DEFINITION", `${subject} repeats spelling "${duplicate}"`, {
			subject: "flag",
			name,
			reason: "flag-collision",
		});
	}

	return spellings;
}

/** Build the canonical flag-spelling table shared by parsing and routing. */
export function flagSpellings<T extends FlagDefinition = FlagDef>(
	flagsDef: Readonly<Record<string, T>> | undefined,
): Map<string, FlagSpelling<T>> {
	const spellings = new Map<string, FlagSpelling<T>>();
	if (!flagsDef) return spellings;

	// Shape rules live in the shared rulebook; this loop only detects
	// cross-flag collisions. Reserve canonical names before aliases so
	// collisions report the canonical owner regardless of definition order.
	const owners = new Map<string, string>();
	for (const name of Object.keys(flagsDef)) owners.set(name, name);

	for (const [canonicalName, def] of Object.entries(flagsDef)) {
		validateFlagDefinitionShape(canonicalName, def);

		const entry = {
			canonicalName,
			def,
			negatable: def.type === "boolean" && def.noNegate !== true,
		} as const;
		spellings.set(canonicalName, { ...entry, spelling: canonicalName, kind: "canonical" });

		if (def.short) {
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
