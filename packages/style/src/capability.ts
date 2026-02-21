// ────────────────────────────────────────────────────────────────────────────
// Capability — Terminal color support detection
// ────────────────────────────────────────────────────────────────────────────

import type { CapabilityOverrides, ColorMode } from "./types.ts";

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
