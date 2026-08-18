import { stripVTControlCharacters } from "node:util";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const zeroWidth = /[\p{Cc}\p{Cf}\p{Mn}\p{Me}]/u;
const emoji = /\p{Extended_Pictographic}/u;

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
			(code >= 0x20000 && code <= 0x3fffd))
	);
}

/** Measure terminal columns, ignoring ANSI escapes. */
export function stringWidth(input: string): number {
	let width = 0;
	for (const { segment } of segmenter.segment(stripVTControlCharacters(input))) {
		if (emoji.test(segment)) {
			width += 2;
			continue;
		}
		for (const character of segment) {
			const code = character.codePointAt(0)!;
			if (!zeroWidth.test(character)) width += isFullWidth(code) ? 2 : 1;
		}
	}
	return width;
}
