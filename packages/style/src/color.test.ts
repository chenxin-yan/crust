import { describe, expect, it } from "bun:test";

import * as codes from "./ansiCodes.ts";
import { bg, fg } from "./color.ts";
import { applyStyle } from "./styleEngine.ts";
import type { ColorString } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// ColorString — compile-time assignability checks (no runtime assertions)
// ────────────────────────────────────────────────────────────────────────────

// Syntax-hint literals and filled-in functional notation are assignable.
"rgb()" satisfies ColorString;
"rgb(0, 128, 255)" satisfies ColorString;
"oklch(70% 0.1 200)" satisfies ColorString;
"color-mix(in srgb, red, blue)" satisfies ColorString;
"#ff0000" satisfies ColorString;
// Dynamic strings still type-check via the LiteralUnion fallback.
"dynamic" as string satisfies ColorString;

// ────────────────────────────────────────────────────────────────────────────
// fg / bg — direct styling functions
// ────────────────────────────────────────────────────────────────────────────

describe("fg", () => {
	it("applies truecolor foreground to text from hex", () => {
		expect(fg("hello", "#ff0000")).toBe("\x1b[38;2;255;0;0mhello\x1b[39m");
	});

	it("accepts 3-digit hex shorthand", () => {
		expect(fg("hello", "#f00")).toBe("\x1b[38;2;255;0;0mhello\x1b[39m");
	});

	it("accepts named CSS colors", () => {
		expect(fg("hi", "rebeccapurple")).toBe("\x1b[38;2;102;51;153mhi\x1b[39m");
	});

	it("accepts `hsl()` strings", () => {
		// hsl(0, 100%, 50%) === pure red
		expect(fg("x", "hsl(0, 100%, 50%)")).toBe("\x1b[38;2;255;0;0mx\x1b[39m");
	});

	it("accepts `rgb()` strings", () => {
		expect(fg("x", "rgb(0, 128, 255)")).toBe("\x1b[38;2;0;128;255mx\x1b[39m");
	});

	it("accepts `color-mix()` strings", () => {
		// color-mix(in srgb, red, blue) === purple #800080
		expect(fg("x", "color-mix(in srgb, red, blue)")).toBe("\x1b[38;2;128;0;128mx\x1b[39m");
	});

	it("accepts `{ r, g, b }` objects", () => {
		expect(fg("x", { r: 255, g: 0, b: 0 })).toBe("\x1b[38;2;255;0;0mx\x1b[39m");
	});

	it("throws TypeError with quoted input embedded in message", () => {
		expect(() => fg("x", "bogus")).toThrow('Invalid color input: "bogus"');
	});

	it("throws TypeError for `null`", () => {
		// @ts-expect-error — runtime contract test for unsupported inputs
		expect(() => fg("x", null)).toThrow(TypeError);
	});

	it("applies truecolor foreground from `rgb()`", () => {
		expect(fg("ocean", "rgb(0, 128, 255)")).toBe("\x1b[38;2;0;128;255mocean\x1b[39m");
	});

	it("applies truecolor foreground from numeric input", () => {
		expect(fg("red", 0xff0000)).toBe("\x1b[38;2;255;0;0mred\x1b[39m");
	});

	it("applies truecolor foreground from `[r, g, b]`", () => {
		expect(fg("ocean", [0, 128, 255])).toBe("\x1b[38;2;0;128;255mocean\x1b[39m");
	});

	it('returns `""` for empty text after validating input', () => {
		// Valid color + empty text → "". Invalid color still throws (see
		// next test) so empty-text callers can't accidentally mask bugs.
		expect(fg("", "#ff0000")).toBe("");
	});

	it("throws TypeError for invalid input even when text is empty", () => {
		// Empty text used to silently short-circuit before the color was
		// validated. Now both empty- and non-empty-text callers get the
		// same TypeError.
		expect(() => fg("hello", "definitely-not-a-color")).toThrow(TypeError);
		expect(() => fg("", "definitely-not-a-color")).toThrow(TypeError);
	});
});

