import { describe, expect, it } from "bun:test";
import * as codes from "./ansiCodes.ts";
import {
	bgHex,
	bgHexCode,
	bgRgb,
	bgRgbCode,
	hex,
	hexCode,
	parseHex,
	rgb,
	rgbCode,
} from "./dynamicColors.ts";
import { applyStyle, composeStyles } from "./styleEngine.ts";

// ────────────────────────────────────────────────────────────────────────────
// parseHex
// ────────────────────────────────────────────────────────────────────────────

describe("parseHex", () => {
	it("parses 6-digit hex", () => {
		expect(parseHex("#ff0000")).toEqual([255, 0, 0]);
		expect(parseHex("#00ff00")).toEqual([0, 255, 0]);
		expect(parseHex("#0000ff")).toEqual([0, 0, 255]);
		expect(parseHex("#ffffff")).toEqual([255, 255, 255]);
		expect(parseHex("#000000")).toEqual([0, 0, 0]);
	});

	it("parses 3-digit shorthand hex", () => {
		expect(parseHex("#f00")).toEqual([255, 0, 0]);
		expect(parseHex("#0f0")).toEqual([0, 255, 0]);
		expect(parseHex("#00f")).toEqual([0, 0, 255]);
		expect(parseHex("#fff")).toEqual([255, 255, 255]);
		expect(parseHex("#000")).toEqual([0, 0, 0]);
	});

	it("is case-insensitive", () => {
		expect(parseHex("#FF0000")).toEqual([255, 0, 0]);
		expect(parseHex("#Ff8800")).toEqual([255, 136, 0]);
		expect(parseHex("#ABC")).toEqual([170, 187, 204]);
	});

	it("throws TypeError for invalid hex strings", () => {
		expect(() => parseHex("ff0000")).toThrow(TypeError);
		expect(() => parseHex("#gg0000")).toThrow(TypeError);
		expect(() => parseHex("#ff00")).toThrow(TypeError);
		expect(() => parseHex("#ff000000")).toThrow(TypeError);
		expect(() => parseHex("")).toThrow(TypeError);
		expect(() => parseHex("#")).toThrow(TypeError);
	});

	it("error message includes the invalid input", () => {
		expect(() => parseHex("bad")).toThrow('Invalid hex color: "bad"');
	});
});

// ────────────────────────────────────────────────────────────────────────────
// rgbCode / bgRgbCode — ANSI pair factories
// ────────────────────────────────────────────────────────────────────────────

describe("rgbCode", () => {
	it("produces correct foreground truecolor open/close", () => {
		const pair = rgbCode(255, 0, 0);
		expect(pair.open).toBe("\x1b[38;2;255;0;0m");
		expect(pair.close).toBe("\x1b[39m");
	});

	it("produces correct pair for arbitrary values", () => {
		const pair = rgbCode(128, 64, 32);
		expect(pair.open).toBe("\x1b[38;2;128;64;32m");
		expect(pair.close).toBe("\x1b[39m");
	});

	it("throws RangeError for out-of-range values", () => {
		expect(() => rgbCode(256, 0, 0)).toThrow(RangeError);
		expect(() => rgbCode(-1, 0, 0)).toThrow(RangeError);
		expect(() => rgbCode(0, 300, 0)).toThrow(RangeError);
		expect(() => rgbCode(0, 0, -5)).toThrow(RangeError);
	});

	it("throws RangeError for non-integer values", () => {
		expect(() => rgbCode(1.5, 0, 0)).toThrow(RangeError);
		expect(() => rgbCode(0, 0.1, 0)).toThrow(RangeError);
	});

	it("throws RangeError for NaN", () => {
		expect(() => rgbCode(Number.NaN, 0, 0)).toThrow(RangeError);
	});
});

