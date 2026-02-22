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
 *   environment variable is not set. Any non-undefined value of `NO_COLOR`
 *   (including the empty string `""`) disables color, per the
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
 * resolveCapability("auto"); // true if TTY and NO_COLOR not set
 * resolveCapability("always"); // true
 * resolveCapability("never"); // false
 * resolveCapability("auto", { isTTY: true, noColor: undefined }); // true
 * resolveCapability("auto", { isTTY: true, noColor: "" }); // false
 * ```
 */
export function resolveCapability(
	mode: ColorMode,
	overrides?: CapabilityOverrides,
): boolean {
	if (mode === "always") {
		return true;
	}

	if (mode === "never") {
		return false;
	}

	// auto mode: check TTY and NO_COLOR
	const isTTY = overrides?.isTTY ?? process.stdout?.isTTY ?? false;
	const noColor =
		overrides?.noColor !== undefined ? overrides.noColor : process.env.NO_COLOR;

	// NO_COLOR is set (any value including empty string) → disable color
	if (noColor !== undefined) {
		return false;
	}

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
 * resolveTrueColor("auto"); // true if TTY + truecolor env detected
 * resolveTrueColor("always"); // true
 * resolveTrueColor("never"); // false
 * resolveTrueColor("auto", {
 *   isTTY: true,
 *   noColor: undefined,
 *   colorTerm: "truecolor",
 * }); // true
 * ```
 */
export function resolveTrueColor(
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
	if (!resolveCapability(mode, overrides)) {
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
