const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const zeroWidth = /[\p{Cc}\p{Cf}\p{Mn}\p{Me}]/u;
// Wide iff rendered with emoji presentation: default-emoji code points, or
// any Emoji code point forced emoji by VS16 (covers keycaps like "1\uFE0F\u20E3").
// Text-presentation pictographs (©, ☺) stay narrow.
const emoji = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/u;
// Escape sequences measure zero columns the way Bun's recognizer treats them,
// which node:util.stripVTControlCharacters does not: CSI runs through its final
// byte (colon SGR parameters included) or to the end of the string; OSC runs to
// BEL/ST, DCS/SOS/PM/APC to ST only, each else to the end of the string; nF and
// two-byte ESC sequences drop their trailing byte(s). CAN, SUB and C1 ST abort a sequence.
const ansi = new RegExp(
	[
		String.raw`(?:\x1b\[|\x9b)[^\x1b\x18\x1a\x9c\x40-\x7e]*[\x40-\x7e\x18\x1a\x9c]?`,
		String.raw`(?:\x1b\]|\x9d)[^\x07\x1b\x18\x1a\x9c]*(?:\x07|\x1b\\|[\x18\x1a\x9c])?`,
		String.raw`(?:\x1b[PX^_]|[\x90\x98\x9e\x9f])[^\x1b\x18\x1a\x9c]*(?:\x1b\\|[\x18\x1a\x9c])?`,
		String.raw`\x1b[\x20-\x2f][^\x1b]?`,
		String.raw`\x1b[\x30-\x7e]?`,
	].join("|"),
	"g",
);

function isFullWidth(code: number): boolean {
	return (
		code >= 0x1100 &&
		(code <= 0x115f ||
			code === 0x2329 ||
			code === 0x232a ||
			(code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
			(code >= 0xac00 && code <= 0xd7a3) ||
			(code >= 0xf900 && code <= 0xfaff) ||
			(code >= 0xfe10 && code <= 0xfe19) ||
			(code >= 0xfe30 && code <= 0xfe6f) ||
			(code >= 0xff00 && code <= 0xff60) ||
			(code >= 0xffe0 && code <= 0xffe6) ||
			// ponytail: coarse block spans (Tangut…Kana Extended, Enclosed Ideographic
			// Supplement) that treat interior unassigned gaps as wide, like the CJK
			// ranges above; generate from Unicode EastAsianWidth data if a
			// width-misalignment report lands on a code point inside these blocks.
			(code >= 0x16fe0 && code <= 0x1b2fb) ||
			(code >= 0x1f200 && code <= 0x1f2ff) ||
			(code >= 0x20000 && code <= 0x3fffd))
	);
}

function isZeroWidth(code: number): boolean {
	return (
		zeroWidth.test(String.fromCodePoint(code)) ||
		// Conjoining jamo medials/finals (and fillers) merge into the syllable before them.
		(code >= 0x1160 && code <= 0x11ff) ||
		(code >= 0xd7b0 && code <= 0xd7ff)
	);
}

/**
 * @internal JavaScript fallback for runtimes without a native width implementation.
 * Matches `Bun.stringWidth` for common terminal text (ASCII, ANSI, CJK, emoji,
 * combining marks); exotic clusters may measure differently.
 */
export function stringWidthJs(input: string): number {
	// Printable ASCII has one column per code unit; controls/ANSI still use the fallback.
	if (!/[^\x20-\x7e]/.test(input)) return input.length;
	let width = 0;
	for (const { segment } of segmenter.segment(input.replace(ansi, ""))) {
		if (emoji.test(segment)) {
			// A lone regional indicator (no flag pair) renders in one column.
			const code = segment.codePointAt(0)!;
			width += segment.length === 2 && code >= 0x1f1e6 && code <= 0x1f1ff ? 1 : 2;
			continue;
		}
		// Width of the cluster's base: its first code point that is not a control,
		// format or nonspacing mark, so a prepended mark ("\u0600a") keeps the
		// base's column while spacing marks (Mc) and conjoined jamo add none.
		for (const character of segment) {
			const code = character.codePointAt(0)!;
			if (isZeroWidth(code)) continue;
			width += isFullWidth(code) ? 2 : 1;
			break;
		}
	}
	return width;
}

/** Measure terminal columns, ignoring ANSI escapes. */
export function stringWidth(input: string): number {
	// SAFETY: this only describes the optional Bun global; optional access preserves portability.
	const bun = (
		globalThis as {
			Bun?: {
				stringWidth(value: string, options?: { countAnsiEscapeCodes?: boolean }): number;
			};
		}
	).Bun;

	// Prefer Bun's native stringWidth when the Bun global is present; fall back
	// to the JS implementation on other runtimes.
	// The globalThis cast avoids a ReferenceError on runtimes without the Bun
	// global (Node, Deno) and keeps Bun types out of the portable package.
	// If a native split ever needs real tree-shaking, use package.json export
	// conditions ("bun" vs "default"), not runtime guards — guards always ship
	// the fallback in the bundle.
	return bun?.stringWidth(input, { countAnsiEscapeCodes: false }) ?? stringWidthJs(input);
}
