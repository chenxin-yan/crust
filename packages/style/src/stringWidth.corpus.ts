/**
 * `[label, input, expected]` rows where `expected` is both the JavaScript
 * fallback's width and `Bun.stringWidth(input, { countAnsiEscapeCodes: false })`
 * on Bun 1.4.2. Inputs are ASCII-escaped so control characters stay visible.
 *
 * Known divergences (Bun / fallback), deliberately left out — exotic clusters
 * the heuristic does not model:
 * - Indic conjuncts `"\u0915\u094d\u0937"` 2 / 1; two leading jamo `"\u1100\u1100"` 4 / 2
 * - keycap without VS16 or on a non-digit `"1\u20e3"`, `"a\u20e3"` 2 / 1; `"1\ufe0f"` 1 / 2
 * - skin tone on a non-emoji base `"a\u{1f3fb}"` 3 / 2, or after VS16 `"\u{1f44d}\ufe0f\u{1f3fb}"` 4 / 2;
 *   prepend + VS16 emoji `"\u0600\u2764\ufe0f"` 0 / 2
 * - standalone Indic spacing mark `"\u093e"` 0 / 1; Thai/Balinese spacing marks `"\u0e01\u0e33"` 2 / 1
 * - lone surrogates `"\ud800"` 0 / 1, including a pair split by an escape `"\ud83d\x1b[31m\ude42"` 0 / 2
 * - nF escape eating one UTF-16 unit of an emoji `"a\x1b(\u{1f642}b"` 2 / 3
 * - format characters Bun renders `"\ufff9"` 1 / 0; unassigned gaps in coarse wide blocks `"\u{1a000}"` 1 / 2
 */
export const widthCorpus: readonly (readonly [label: string, input: string, expected: number])[] = [
	["empty", "", 0],
	["ASCII", "plain ASCII", 11],
	["CJK", "\u4f60\u597d", 4],
	["emoji default", "\ud83d\ude42", 2],
	["ZWJ family", "\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66", 2],
	["smile VS16", "\u263a\ufe0f", 2],
	["keycap with VS16", "1\ufe0f\u20e3", 2],
	["Mn accent base", "e\u0301", 1],
	["Hangul decomposed", "\u1112\u1161\u11ab", 2],
	["SGR", "\u001b[31mred\u001b[0m", 3],
	["tab", "\t", 0],
	["LF", "\n", 0],
	["CRLF", "a\r\nb", 2],
	["DEL", "\u007f", 0],
	["ESC alone", "\u001b", 0],
	["ESC end", "a\u001b", 1],
	["CSI colon", "\u001b[38:2::1:2:3mX\u001b[0m", 1],
	["CSI incomplete introducer", "\u001b[", 0],
	["CSI trailing incomplete", "\u001b[31mred\u001b[", 3],
	["CSI intermediate", "a\u001b[1 qB", 2],
	["CSI malformed Unicode", "a\u001b[\u4e2dmB", 2],
	["C1 CSI", "\u009b31mX\u009b0m", 1],
	["OSC8 BEL", "\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007", 4],
	["OSC8 ST", "\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\", 4],
	["OSC unterminated", "a\u001b]8;;url", 1],
	["OSC CAN abort", "a\u001b]url\u0018B", 2],
	["OSC ESC abort", "a\u001b]url\u001b[31mB", 2],
	["DCS ST", "a\u001bPpayload\u001b\\b", 2],
	["DCS incomplete", "a\u001bPpayload", 1],
	["DCS BEL not terminator", "a\u001bPpayload\u0007b", 1],
	["PM", "a\u001b^payload\u001b\\b", 2],
	["APC", "a\u001b_payload\u001b\\b", 2],
	["ESC7", "a\u001b7b", 2],
	["ESC8", "a\u001b8b", 2],
	["ESC reset", "a\u001bcb", 2],
	["ESC charset", "a\u001b(Bb", 2],
	["ESC multiple intermediate", "a\u001b( Bc", 3],
	["ANSI inside grapheme", "e\u001b[31m\u0301", 1],
	["ANSI inside emoji", "\ud83d\udc69\u001b[31m\u200d\ud83d\udcbb", 2],
	["RI single", "\ud83c\udde6", 1],
	["RI pair", "\ud83c\udde6\ud83c\udde7", 2],
	["RI odd three", "\ud83c\udde6\ud83c\udde7\ud83c\udde8", 3],
	["RI four", "\ud83c\udde6\ud83c\udde7\ud83c\udde8\ud83c\udde9", 4],
	["Hangul filler L", "\u115f", 2],
	["Hangul filler V", "\u1160", 0],
	["Hangul V", "\u1161", 0],
	["Hangul T", "\u11a8", 0],
	["prepend 0600 ASCII", "\u0600a", 1],
	["prepend 0600 CJK", "\u0600\u4e2d", 2],
	["prepend 070F ASCII", "\u070fa", 1],
	["hiragana", "\u3042", 2],
	["fullwidth A", "\uff21", 2],
	["Hangul syllable", "\ud55c", 2],
	["Mc Devanagari base", "\u0915\u093e", 1],
	["copyright", "\u00a9", 1],
	["copyright VS16", "\u00a9\ufe0f", 2],
	["heart VS16", "\u2764\ufe0f", 2],
	["keycap hash", "#\ufe0f\u20e3", 2],
	["ZWJ profession", "\ud83d\udc69\u200d\ud83d\udcbb", 2],
	["skin tone base", "\ud83d\udc4d\ud83c\udffb", 2],
	["ambiguous alpha", "\u03b1", 1],
];
