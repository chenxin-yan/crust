import { CrustError } from "../errors.ts";
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

const ALLOWED_FLAG_TYPES: ReadonlySet<ValueType> = new Set([
	"string",
	"number",
	"boolean",
	"url",
	"path",
	"json",
]);

// Single source for the parser-type error text: "a", "b", or "c".
const ALLOWED_FLAG_TYPES_TEXT = [...ALLOWED_FLAG_TYPES]
	.map((type) => `"${type}"`)
	.join(", ")
	.replace(/, (?="[^"]+"$)/, ", or ");

export function flagDefinitionSpellings(name: string, def: FlagDefinition): string[] {
	return [name, ...(def.short ? [def.short] : []), ...(def.aliases ?? [])];
}

/**
 * Shape rules for one flag definition — the single runtime rulebook shared by
 * every entry gate (`validateIncomingFlag`) and the spelling table
 * (`addFlagSpellingEntries` callers): non-empty name, reserved `no-`
 * prefixes, parser type, the reserved `"__proto__"` spelling, and
 * self-duplicate spellings.
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
			`${subject} must declare a parser type (${ALLOWED_FLAG_TYPES_TEXT})`,
		);
	}

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
