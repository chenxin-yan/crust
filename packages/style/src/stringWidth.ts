import { stripVTControlCharacters } from "node:util";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const zeroWidth = /[\p{Cc}\p{Cf}\p{Mn}\p{Me}]/u;
// Wide iff rendered with emoji presentation: default-emoji code points, or
// any Emoji code point forced emoji by VS16 (covers keycaps like "1\uFE0F\u20E3").
// Text-presentation pictographs (©, ☺) stay narrow.
const emoji = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/u;

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
			// ranges above; generate from Unicode EastAsianWidth data if it matters.
			(code >= 0x16fe0 && code <= 0x1b2fb) ||
			(code >= 0x1f200 && code <= 0x1f2ff) ||
			(code >= 0x20000 && code <= 0x3fffd))
	);
}

/** @internal JavaScript fallback for runtimes without a native width implementation. */
export function stringWidthJs(input: string): number {
	let width = 0;
	for (const { segment } of segmenter.segment(stripVTControlCharacters(input))) {
		if (emoji.test(segment)) {
			width += 2;
			continue;
		}
		// Width of the grapheme's base code point only — spacing combining marks
		// (Mc) and conjoined jamo grouped into the cluster don't add columns.
		const code = segment.codePointAt(0)!;
		if (!zeroWidth.test(String.fromCodePoint(code))) width += isFullWidth(code) ? 2 : 1;
	}
	return width;
}

/** Measure terminal columns, ignoring ANSI escapes. */
export function stringWidth(input: string): number {
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
