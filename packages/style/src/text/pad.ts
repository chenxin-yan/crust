// ────────────────────────────────────────────────────────────────────────────
// Pad — ANSI-safe padding and alignment utilities
// ────────────────────────────────────────────────────────────────────────────

import { visibleWidth } from "./width.ts";

/**
 * Pad a string on the left (right-align) to the given visible width.
 *
 * Uses {@link visibleWidth} to measure the string, so ANSI escape sequences
 * are excluded from the width calculation. If the string is already at or
 * beyond the target width, it is returned unchanged.
 *
 * @param text - The string to pad (may contain ANSI escapes).
 * @param width - The target visible width.
 * @param fillChar - The character used for padding (default: space).
 * @returns The padded string.
 *
 * @example
 * ```ts
 * padStart("hi", 5);          // "   hi"
 * padStart("hi", 5, ".");     // "...hi"
 * padStart("\x1b[1mhi\x1b[22m", 5); // "   \x1b[1mhi\x1b[22m"
 * ```
 */
export function padStart(text: string, width: number, fillChar = " "): string {
	const currentWidth = visibleWidth(text);
	if (currentWidth >= width) {
		return text;
	}
	const padding = fillChar.repeat(width - currentWidth);
	return padding + text;
}

/**
 * Pad a string on the right (left-align) to the given visible width.
 *
 * Uses {@link visibleWidth} to measure the string, so ANSI escape sequences
 * are excluded from the width calculation. If the string is already at or
 * beyond the target width, it is returned unchanged.
 *
 * @param text - The string to pad (may contain ANSI escapes).
 * @param width - The target visible width.
 * @param fillChar - The character used for padding (default: space).
 * @returns The padded string.
 *
 * @example
 * ```ts
 * padEnd("hi", 5);          // "hi   "
 * padEnd("hi", 5, ".");     // "hi..."
 * padEnd("\x1b[1mhi\x1b[22m", 5); // "\x1b[1mhi\x1b[22m   "
 * ```
 */
export function padEnd(text: string, width: number, fillChar = " "): string {
	const currentWidth = visibleWidth(text);
	if (currentWidth >= width) {
		return text;
	}
	const padding = fillChar.repeat(width - currentWidth);
	return text + padding;
}

/**
 * Center a string within the given visible width.
 *
 * Distributes padding evenly on both sides. When the remaining space is
 * odd, the extra character is placed on the right side.
 *
 * Uses {@link visibleWidth} to measure the string, so ANSI escape sequences
 * are excluded from the width calculation. If the string is already at or
 * beyond the target width, it is returned unchanged.
 *
 * @param text - The string to center (may contain ANSI escapes).
 * @param width - The target visible width.
 * @param fillChar - The character used for padding (default: space).
 * @returns The centered string.
 *
 * @example
 * ```ts
 * center("hi", 6);          // "  hi  "
 * center("hi", 7);          // "  hi   "
 * center("\x1b[1mhi\x1b[22m", 6); // "  \x1b[1mhi\x1b[22m  "
 * ```
 */
export function center(text: string, width: number, fillChar = " "): string {
	const currentWidth = visibleWidth(text);
	if (currentWidth >= width) {
		return text;
	}
	const totalPadding = width - currentWidth;
	const leftPadding = Math.floor(totalPadding / 2);
	const rightPadding = totalPadding - leftPadding;
	return fillChar.repeat(leftPadding) + text + fillChar.repeat(rightPadding);
}
