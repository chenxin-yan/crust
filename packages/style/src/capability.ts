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

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the color depth a terminal can emit.
 *
 * Resolution rules:
 * - `"never"` → `"none"`.
 * - `"always"` → `"truecolor"` (consistent with
 *   {@link resolveTrueColorCapability}`("always")`).
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
	if (colorTerm !== undefined) {
		const lower = colorTerm.toLowerCase();
		if (lower === "truecolor" || lower === "24bit") {
			return "truecolor";
		}
	}

	const term = readTerm(overrides);
	if (term !== undefined) {
		if (isTrueColorTerm(term)) {
			return "truecolor";
		}
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
 * Resolve whether ANSI color codes should be emitted.
 *
 * Equivalent to `resolveColorDepth(mode, overrides) !== "none"`.
 *
 * Resolution rules:
 * - `"always"` → `true` regardless of environment.
 * - `"never"` → `false` regardless of environment.
 * - `"auto"` → `true` only when stdout is a TTY **and** the `NO_COLOR`
 *   environment variable is not present with a non-empty value, per the
 *   [NO_COLOR convention](https://no-color.org/). `TERM=dumb` also disables
 *   color emission.
 *
 * The `overrides` parameter allows deterministic testing by injecting
 * capability inputs instead of reading from the runtime environment.
 * Because this delegates to {@link resolveColorDepth}, callers should
 * also pass `term` / `colorTerm` when they need full env isolation —
 * `TERM=dumb` in the ambient environment otherwise forces `"none"`.
 *
 * @param mode - The color emission mode.
 * @param overrides - Optional overrides for TTY, NO_COLOR, TERM, and
 * COLORTERM detection.
 * @returns `true` if ANSI codes should be emitted, `false` otherwise.
 *
 * @example
 * ```ts
 * resolveColorCapability("auto"); // true if TTY and NO_COLOR not set
 * resolveColorCapability("always"); // true
 * resolveColorCapability("never"); // false
 * resolveColorCapability("auto", { isTTY: true, noColor: undefined }); // env-dependent
 * resolveColorCapability("auto", {
 *   isTTY: true,
 *   noColor: undefined,
 *   term: "xterm-256color",
 *   colorTerm: undefined,
 * }); // true, deterministic
 * ```
 */
export function resolveColorCapability(
	mode: ColorMode,
	overrides?: CapabilityOverrides & TrueColorOverrides,
): boolean {
	return resolveColorDepth(mode, overrides) !== "none";
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

/**
 * Resolve whether the terminal supports truecolor (24-bit) ANSI sequences.
 *
 * Equivalent to `resolveColorDepth(mode, overrides) === "truecolor"`.
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
	return resolveColorDepth(mode, overrides) === "truecolor";
}
