import { describe, expect, it } from "bun:test";
import * as codes from "./ansiCodes.ts";
import {
	bgRed,
	black,
	blue,
	cyan,
	gray,
	green,
	magenta,
	red,
	white,
	yellow,
} from "./colors.ts";
import {
	bold,
	dim,
	hidden,
	inverse,
	italic,
	strikethrough,
	underline,
} from "./modifiers.ts";
import { applyStyle, composeStyles } from "./styleEngine.ts";

// ────────────────────────────────────────────────────────────────────────────
// applyStyle — basic application
// ────────────────────────────────────────────────────────────────────────────

describe("applyStyle — basic", () => {
	it("wraps text with open and close sequences", () => {
		const result = applyStyle("hello", codes.bold);
		expect(result).toBe("\x1b[1mhello\x1b[22m");
	});

	it("returns empty string for empty input", () => {
		const result = applyStyle("", codes.bold);
		expect(result).toBe("");
	});

	it("applies foreground color codes", () => {
		const result = applyStyle("hello", codes.red);
		expect(result).toBe("\x1b[31mhello\x1b[39m");
	});

	it("applies background color codes", () => {
		const result = applyStyle("hello", codes.bgBlue);
		expect(result).toBe("\x1b[44mhello\x1b[49m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// applyStyle — nesting
// ────────────────────────────────────────────────────────────────────────────

describe("applyStyle — nesting", () => {
	it("bold wrapping red — no interference since close codes differ", () => {
		// red("world") = "\x1b[31mworld\x1b[39m"
		// Bold close is 22m, red close is 39m — they don't collide.
		// Bold remains active through the red segment because red only
		// resets the foreground color, not the intensity attribute.
		const inner = applyStyle("world", codes.red);
		const outer = applyStyle(`hello ${inner}!`, codes.bold);

		expect(outer).toBe("\x1b[1mhello \x1b[31mworld\x1b[39m!\x1b[22m");
	});

	it("handles bold wrapping dim where both share close code 22m", () => {
		// Both bold and dim close with \x1b[22m. When bold wraps dim, the
		// dim close should trigger bold to reopen.
		const inner = applyStyle("soft", codes.dim);
		const outer = applyStyle(`start ${inner} end`, codes.bold);

		expect(outer).toBe("\x1b[1mstart \x1b[2msoft\x1b[22m\x1b[1m end\x1b[22m");
	});

	it("handles deeply nested same-close styles", () => {
		// bold > dim > bold — all close with 22m
		const innerBold = applyStyle("deep", codes.bold);
		const mid = applyStyle(`mid ${innerBold} mid`, codes.dim);
		const outer = applyStyle(`outer ${mid} outer`, codes.bold);

		// Verify structure: bold opens, dim content has its own nesting,
		// and bold's close appears at the end
		expect(outer.startsWith("\x1b[1m")).toBe(true);
		expect(outer.endsWith("\x1b[22m")).toBe(true);
		// Content is preserved
		expect(outer).toContain("outer");
		expect(outer).toContain("mid");
		expect(outer).toContain("deep");
	});

	it("different style categories nest without interference", () => {
		// italic (close 23m) nested inside red (close 39m) — no shared close
		const inner = applyStyle("emphasis", codes.italic);
		const outer = applyStyle(`text ${inner} more`, codes.red);

		expect(outer).toBe("\x1b[31mtext \x1b[3memphasis\x1b[23m more\x1b[39m");
	});

	it("background nested in foreground does not interfere", () => {
		const inner = applyStyle("bg", codes.bgBlue);
		const outer = applyStyle(`fg ${inner} fg`, codes.red);

		// bg close (49m) doesn't match fg close (39m), so no reopening needed
		expect(outer).toBe("\x1b[31mfg \x1b[44mbg\x1b[49m fg\x1b[39m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// applyStyle — pre-styled input
// ────────────────────────────────────────────────────────────────────────────

describe("applyStyle — pre-styled input", () => {
	it("handles input that already contains matching close codes", () => {
		// Simulate text that was previously styled and still has residual codes
		const preStyled = "\x1b[1malready bold\x1b[22m";
		const result = applyStyle(preStyled, codes.bold);

		// The inner close (22m) triggers bold reopen, then outer close
		expect(result).toBe("\x1b[1m\x1b[1malready bold\x1b[22m\x1b[1m\x1b[22m");
	});

	it("passes through text with unrelated ANSI codes unchanged", () => {
		const preStyled = "\x1b[3mitalic text\x1b[23m";
		const result = applyStyle(preStyled, codes.bold);

		// italic close (23m) does not match bold close (22m), no reopening
		expect(result).toBe("\x1b[1m\x1b[3mitalic text\x1b[23m\x1b[22m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// applyStyle — boundary / edge cases
// ────────────────────────────────────────────────────────────────────────────

describe("applyStyle — edge cases", () => {
	it("handles text that is only whitespace", () => {
		const result = applyStyle("  ", codes.bold);
		expect(result).toBe("\x1b[1m  \x1b[22m");
	});

	it("handles text with newlines", () => {
		const result = applyStyle("line1\nline2", codes.red);
		expect(result).toBe("\x1b[31mline1\nline2\x1b[39m");
	});

	it("handles multiple close sequences in input", () => {
		// Two red segments nested inside bold
		const r1 = applyStyle("a", codes.red);
		const r2 = applyStyle("b", codes.red);
		const outer = applyStyle(`${r1} and ${r2}`, codes.bold);

		// Each red close (39m) should NOT trigger bold reopen since 39m !== 22m
		// But let's verify bold still wraps correctly
		expect(outer.startsWith("\x1b[1m")).toBe(true);
		expect(outer.endsWith("\x1b[22m")).toBe(true);
		expect(outer).toContain("\x1b[31ma\x1b[39m");
		expect(outer).toContain("\x1b[31mb\x1b[39m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// composeStyles
// ────────────────────────────────────────────────────────────────────────────

describe("composeStyles", () => {
	it("composes two styles into a single pair", () => {
		const boldRed = composeStyles(codes.bold, codes.red);
		expect(boldRed.open).toBe("\x1b[1m\x1b[31m");
		expect(boldRed.close).toBe("\x1b[39m\x1b[22m");
	});

	it("composed pair works with applyStyle", () => {
		const boldRed = composeStyles(codes.bold, codes.red);
		const result = applyStyle("error", boldRed);
		expect(result).toBe("\x1b[1m\x1b[31merror\x1b[39m\x1b[22m");
	});

	it("composes three styles", () => {
		const style = composeStyles(codes.bold, codes.italic, codes.red);
		expect(style.open).toBe("\x1b[1m\x1b[3m\x1b[31m");
		expect(style.close).toBe("\x1b[39m\x1b[23m\x1b[22m");
	});

	it("returns identity pair for empty input", () => {
		const style = composeStyles();
		expect(style.open).toBe("");
		expect(style.close).toBe("");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Modifier convenience functions
// ────────────────────────────────────────────────────────────────────────────

describe("modifier functions", () => {
	it("bold applies bold codes", () => {
		expect(bold("text")).toBe("\x1b[1mtext\x1b[22m");
	});

	it("dim applies dim codes", () => {
		expect(dim("text")).toBe("\x1b[2mtext\x1b[22m");
	});

	it("italic applies italic codes", () => {
		expect(italic("text")).toBe("\x1b[3mtext\x1b[23m");
	});

	it("underline applies underline codes", () => {
		expect(underline("text")).toBe("\x1b[4mtext\x1b[24m");
	});

	it("inverse applies inverse codes", () => {
		expect(inverse("text")).toBe("\x1b[7mtext\x1b[27m");
	});

	it("hidden applies hidden codes", () => {
		expect(hidden("text")).toBe("\x1b[8mtext\x1b[28m");
	});

	it("strikethrough applies strikethrough codes", () => {
		expect(strikethrough("text")).toBe("\x1b[9mtext\x1b[29m");
	});

	it("modifiers return empty for empty input", () => {
		expect(bold("")).toBe("");
		expect(italic("")).toBe("");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Color convenience functions
// ────────────────────────────────────────────────────────────────────────────

describe("foreground color functions", () => {
	it("black applies code 30", () => {
		expect(black("t")).toBe("\x1b[30mt\x1b[39m");
	});

	it("red applies code 31", () => {
		expect(red("t")).toBe("\x1b[31mt\x1b[39m");
	});

	it("green applies code 32", () => {
		expect(green("t")).toBe("\x1b[32mt\x1b[39m");
	});

	it("yellow applies code 33", () => {
		expect(yellow("t")).toBe("\x1b[33mt\x1b[39m");
	});

	it("blue applies code 34", () => {
		expect(blue("t")).toBe("\x1b[34mt\x1b[39m");
	});

	it("magenta applies code 35", () => {
		expect(magenta("t")).toBe("\x1b[35mt\x1b[39m");
	});

	it("cyan applies code 36", () => {
		expect(cyan("t")).toBe("\x1b[36mt\x1b[39m");
	});

	it("white applies code 37", () => {
		expect(white("t")).toBe("\x1b[37mt\x1b[39m");
	});

	it("gray applies code 90", () => {
		expect(gray("t")).toBe("\x1b[90mt\x1b[39m");
	});

	it("colors return empty for empty input", () => {
		expect(red("")).toBe("");
	});
});

describe("background color functions", () => {
	it("bgRed applies code 41", () => {
		expect(bgRed("t")).toBe("\x1b[41mt\x1b[49m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Integration — real-world nesting patterns
// ────────────────────────────────────────────────────────────────────────────

describe("integration — composable nesting", () => {
	it("bold + italic + color produces correct output", () => {
		const colored = red("error");
		const emphasized = italic(colored);
		const result = bold(`Fatal: ${emphasized}`);

		// Verify the output starts bold, contains italic+red, and ends clean
		expect(result.startsWith("\x1b[1m")).toBe(true);
		expect(result.endsWith("\x1b[22m")).toBe(true);
		expect(result).toContain("Fatal: ");
		expect(result).toContain("error");
	});

	it("nesting same-category colors reopens outer after inner close", () => {
		// red wrapping blue — both close with 39m
		const inner = blue("sky");
		const outer = red(`roses ${inner} are red`);

		// After blue's close (39m), red reopens (31m)
		expect(outer).toBe(
			"\x1b[31mroses \x1b[34msky\x1b[39m\x1b[31m are red\x1b[39m",
		);
	});

	it("modifier wrapping modifier with shared close", () => {
		// bold and dim both close with 22m
		const inner = dim("quiet");
		const outer = bold(`loud ${inner} loud`);

		expect(outer).toBe("\x1b[1mloud \x1b[2mquiet\x1b[22m\x1b[1m loud\x1b[22m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// AnsiPair structure
// ────────────────────────────────────────────────────────────────────────────

describe("AnsiPair structure", () => {
	it("all code pairs have open and close strings", () => {
		const pairs = [
			codes.bold,
			codes.dim,
			codes.italic,
			codes.underline,
			codes.inverse,
			codes.hidden,
			codes.strikethrough,
			codes.red,
			codes.green,
			codes.blue,
			codes.yellow,
			codes.cyan,
			codes.magenta,
			codes.white,
			codes.black,
			codes.gray,
			codes.bgRed,
			codes.bgGreen,
			codes.bgBlue,
		];

		// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences
		const ansiPattern = /^\x1b\[\d+m$/;
		for (const p of pairs) {
			expect(typeof p.open).toBe("string");
			expect(typeof p.close).toBe("string");
			expect(ansiPattern.test(p.open)).toBe(true);
			expect(ansiPattern.test(p.close)).toBe(true);
		}
	});

	it("modifier close codes are unique per category", () => {
		// bold and dim share 22m (intentional — intensity reset)
		expect(codes.bold.close).toBe(codes.dim.close);

		// italic, underline, strikethrough each have unique close codes
		expect(codes.italic.close).not.toBe(codes.underline.close);
		expect(codes.underline.close).not.toBe(codes.strikethrough.close);
	});

	it("all foreground colors share close code 39m", () => {
		const fgColors = [
			codes.black,
			codes.red,
			codes.green,
			codes.yellow,
			codes.blue,
			codes.magenta,
			codes.cyan,
			codes.white,
			codes.gray,
		];
		for (const c of fgColors) {
			expect(c.close).toBe("\x1b[39m");
		}
	});

	it("all background colors share close code 49m", () => {
		const bgColors = [
			codes.bgBlack,
			codes.bgRed,
			codes.bgGreen,
			codes.bgYellow,
			codes.bgBlue,
			codes.bgMagenta,
			codes.bgCyan,
			codes.bgWhite,
		];
		for (const c of bgColors) {
			expect(c.close).toBe("\x1b[49m");
		}
	});
});