describe("bgRgbCode", () => {
	it("produces correct background truecolor open/close", () => {
		const pair = bgRgbCode(0, 128, 255);
		expect(pair.open).toBe("\x1b[48;2;0;128;255m");
		expect(pair.close).toBe("\x1b[49m");
	});

	it("throws RangeError for invalid values", () => {
		expect(() => bgRgbCode(256, 0, 0)).toThrow(RangeError);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// hexCode / bgHexCode — ANSI pair factories
// ────────────────────────────────────────────────────────────────────────────

describe("hexCode", () => {
	it("produces correct foreground pair from 6-digit hex", () => {
		const pair = hexCode("#ff0000");
		expect(pair.open).toBe("\x1b[38;2;255;0;0m");
		expect(pair.close).toBe("\x1b[39m");
	});

	it("produces correct foreground pair from 3-digit hex", () => {
		const pair = hexCode("#f00");
		expect(pair.open).toBe("\x1b[38;2;255;0;0m");
		expect(pair.close).toBe("\x1b[39m");
	});

	it("throws TypeError for invalid hex", () => {
		expect(() => hexCode("bad")).toThrow(TypeError);
	});
});

describe("bgHexCode", () => {
	it("produces correct background pair from hex", () => {
		const pair = bgHexCode("#00ff88");
		expect(pair.open).toBe("\x1b[48;2;0;255;136m");
		expect(pair.close).toBe("\x1b[49m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// rgb / bgRgb / hex / bgHex — direct styling functions
// ────────────────────────────────────────────────────────────────────────────

describe("rgb", () => {
	it("applies truecolor foreground to text", () => {
		const result = rgb("hello", 255, 0, 0);
		expect(result).toBe("\x1b[38;2;255;0;0mhello\x1b[39m");
	});

	it("returns empty string for empty input", () => {
		expect(rgb("", 255, 0, 0)).toBe("");
	});
});

describe("bgRgb", () => {
	it("applies truecolor background to text", () => {
		const result = bgRgb("hello", 0, 128, 255);
		expect(result).toBe("\x1b[48;2;0;128;255mhello\x1b[49m");
	});

	it("returns empty string for empty input", () => {
		expect(bgRgb("", 0, 0, 0)).toBe("");
	});
});

describe("hex", () => {
	it("applies truecolor foreground from hex", () => {
		const result = hex("hello", "#ff0000");
		expect(result).toBe("\x1b[38;2;255;0;0mhello\x1b[39m");
	});

	it("works with shorthand hex", () => {
		const result = hex("hello", "#f00");
		expect(result).toBe("\x1b[38;2;255;0;0mhello\x1b[39m");
	});

	it("returns empty string for empty input", () => {
		expect(hex("", "#fff")).toBe("");
	});
});

describe("bgHex", () => {
	it("applies truecolor background from hex", () => {
		const result = bgHex("hello", "#00ff88");
		expect(result).toBe("\x1b[48;2;0;255;136mhello\x1b[49m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Nesting — truecolor with existing static styles
// ────────────────────────────────────────────────────────────────────────────

describe("nesting with static styles", () => {
	it("truecolor fg nested in bold — no interference", () => {
		const inner = rgb("world", 255, 0, 0);
		const outer = applyStyle(`hello ${inner}!`, codes.bold);

		expect(outer).toBe("\x1b[1mhello \x1b[38;2;255;0;0mworld\x1b[39m!\x1b[22m");
	});

	it("static fg nested in truecolor fg — same close code (39m) triggers reopen", () => {
		const inner = applyStyle("static", codes.red);
		const outer = applyStyle(`before ${inner} after`, rgbCode(0, 128, 255));

		// red close (39m) matches rgb close (39m), so rgb reopens
		expect(outer).toBe(
			"\x1b[38;2;0;128;255mbefore \x1b[31mstatic\x1b[39m\x1b[38;2;0;128;255m after\x1b[39m",
		);
	});

	it("truecolor bg nested in static bg — same close code (49m) triggers reopen", () => {
		const inner = bgRgb("inner", 255, 128, 0);
		const outer = applyStyle(`A ${inner} B`, codes.bgBlue);

		// bgRgb close (49m) matches bgBlue close (49m), so bgBlue reopens
		expect(outer).toBe(
			"\x1b[44mA \x1b[48;2;255;128;0minner\x1b[49m\x1b[44m B\x1b[49m",
		);
	});

	it("truecolor fg and bg composed with composeStyles", () => {
		const fgBg = composeStyles(rgbCode(255, 0, 0), bgRgbCode(0, 0, 255));
		const result = applyStyle("styled", fgBg);
		expect(result).toBe(
			"\x1b[38;2;255;0;0m\x1b[48;2;0;0;255mstyled\x1b[49m\x1b[39m",
		);
	});

	it("truecolor composed with static modifier", () => {
		const boldRgb = composeStyles(codes.bold, rgbCode(128, 64, 32));
		const result = applyStyle("text", boldRgb);
		expect(result).toBe("\x1b[1m\x1b[38;2;128;64;32mtext\x1b[39m\x1b[22m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Edge cases
// ────────────────────────────────────────────────────────────────────────────

describe("edge cases", () => {
	it("boundary values 0 and 255 are accepted", () => {
		expect(() => rgbCode(0, 0, 0)).not.toThrow();
		expect(() => rgbCode(255, 255, 255)).not.toThrow();
	});

	it("hex boundary values produce correct results", () => {
		expect(hexCode("#000000").open).toBe("\x1b[38;2;0;0;0m");
		expect(hexCode("#ffffff").open).toBe("\x1b[38;2;255;255;255m");
	});

	it("rgbCode close matches static foreground close", () => {
		const pair = rgbCode(100, 100, 100);
		expect(pair.close).toBe(codes.red.close);
	});

	it("bgRgbCode close matches static background close", () => {
		const pair = bgRgbCode(100, 100, 100);
		expect(pair.close).toBe(codes.bgRed.close);
	});
});