describe("bg", () => {
	it("applies truecolor background to text from hex", () => {
		expect(bg("hello", "#00ff88")).toBe("\x1b[48;2;0;255;136mhello\x1b[49m");
	});

	it("applies truecolor background from named CSS color", () => {
		expect(bg("hi", "rebeccapurple")).toBe("\x1b[48;2;102;51;153mhi\x1b[49m");
	});

	it('returns `""` for empty text after validating input', () => {
		expect(bg("", "#00ff88")).toBe("");
	});

	it("throws for invalid input even when text is empty", () => {
		// Empty text used to silently short-circuit before color
		// validation, so `bg("", "definitely-not-a-color")` returned "".
		// Now both empty- and non-empty-text callers get TypeError.
		expect(() => bg("hi", "definitely-not-a-color")).toThrow(TypeError);
		expect(() => bg("", "definitely-not-a-color")).toThrow(TypeError);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Nesting parity with static styles
// ────────────────────────────────────────────────────────────────────────────

describe("nesting with static styles", () => {
	it("dynamic fg nested in bold — no interference", () => {
		const inner = fg("world", "#ff0000");
		const outer = applyStyle(`hello ${inner}!`, codes.bold);

		expect(outer).toBe("\x1b[1mhello \x1b[38;2;255;0;0mworld\x1b[39m!\x1b[22m");
	});

	it("static fg nested in dynamic fg — same close (39m) triggers reopen", () => {
		const inner = applyStyle("static", codes.red);
		const outer = applyStyle(`before ${inner} after`, {
			open: "\x1b[38;2;0;128;255m",
			close: "\x1b[39m",
		});

		// red close (39m) matches dynamic fg close (39m), so dynamic fg reopens
		expect(outer).toBe(
			"\x1b[38;2;0;128;255mbefore \x1b[31mstatic\x1b[39m\x1b[38;2;0;128;255m after\x1b[39m",
		);
	});

	it("dynamic bg nested in static bg — same close (49m) triggers reopen", () => {
		const inner = bg("inner", [255, 128, 0]);
		const outer = applyStyle(`A ${inner} B`, codes.bgBlue);

		// bg close (49m) matches bgBlue close (49m), so bgBlue reopens
		expect(outer).toBe("\x1b[44mA \x1b[48;2;255;128;0minner\x1b[49m\x1b[44m B\x1b[49m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Edge cases
// ────────────────────────────────────────────────────────────────────────────

describe("edge cases", () => {
	it("hex shorthand is case-insensitive", () => {
		expect(fg("x", "#FFF")).toBe("\x1b[38;2;255;255;255mx\x1b[39m");
		expect(fg("x", "#aBc")).toBe("\x1b[38;2;170;187;204mx\x1b[39m");
	});

	it("8-digit hex (with alpha) is accepted; alpha is not encoded into ansi-16m", () => {
		// Bun.color drops alpha when emitting ansi-16m. The fg open should still
		// be a valid 24-bit foreground sequence.
		expect(fg("x", "#ff000080")).toBe("\x1b[38;2;255;0;0mx\x1b[39m");
	});

	it("boundary RGB values (0 and 255) round-trip", () => {
		expect(fg("x", [0, 0, 0])).toBe("\x1b[38;2;0;0;0mx\x1b[39m");
		expect(fg("x", [255, 255, 255])).toBe("\x1b[38;2;255;255;255mx\x1b[39m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Depth-aware fg / bg fallback
// ────────────────────────────────────────────────────────────────────────────
//
// fg/bg accept an optional `depth` parameter that selects the matching
// `Bun.color()` format. We assert against `Bun.color()`'s output directly
// rather than hard-coded escape strings so the suite stays tolerant of
// Bun version-to-version output drift (especially in `ansi-16` mode).

describe("fg — depth fallback", () => {
	it('depth="truecolor" emits ansi-16m (default)', () => {
		const expected = `${Bun.color("#ff0000", "ansi-16m")}hello\x1b[39m`;
		expect(fg("hello", "#ff0000", "truecolor")).toBe(expected);
		// Default behavior matches `"truecolor"`.
		expect(fg("hello", "#ff0000")).toBe(expected);
	});

	it('depth="256" emits ansi-256 sequence from Bun.color', () => {
		const open = Bun.color("#ff0000", "ansi-256");
		expect(fg("hello", "#ff0000", "256")).toBe(`${open}hello\x1b[39m`);
	});

	it('depth="16" quantizes to a standard 16-color SGR (no Bun.color ansi-16)', () => {
		// Pure red → bright red (`91`). Open must be a clean compact fg SGR.
		expect(fg("hello", "#ff0000", "16")).toBe("\x1b[91mhello\x1b[39m");
	});

	it('depth="16" covers the standard 16-color palette mapping', () => {
		const cases: ReadonlyArray<{
			input: string;
			param: number;
		}> = [
			{ input: "#000000", param: 30 }, // black
			{ input: "#800000", param: 31 }, // dark red
			{ input: "#008000", param: 32 }, // dark green
			{ input: "#808000", param: 33 }, // dark yellow
			{ input: "#000080", param: 34 }, // dark blue
			{ input: "#800080", param: 35 }, // dark magenta
			{ input: "#008080", param: 36 }, // dark cyan
			{ input: "#c0c0c0", param: 97 }, // bright white (max channel ≥ 75% → bright bucket)
			{ input: "#ff0000", param: 91 }, // bright red
			{ input: "#00ff00", param: 92 }, // bright green
			{ input: "#ffff00", param: 93 }, // bright yellow
			{ input: "#0000ff", param: 94 }, // bright blue
			{ input: "#ff00ff", param: 95 }, // bright magenta
			{ input: "#00ffff", param: 96 }, // bright cyan
			{ input: "#ffffff", param: 97 }, // bright white
		];
		for (const { input, param } of cases) {
			expect(fg("x", input, "16")).toBe(`\x1b[${param}mx\x1b[39m`);
		}
	});

	it('depth="16" output contains no control characters in SGR params (regression)', () => {
		// Bun.color(_, "ansi-16") emits a literal TAB (0x09) where a numeric
		// SGR parameter belongs in some Bun versions (oven-sh/bun#22161). Our
		// quantizer must never produce one.
		for (const input of ["#ff0000", "#00ff00", "#abcdef", "rebeccapurple"]) {
			const out = fg("x", input, "16");
			expect(/[\t\n\r\v\f]/.test(out)).toBe(false);
		}
	});

	it('depth="none" returns text unchanged', () => {
		expect(fg("hello", "#ff0000", "none")).toBe("hello");
		expect(fg("hello", [0, 128, 255], "none")).toBe("hello");
		expect(fg("hello", "rebeccapurple", "none")).toBe("hello");
	});

	it('depth="none" still validates input and throws on invalid colors', () => {
		expect(() => fg("hello", "definitely-not-a-color", "none")).toThrow(TypeError);
	});

	it("empty text returns '' at every depth (after validation)", () => {
		expect(fg("", "#ff0000", "truecolor")).toBe("");
		expect(fg("", "#ff0000", "256")).toBe("");
		expect(fg("", "#ff0000", "16")).toBe("");
		expect(fg("", "#ff0000", "none")).toBe("");
	});

	it("empty text + invalid color still throws at every depth", () => {
		for (const depth of ["truecolor", "256", "16", "none"] as const) {
			expect(() => fg("", "definitely-not-a-color", depth)).toThrow();
		}
	});
});

describe("bg — depth fallback", () => {
	it('depth="truecolor" emits ansi-16m background', () => {
		const fgOpen = Bun.color("#00ff88", "ansi-16m") as string;
		const expectedOpen = fgOpen.replace("\x1b[38;", "\x1b[48;");
		expect(bg("hello", "#00ff88", "truecolor")).toBe(`${expectedOpen}hello\x1b[49m`);
	});

	it('depth="256" emits ansi-256 background (38; → 48; swap)', () => {
		const fgOpen = Bun.color("#00ff88", "ansi-256") as string;
		const expectedOpen = fgOpen.replace("\x1b[38;", "\x1b[48;");
		expect(bg("hello", "#00ff88", "256")).toBe(`${expectedOpen}hello\x1b[49m`);
		// Invariant: must end in bg close, must start with bg SGR introducer.
		expect(bg("hello", "#00ff88", "256").startsWith("\x1b[48;")).toBe(true);
	});

	it('depth="16" emits a real 16-color background SGR', () => {
		// Pure red bg → bright red bg (`101`).
		expect(bg("hello", "#ff0000", "16")).toBe("\x1b[101mhello\x1b[49m");
	});

	it('depth="16" bg open is always a background SGR (4X / 10X), never a fg SGR', () => {
		// Invariant: regardless of input color, the bg open must start with
		// a background SGR introducer. Catches the regression where a `38;`
		// → `48;` rewrite would no-op on compact `\x1b[3Xm` sequences.
		// oxlint-disable-next-line no-control-regex -- matching ANSI escape sequences
		const bgSgr = /^\x1b\[(?:4[0-7]|10[0-7])m/;
		for (const input of [
			"#000000",
			"#ff0000",
			"#00ff00",
			"#0000ff",
			"rebeccapurple",
			[128, 128, 128] as const,
		]) {
			const out = bg("x", input as never, "16");
			expect(bgSgr.test(out)).toBe(true);
			expect(out.endsWith("\x1b[49m")).toBe(true);
			expect(/[\t\n\r\v\f]/.test(out)).toBe(false);
		}
	});

	it('depth="none" returns text unchanged but validates input', () => {
		expect(bg("hello", "#ff0000", "none")).toBe("hello");
		expect(() => bg("hello", "definitely-not-a-color", "none")).toThrow(TypeError);
	});
});
