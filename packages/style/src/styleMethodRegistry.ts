import type { AnsiPair } from "./ansiCodes.ts";
import * as codes from "./ansiCodes.ts";

// Alias exists to appease oxlint's import/namespace rule: computed access on
// an imported namespace (`codes[name]`) can't be statically validated, but
// the same access through a local const can.
const styleMethodPairs: typeof codes = codes;

export type StyleMethodName = keyof typeof styleMethodPairs;

// SAFETY: styleMethodPairs is the closed ANSI-code module namespace, so Object.keys returns its keys.
const styleMethodNameList = Object.keys(styleMethodPairs) as StyleMethodName[];
export const styleMethodNames: readonly StyleMethodName[] = Object.freeze(styleMethodNameList);

export function stylePairFor(name: StyleMethodName): AnsiPair {
	return styleMethodPairs[name];
}

// ────────────────────────────────────────────────────────────────────────────
// Modifier classification
// ────────────────────────────────────────────────────────────────────────────

/**
 * Names of ANSI modifier methods (non-color attributes).
 *
 * Used to distinguish modifiers from color methods when gating emission on
 * `modifiersEnabled` vs `colorsEnabled` (e.g. under `NO_COLOR`, modifiers
 * remain enabled while colors are disabled).
 *
 * The inline `satisfies readonly StyleMethodName[]` clause guarantees at
 * compile time that every listed name is a valid {@link StyleMethodName}.
 */
export type ModifierName =
	| "bold"
	| "dim"
	| "italic"
	| "underline"
	| "inverse"
	| "hidden"
	| "strikethrough";

export const modifierNames: readonly ModifierName[] = Object.freeze([
	"bold",
	"dim",
	"italic",
	"underline",
	"inverse",
	"hidden",
	"strikethrough",
] as const satisfies readonly StyleMethodName[]);

const modifierNameSet: ReadonlySet<StyleMethodName> = new Set(modifierNames);

/**
 * Returns `true` if `name` is an ANSI modifier (bold, italic, underline, etc.)
 * rather than a color method.
 */
export function isModifierName(name: StyleMethodName): boolean {
	return modifierNameSet.has(name);
}
