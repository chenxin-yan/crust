// ────────────────────────────────────────────────────────────────────────────
// Capability — Terminal color support detection
// ────────────────────────────────────────────────────────────────────────────

import type {
	CapabilityOverrides,
	ColorDepth,
	ColorMode,
	TrueColorOverrides,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

function readTTY(overrides: CapabilityOverrides | undefined): boolean {
	const hasOverride = overrides !== undefined && "isTTY" in overrides;
	return hasOverride
		? (overrides.isTTY ?? false)
		: (process.stdout?.isTTY ?? false);
}

function readNoColor(
	overrides: CapabilityOverrides | undefined,
): string | undefined {
	const hasOverride = overrides !== undefined && "noColor" in overrides;
	return hasOverride ? overrides.noColor : process.env.NO_COLOR;
}

function readColorTerm(
	overrides: TrueColorOverrides | undefined,
): string | undefined {
	const hasOverride = overrides !== undefined && "colorTerm" in overrides;
	return hasOverride ? overrides.colorTerm : process.env.COLORTERM;
}

function readTerm(
	overrides: TrueColorOverrides | undefined,
): string | undefined {
	const hasOverride = overrides !== undefined && "term" in overrides;
	return hasOverride ? overrides.term : process.env.TERM;
}

function isTrueColorTerm(term: string): boolean {
	const lower = term.toLowerCase();
	return (
		lower.includes("24bit") ||
		lower.includes("truecolor") ||
		lower.endsWith("-direct")
	);
}

// Single source of truth for truecolor detection: covers both the
// `COLORTERM` exact-match heuristic and the `TERM` substring heuristic.
function detectsTruecolor(
	colorTerm: string | undefined,
	term: string | undefined,
): boolean {
	if (colorTerm !== undefined) {
		const lower = colorTerm.toLowerCase();
		if (lower === "truecolor" || lower === "24bit") {
			return true;
		}
	}
	return term !== undefined && isTrueColorTerm(term);
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
 *   1. Not a TTY OR `NO_COLOR` set non-empty → `"none"`.
 *   2. `COLORTERM` is `"truecolor"` or `"24bit"` (case-insensitive) →
 *      `"truecolor"`.
 *   3. `TERM` ends with `-direct` OR contains `truecolor` / `24bit` →
 *      `"truecolor"`.
 *   4. `TERM === "dumb"` → `"none"`.
 *   5. `TERM` contains `256color` → `"256"`.
 *   6. Any other TTY value → `"16"`.
 *
 * Detection follows the existing `NO_COLOR` / `COLORTERM` / `TERM`
 * conventions; no new environment variables are introduced.
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
export function resolveColorDepth(
	mode: ColorMode,
	overrides?: CapabilityOverrides & TrueColorOverrides,
): ColorDepth {
	if (mode === "never") {
		return "none";
	}

	if (mode === "always") {
		return "truecolor";
	}

	// auto mode
	const isTTY = readTTY(overrides);
	if (!isTTY) {
		return "none";
	}

	const noColor = readNoColor(overrides);
	if (noColor !== undefined && noColor !== "") {
		return "none";
	}

	const colorTerm = readColorTerm(overrides);
	const term = readTerm(overrides);
	if (detectsTruecolor(colorTerm, term)) {
		return "truecolor";
	}

	if (term !== undefined) {
		// Case-insensitive to match `isTrueColorTerm` and the `256color`
		// check below: `TERM=DUMB` / `TERM=Dumb` should also disable color.
		const lower = term.toLowerCase();
		if (lower === "dumb") {
			return "none";
		}
		if (lower.includes("256color")) {
			return "256";
		}
	}

	return "16";
}

/**
 * Resolve whether non-color ANSI modifiers should be emitted.
 *
 * In `"auto"` mode, modifiers are enabled when stdout is a TTY, but are
 * **not** affected by `NO_COLOR` (which only controls color output).
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

	return readTTY(overrides);
}

/**
 * Resolve whether OSC 8 hyperlinks should be emitted.
 *
 * There is no reliable cross-terminal capability probe for hyperlinks today,
 * so `"auto"` mode uses a conservative TTY check similar to non-color
 * modifiers while still allowing explicit `"always"` / `"never"` overrides.
 *
 * @internal Exported for use by {@link createStyle}; not part of the stable
 * public surface of `@crustjs/style`.
 */
export function resolveHyperlinkCapability(
	mode: ColorMode,
	overrides?: CapabilityOverrides,
): boolean {
	if (mode === "always") {
		return true;
	}

	if (mode === "never") {
		return false;
	}

	return readTTY(overrides);
}
