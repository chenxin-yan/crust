// ────────────────────────────────────────────────────────────────────────────
// Style Engine — Nesting-safe ANSI style application
// ────────────────────────────────────────────────────────────────────────────

import type { AnsiPair } from "./ansiCodes.ts";

/**
 * Apply an ANSI style pair to a string with nesting-safe composition.
 *
 * When the input already contains the close sequence for the applied style
 * (e.g. from a nested style call that shares the same close code), the engine
 * reopens the outer style after each inner close to prevent style bleed.
 *
 * @param text - The string to style.
 * @param style - The ANSI pair to apply.
 * @returns The styled string, or the original string if empty.
 *
 * @example
 * ```ts
 * import { applyStyle } from "./styleEngine.ts";
 * import { bold, red } from "./ansiCodes.ts";
 *
 * // Simple usage
 * applyStyle("hello", bold); // "\x1b[1mhello\x1b[22m"
 *
 * // Nesting: bold wraps a red segment — bold reopens after red's close
 * const inner = applyStyle("world", red);
 * applyStyle(`hello ${inner}!`, bold);
 * ```
 */
export function applyStyle(text: string, style: AnsiPair): string {
	if (text === "") {
		return "";
	}

	const { open, close } = style;

	// If the text already contains our close sequence, reopen the style after
	// each occurrence to keep the outer style active. This handles both:
	// 1. Nested styles that share the same close code (e.g. bold + dim both
	//    close with \x1b[22m).
	// 2. Text that was pre-styled and already contains matching close codes.
	if (text.includes(close)) {
		text = text.replaceAll(close, close + open);
	}

	return open + text + close;
}

/**
 * Compose multiple ANSI style pairs into a single style pair.
 *
 * The composed pair opens all styles in order and closes them in reverse
 * order. Useful for creating reusable compound styles.
 *
 * @param styles - The ANSI pairs to compose.
 * @returns A single composed ANSI pair.
 *
 * @example
 * ```ts
 * import { composeStyles } from "./styleEngine.ts";
 * import { bold, red } from "./ansiCodes.ts";
 *
 * const boldRed = composeStyles(bold, red);
 * applyStyle("error", boldRed);
 * ```
 */
export function composeStyles(...styles: AnsiPair[]): AnsiPair {
	return {
		open: styles.map((s) => s.open).join(""),
		close: styles
			.map((s) => s.close)
			.reverse()
			.join(""),
	};
}
