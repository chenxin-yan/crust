// ────────────────────────────────────────────────────────────────────────────
// Capability — Terminal color support detection
// ────────────────────────────────────────────────────────────────────────────

import type {
	CapabilityOverrides,
	ColorMode,
	TrueColorOverrides,
} from "./types.ts";

/**
 * Resolve whether ANSI color codes should be emitted.
 *
 * Resolution rules:
 * - `"always"` → `true` regardless of environment.
 * - `"never"` → `false` regardless of environment.
 * - `"auto"` → `true` only when stdout is a TTY **and** the `NO_COLOR`
 *   environment variable is not present with a non-empty value, per the
 *   [NO_COLOR convention](https://no-color.org/).
 *
 * The `overrides` parameter allows deterministic testing by injecting
 * capability inputs instead of reading from the runtime environment.
 *
 * @param mode - The color emission mode.
 * @param overrides - Optional overrides for TTY and NO_COLOR detection.
 * @returns `true` if ANSI codes should be emitted, `false` otherwise.
 *
 * @example
 * ```ts
 * resolveColorCapability("auto"); // true if TTY and NO_COLOR not set
 * resolveColorCapability("always"); // true
 * resolveColorCapability("never"); // false
 * resolveColorCapability("auto", { isTTY: true, noColor: undefined }); // true
 * resolveColorCapability("auto", { isTTY: true, noColor: "" }); // true
 * ```
 */
export function resolveColorCapability(
	mode: ColorMode,
	overrides?: CapabilityOverrides,
): boolean {
	if (mode === "always") {
		return true;
	}

	if (mode === "never") {
		return false;
	}

	// auto mode: explicit overrides should win even when set to `undefined`,
	// so tests can simulate an unset environment variable deterministically.
	const hasIsTTYOverride = overrides !== undefined && "isTTY" in overrides;
	const isTTY = hasIsTTYOverride
		? (overrides.isTTY ?? false)
		: (process.stdout?.isTTY ?? false);
	const hasNoColorOverride = overrides !== undefined && "noColor" in overrides;
	const noColor = hasNoColorOverride ? overrides.noColor : process.env.NO_COLOR;

	// NO_COLOR disables color only when present and non-empty.
	if (noColor !== undefined && noColor !== "") {
		return false;
	}

	return isTTY;
}

/**
 * Resolve whether non-color ANSI modifiers should be emitted.
 *
 * In `"auto"` mode, modifiers are enabled when stdout is a TTY, but are
 * **not** affected by `NO_COLOR` (which only controls color output).
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

	const hasIsTTYOverride = overrides !== undefined && "isTTY" in overrides;
	const isTTY = hasIsTTYOverride
		? (overrides.isTTY ?? false)
		: (process.stdout?.isTTY ?? false);
	return isTTY;
}

/**
 * Resolve whether the terminal supports truecolor (24-bit) ANSI sequences.
 *
 * Detection heuristics (checked in order):
 * 1. `COLORTERM` environment variable is `"truecolor"` or `"24bit"`.
 * 2. `TERM` environment variable contains `"24bit"`, `"truecolor"`, or `"-direct"`.
 *
 * In `"always"` mode, returns `true` unconditionally.
 * In `"never"` mode, returns `false` unconditionally.
 * In `"auto"` mode, requires base color to be enabled **and** truecolor
 * to be detected.
 *
 * @param mode - The color emission mode.
 * @param overrides - Optional overrides for deterministic testing.
 * @returns `true` if truecolor sequences should be emitted.
 *
 * @example
 * ```ts
 * resolveTrueColorCapability("auto"); // true if TTY + truecolor env detected
 * resolveTrueColorCapability("always"); // true
 * resolveTrueColorCapability("never"); // false
 * resolveTrueColorCapability("auto", {
 *   isTTY: true,
 *   noColor: undefined,
 *   colorTerm: "truecolor",
 * }); // true
 * ```
 */
export function resolveTrueColorCapability(
	mode: ColorMode,
	overrides?: CapabilityOverrides & TrueColorOverrides,
): boolean {
	if (mode === "always") {
		return true;
	}

	if (mode === "never") {
		return false;
	}

	// Base color must be enabled first
	if (!resolveColorCapability(mode, overrides)) {
		return false;
	}

	const hasColorTermOverride =
		overrides !== undefined && "colorTerm" in overrides;
	const colorTerm = hasColorTermOverride
		? overrides.colorTerm
		: process.env.COLORTERM;

	const lowerColorTerm = colorTerm?.toLowerCase();
	if (lowerColorTerm === "truecolor" || lowerColorTerm === "24bit") {
		return true;
	}

	const hasTermOverride = overrides !== undefined && "term" in overrides;
	const term = hasTermOverride ? overrides.term : process.env.TERM;

	if (term !== undefined) {
		const lower = term.toLowerCase();
		if (
			lower.includes("24bit") ||
			lower.includes("truecolor") ||
			lower.endsWith("-direct")
		) {
			return true;
		}
	}

	return false;
}
