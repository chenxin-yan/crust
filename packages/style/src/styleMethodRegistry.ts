import type { AnsiPair } from "./ansiCodes.ts";
import * as codes from "./ansiCodes.ts";

function readStyleMethodPairs(): Omit<typeof codes, "reset"> {
	const { reset: _reset, ...pairs } = codes;
	void _reset;
	return pairs;
}

const styleMethodPairs: Omit<typeof codes, "reset"> = Object.freeze(
	readStyleMethodPairs(),
);

export type StyleMethodName = keyof typeof styleMethodPairs;

export const styleMethodNames: readonly StyleMethodName[] = Object.freeze(
	Object.keys(styleMethodPairs) as StyleMethodName[],
);

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

const modifierPairSet: ReadonlySet<AnsiPair> = new Set(
	modifierNames.map((name) => styleMethodPairs[name]),
);

/**
 * Returns `true` if `pair` is the canonical {@link AnsiPair} for a registered
 * modifier method. Used by `apply()` to distinguish modifier pairs (gated on
 * `modifiersEnabled`) from color pairs (gated on `colorsEnabled`).
 *
 * Pair identity is checked by reference — ad-hoc pairs constructed outside
 * the registry return `false` and fall through to color gating.
 */
export function isModifierPair(pair: AnsiPair): boolean {
	return modifierPairSet.has(pair);
}
