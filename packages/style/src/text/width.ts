// ────────────────────────────────────────────────────────────────────────────
// Width — Visible width calculation (ANSI-aware)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute the visible (column) width of a string.
 *
 * ANSI escape sequences do not contribute to the result. Wide Unicode
 * characters such as CJK and emoji use their terminal column width.
 *
 * Only measures a single line. For multiline strings, split on `\n`
 * and measure each line individually.
 *
 * @param text - The string to measure (may contain ANSI escapes).
 * @returns The visible width in terminal columns.
 *
 * @example
 * ```ts
 * import { visibleWidth } from "./width.ts";
 *
 * visibleWidth("hello");              // 5
 * visibleWidth("\x1b[1mhello\x1b[22m"); // 5
 * visibleWidth("\u4f60\u597d");        // 4 (two CJK characters)
 * ```
 */
export function visibleWidth(text: string): number {
	return Bun.stringWidth(text);
}
