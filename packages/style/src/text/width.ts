// ────────────────────────────────────────────────────────────────────────────
// Width — Visible width calculation (ANSI-aware)
// ────────────────────────────────────────────────────────────────────────────

import { stripAnsi } from "./stripAnsi.ts";

/**
 * Test whether a code point is a full-width character (occupies 2 columns).
 *
 * Covers CJK Unified Ideographs, CJK compatibility, fullwidth forms, and
 * common wide Unicode ranges used in terminal emulators.
 *
 * @see https://www.unicode.org/reports/tr11/
 */
function isFullWidth(codePoint: number): boolean {
	return (
		// CJK Unified Ideographs (U+4E00–U+9FFF)
		(codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
		// CJK Unified Ideographs Extension A (U+3400–U+4DBF)
		(codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
		// CJK Unified Ideographs Extension B (U+20000–U+2A6DF)
		(codePoint >= 0x20000 && codePoint <= 0x2a6df) ||
		// CJK Compatibility Ideographs (U+F900–U+FAFF)
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		// Fullwidth Forms (U+FF01–U+FF60, U+FFE0–U+FFE6)
		(codePoint >= 0xff01 && codePoint <= 0xff60) ||
		(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
		// CJK Radicals Supplement (U+2E80–U+2EFF)
		(codePoint >= 0x2e80 && codePoint <= 0x2eff) ||
		// Kangxi Radicals (U+2F00–U+2FDF)
		(codePoint >= 0x2f00 && codePoint <= 0x2fdf) ||
		// CJK Symbols and Punctuation (U+3000–U+303F)
		(codePoint >= 0x3000 && codePoint <= 0x303f) ||
		// Hiragana (U+3040–U+309F)
		(codePoint >= 0x3040 && codePoint <= 0x309f) ||
		// Katakana (U+30A0–U+30FF)
		(codePoint >= 0x30a0 && codePoint <= 0x30ff) ||
		// Bopomofo (U+3100–U+312F)
		(codePoint >= 0x3100 && codePoint <= 0x312f) ||
		// Hangul Compatibility Jamo (U+3130–U+318F)
		(codePoint >= 0x3130 && codePoint <= 0x318f) ||
		// Enclosed CJK Letters and Months (U+3200–U+32FF)
		(codePoint >= 0x3200 && codePoint <= 0x32ff) ||
		// CJK Compatibility (U+3300–U+33FF)
		(codePoint >= 0x3300 && codePoint <= 0x33ff) ||
		// Hangul Syllables (U+AC00–U+D7AF)
		(codePoint >= 0xac00 && codePoint <= 0xd7af) ||
		// CJK Compatibility Forms (U+FE30–U+FE4F)
		(codePoint >= 0xfe30 && codePoint <= 0xfe4f)
	);
}

/**
 * Compute the visible (column) width of a string.
 *
 * ANSI escape sequences are stripped before measurement. Full-width
 * characters (CJK, fullwidth forms) count as 2 columns; all other
 * printable characters count as 1.
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
	const plain = stripAnsi(text);
	let width = 0;

	for (const char of plain) {
		const codePoint = char.codePointAt(0);
		if (codePoint === undefined) {
			continue;
		}
		width += isFullWidth(codePoint) ? 2 : 1;
	}

	return width;
}
