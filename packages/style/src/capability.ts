// ────────────────────────────────────────────────────────────────────────────
// Capability — Terminal color support detection
// ────────────────────────────────────────────────────────────────────────────

import type { CapabilityOverrides, ColorDepth, ColorMode } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

function readTTY(overrides: CapabilityOverrides | undefined): boolean {
	const hasOverride = overrides !== undefined && "isTTY" in overrides;
	return hasOverride ? (overrides.isTTY ?? false) : (process.stdout?.isTTY ?? false);
}

function readForceColor(overrides: CapabilityOverrides | undefined): string | undefined {
	return overrides !== undefined ? overrides.forceColor : process.env.FORCE_COLOR;
}

/** `FORCE_COLOR=0` / `FORCE_COLOR=false` mean "force off"; any other value forces on. */
function forceColorDisables(forceColor: string): boolean {
	return forceColor === "0" || forceColor === "false";
}

function isTrueColorTerm(term: string): boolean {
	const lower = term.toLowerCase();
	return lower.includes("24bit") || lower.includes("truecolor") || lower.endsWith("-direct");
}

// Single source of truth for truecolor detection: covers both the
// `COLORTERM` exact-match heuristic and the `TERM` substring heuristic.
function detectsTruecolor(colorTerm: string | undefined, term: string | undefined): boolean {
	if (colorTerm !== undefined) {
		const lower = colorTerm.toLowerCase();
		if (lower === "truecolor" || lower === "24bit") {
			return true;
		}
	}
	return term !== undefined && isTrueColorTerm(term);
}

// Depth ladder shared by the forced and auto paths. Assumes color emission
// is already decided to be on — never returns "none".
function detectDepth(
	colorTerm: string | undefined,
	term: string | undefined,
): Exclude<ColorDepth, "none"> {
	if (detectsTruecolor(colorTerm, term)) {
		return "truecolor";
	}
	if (term !== undefined && term.toLowerCase().includes("256color")) {
		return "256";
	}
	return "16";
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the color depth a terminal can emit.
 *
 * Resolution rules:
 * - `"never"` → `"none"`.
 * - `"always"` → `"truecolor"`.
 * - `"auto"`:
 *   1. `FORCE_COLOR` set → decides unconditionally (overrides TTY and
 *      `NO_COLOR`, chalk convention): `0` / `false` → `"none"`; `1` →
 *      `"16"`; `2` → `"256"`; `3` → `"truecolor"`; any other value
 *      (including empty) → forced on at the `COLORTERM` / `TERM`
 *      detected depth.
 *   2. Not a TTY OR `NO_COLOR` set non-empty → `"none"`.
 *   3. `COLORTERM` is `"truecolor"` or `"24bit"` (case-insensitive) →
 *      `"truecolor"`.
 *   4. `TERM` ends with `-direct` OR contains `truecolor` / `24bit` →
 *      `"truecolor"`.
 *   5. `TERM === "dumb"` → `"none"`.
 *   6. `TERM` contains `256color` → `"256"`.
 *   7. Any other TTY value → `"16"`.
 *
 * Detection follows the ecosystem `FORCE_COLOR` / `NO_COLOR` / `COLORTERM`
 * / `TERM` conventions; no bespoke environment variables are introduced.
 *
 * @param mode - The color emission mode.
 * @param overrides - Optional overrides for deterministic testing.
 * @returns The resolved {@link ColorDepth} tier.
 *
 * @example
 * ```ts
 * resolveColorDepth("always"); // "truecolor"
 * resolveColorDepth("never"); // "none"
 * resolveColorDepth("auto", {
 *   isTTY: true,
 *   noColor: undefined,
 *   colorTerm: "truecolor",
 * }); // "truecolor"
 * resolveColorDepth("auto", {
 *   isTTY: true,
 *   noColor: undefined,
 *   colorTerm: undefined,
 *   term: "xterm-256color",
 * }); // "256"
 * ```
 */
export function resolveColorDepth(mode: ColorMode, overrides?: CapabilityOverrides): ColorDepth {
	if (mode === "never") {
		return "none";
	}

	if (mode === "always") {
		return "truecolor";
	}

	// auto mode
	const colorTerm = overrides !== undefined ? overrides.colorTerm : process.env.COLORTERM;
	const term = overrides !== undefined ? overrides.term : process.env.TERM;

	const forceColor = readForceColor(overrides);
	if (forceColor !== undefined) {
		if (forceColorDisables(forceColor)) {
			return "none";
		}
		if (forceColor === "1") return "16";
		if (forceColor === "2") return "256";
		if (forceColor === "3") return "truecolor";
		return detectDepth(colorTerm, term);
	}

	const isTTY = readTTY(overrides);
	if (!isTTY) {
		return "none";
	}

	const noColor = overrides !== undefined ? overrides.noColor : process.env.NO_COLOR;
	if (noColor !== undefined && noColor !== "") {
		return "none";
	}

	// Case-insensitive to match `isTrueColorTerm` and the `256color` check
	// inside `detectDepth`: `TERM=DUMB` / `TERM=Dumb` should also disable
	// color. Truecolor detection wins over `dumb` (matches prior behavior).
	if (term !== undefined && term.toLowerCase() === "dumb" && !detectsTruecolor(colorTerm, term)) {
		return "none";
	}

	return detectDepth(colorTerm, term);
}

/**
 * Resolve whether non-color ANSI modifiers should be emitted.
 *
 * In `"auto"` mode, modifiers are enabled when stdout is a TTY, but are
 * **not** affected by `NO_COLOR` (which only controls color output).
 * `FORCE_COLOR`, when set, decides unconditionally — it is the all-ANSI
 * switch, while `NO_COLOR` is the colors-only switch.
 *
 * @internal Exported only for use by {@link createStyle}; not part of the
 * public surface of `@crustjs/style`.
 */
export function resolveModifierCapability(
	mode: ColorMode,
	overrides?: CapabilityOverrides,
): boolean {
	if (mode === "always") {
		return true;
	}

	if (mode === "never") {
		return false;
	}

	const forceColor = readForceColor(overrides);
	if (forceColor !== undefined) {
		return !forceColorDisables(forceColor);
	}

	return readTTY(overrides);
}
