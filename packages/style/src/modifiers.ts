// ────────────────────────────────────────────────────────────────────────────
// Modifiers — Bold, dim, italic, underline, strikethrough, etc.
// ────────────────────────────────────────────────────────────────────────────

import * as codes from "./ansiCodes.ts";
import { applyStyle } from "./styleEngine.ts";

/**
 * Apply **bold** (increased intensity) to text.
 *
 * @example
 * ```ts
 * bold("important") // "\x1b[1mimportant\x1b[22m"
 * ```
 */
export function bold(text: string): string {
	return applyStyle(text, codes.bold);
}

/**
 * Apply **dim** (decreased intensity) to text.
 *
 * @example
 * ```ts
 * dim("secondary") // "\x1b[2msecondary\x1b[22m"
 * ```
 */
export function dim(text: string): string {
	return applyStyle(text, codes.dim);
}

/**
 * Apply *italic* to text.
 *
 * @example
 * ```ts
 * italic("emphasis") // "\x1b[3memphasis\x1b[23m"
 * ```
 */
export function italic(text: string): string {
	return applyStyle(text, codes.italic);
}

/**
 * Apply underline to text.
 *
 * @example
 * ```ts
 * underline("link") // "\x1b[4mlink\x1b[24m"
 * ```
 */
export function underline(text: string): string {
	return applyStyle(text, codes.underline);
}

/**
 * Apply inverse (reverse video) to text.
 *
 * @example
 * ```ts
 * inverse("highlighted") // "\x1b[7mhighlighted\x1b[27m"
 * ```
 */
export function inverse(text: string): string {
	return applyStyle(text, codes.inverse);
}

/**
 * Apply hidden (conceal) to text.
 *
 * @example
 * ```ts
 * hidden("secret") // "\x1b[8msecret\x1b[28m"
 * ```
 */
export function hidden(text: string): string {
	return applyStyle(text, codes.hidden);
}

/**
 * Apply ~~strikethrough~~ to text.
 *
 * @example
 * ```ts
 * strikethrough("removed") // "\x1b[9mremoved\x1b[29m"
 * ```
 */
export function strikethrough(text: string): string {
	return applyStyle(text, codes.strikethrough);
}
