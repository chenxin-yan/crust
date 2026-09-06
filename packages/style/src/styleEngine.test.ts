import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import * as codes from "./ansiCodes.ts";
import {
	bgRed,
	black,
	blue,
	bold,
	cyan,
	dim,
	gray,
	green,
	hidden,
	inverse,
	italic,
	magenta,
	red,
	strikethrough,
	underline,
	white,
	yellow,
} from "./runtimeExports.ts";
import { applyStyle } from "./styleEngine.ts";
import { setEnv, snapshotEnv } from "./testEnv.ts";

const restoreEnv = snapshotEnv("FORCE_COLOR");
beforeAll(() => setEnv("FORCE_COLOR", "3"));
afterAll(restoreEnv);

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

		expect(outer).toBe(
			"\x1b[1mouter \x1b[2mmid \x1b[1mdeep\x1b[22m\x1b[1m\x1b[2m mid\x1b[22m\x1b[1m outer\x1b[22m",
		);
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
});

describe("background color functions", () => {
	it("bgRed applies code 41", () => {
		expect(bgRed("t")).toBe("\x1b[41mt\x1b[49m");
	});
});
