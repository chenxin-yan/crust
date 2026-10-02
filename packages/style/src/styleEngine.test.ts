import { describe, expect, it } from "vite-plus/test";

import { styleMethodPairs } from "./ansiCodes.ts";
import { applyStyle } from "./styleEngine.ts";

// ────────────────────────────────────────────────────────────────────────────
// applyStyle — basic application
// ────────────────────────────────────────────────────────────────────────────

describe("applyStyle — basic", () => {
	it("wraps text with open and close sequences", () => {
		const result = applyStyle("hello", styleMethodPairs.bold);
		expect(result).toBe("\x1b[1mhello\x1b[22m");
	});

	it("returns empty string for empty input", () => {
		const result = applyStyle("", styleMethodPairs.bold);
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
		const inner = applyStyle("world", styleMethodPairs.red);
		const outer = applyStyle(`hello ${inner}!`, styleMethodPairs.bold);

		expect(outer).toBe("\x1b[1mhello \x1b[31mworld\x1b[39m!\x1b[22m");
	});

	it("handles bold wrapping dim where both share close code 22m", () => {
		// Both bold and dim close with \x1b[22m. When bold wraps dim, the
		// dim close should trigger bold to reopen.
		const inner = applyStyle("soft", styleMethodPairs.dim);
		const outer = applyStyle(`start ${inner} end`, styleMethodPairs.bold);

		expect(outer).toBe("\x1b[1mstart \x1b[2msoft\x1b[22m\x1b[1m end\x1b[22m");
	});

	it("handles deeply nested same-close styles", () => {
		// bold > dim > bold — all close with 22m
		const innerBold = applyStyle("deep", styleMethodPairs.bold);
		const mid = applyStyle(`mid ${innerBold} mid`, styleMethodPairs.dim);
		const outer = applyStyle(`outer ${mid} outer`, styleMethodPairs.bold);

		expect(outer).toBe(
			"\x1b[1mouter \x1b[2mmid \x1b[1mdeep\x1b[22m\x1b[1m\x1b[2m mid\x1b[22m\x1b[1m outer\x1b[22m",
		);
	});

	it("different style categories nest without interference", () => {
		// italic (close 23m) nested inside red (close 39m) — no shared close
		const inner = applyStyle("emphasis", styleMethodPairs.italic);
		const outer = applyStyle(`text ${inner} more`, styleMethodPairs.red);

		expect(outer).toBe("\x1b[31mtext \x1b[3memphasis\x1b[23m more\x1b[39m");
	});

	it("background nested in foreground does not interfere", () => {
		const inner = applyStyle("bg", styleMethodPairs.bgBlue);
		const outer = applyStyle(`fg ${inner} fg`, styleMethodPairs.red);

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
		const result = applyStyle(preStyled, styleMethodPairs.bold);

		// The inner close (22m) triggers bold reopen, then outer close
		expect(result).toBe("\x1b[1m\x1b[1malready bold\x1b[22m\x1b[1m\x1b[22m");
	});

	it("passes through text with unrelated ANSI codes unchanged", () => {
		const preStyled = "\x1b[3mitalic text\x1b[23m";
		const result = applyStyle(preStyled, styleMethodPairs.bold);

		// italic close (23m) does not match bold close (22m), no reopening
		expect(result).toBe("\x1b[1m\x1b[3mitalic text\x1b[23m\x1b[22m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// applyStyle — boundary / edge cases
// ────────────────────────────────────────────────────────────────────────────

describe("applyStyle — edge cases", () => {
	it("handles text that is only whitespace", () => {
		const result = applyStyle("  ", styleMethodPairs.bold);
		expect(result).toBe("\x1b[1m  \x1b[22m");
	});

	it("handles text with newlines", () => {
		const result = applyStyle("line1\nline2", styleMethodPairs.red);
		expect(result).toBe("\x1b[31mline1\nline2\x1b[39m");
	});

	it("is null-safe (matches chain behavior)", () => {
		expect(applyStyle(undefined, styleMethodPairs.bold)).toBe("");
		expect(applyStyle(null, styleMethodPairs.red)).toBe("");
	});
});
