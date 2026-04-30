import { describe, expect, it } from "bun:test";
import * as codes from "./ansiCodes.ts";
import { bg, bgCode, fg, fgCode } from "./color.ts";
import { applyStyle, composeStyles } from "./styleEngine.ts";

// ────────────────────────────────────────────────────────────────────────────
// fgCode / bgCode — AnsiPair factories
// ────────────────────────────────────────────────────────────────────────────

describe("fgCode", () => {
	it("produces a foreground pair from 6-digit hex", () => {
		const pair = fgCode("#ff0000");
		expect(pair.open).toBe("\x1b[38;2;255;0;0m");
		expect(pair.close).toBe("\x1b[39m");
	});

	it("produces a foreground pair from 3-digit hex", () => {
		const pair = fgCode("#f00");
		expect(pair.open).toBe("\x1b[38;2;255;0;0m");
		expect(pair.close).toBe("\x1b[39m");
	});

	it("accepts named CSS colors", () => {
		const pair = fgCode("rebeccapurple");
		expect(pair.open).toBe("\x1b[38;2;102;51;153m");
		expect(pair.close).toBe("\x1b[39m");
	});

	it("accepts `rgb()` strings", () => {
		const pair = fgCode("rgb(0, 128, 255)");
		expect(pair.open).toBe("\x1b[38;2;0;128;255m");
	});

	it("accepts `hsl()` strings", () => {
		// hsl(0, 100%, 50%) === pure red
		const pair = fgCode("hsl(0, 100%, 50%)");
		expect(pair.open).toBe("\x1b[38;2;255;0;0m");
	});

	it("accepts numeric (0xRRGGBB) input", () => {
		const pair = fgCode(0xff0000);
		expect(pair.open).toBe("\x1b[38;2;255;0;0m");
	});

	it("accepts `{ r, g, b }` objects", () => {
		const pair = fgCode({ r: 255, g: 0, b: 0 });
		expect(pair.open).toBe("\x1b[38;2;255;0;0m");
	});

	it("accepts `[r, g, b]` arrays", () => {
		const pair = fgCode([0, 128, 255]);
		expect(pair.open).toBe("\x1b[38;2;0;128;255m");
	});

	it("close matches static foreground close (`\\x1b[39m`)", () => {
		expect(fgCode("#abcdef").close).toBe(codes.red.close);
	});

	it("throws TypeError for unrecognized strings", () => {
		expect(() => fgCode("not-a-color")).toThrow(TypeError);
	});

	it("throws TypeError with quoted input embedded in message", () => {
		expect(() => fgCode("bogus")).toThrow('Invalid color input: "bogus"');
	});

	it("throws TypeError for `null`", () => {
		// @ts-expect-error — runtime contract test for unsupported inputs
		expect(() => fgCode(null)).toThrow(TypeError);
	});
});

describe("bgCode", () => {
	it("produces a background pair from 6-digit hex", () => {
		const pair = bgCode("#ff0000");
		expect(pair.open).toBe("\x1b[48;2;255;0;0m");
		expect(pair.close).toBe("\x1b[49m");
	});

	it("produces a background pair from named CSS color", () => {
		const pair = bgCode("rebeccapurple");
		expect(pair.open).toBe("\x1b[48;2;102;51;153m");
		expect(pair.close).toBe("\x1b[49m");
	});

	it("produces a background pair from `[r, g, b]`", () => {
		const pair = bgCode([0, 255, 136]);
		expect(pair.open).toBe("\x1b[48;2;0;255;136m");
	});

	it("close matches static background close (`\\x1b[49m`)", () => {
		expect(bgCode("#123456").close).toBe(codes.bgRed.close);
	});

	it("throws TypeError for unrecognized strings", () => {
		expect(() => bgCode("nope")).toThrow(TypeError);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// fg / bg — direct styling functions
// ────────────────────────────────────────────────────────────────────────────

describe("fg", () => {
	it("applies truecolor foreground to text from hex", () => {
		expect(fg("hello", "#ff0000")).toBe("\x1b[38;2;255;0;0mhello\x1b[39m");
	});

	it("applies truecolor foreground from `rgb()`", () => {
		expect(fg("ocean", "rgb(0, 128, 255)")).toBe(
			"\x1b[38;2;0;128;255mocean\x1b[39m",
		);
	});

	it("applies truecolor foreground from numeric input", () => {
		expect(fg("red", 0xff0000)).toBe("\x1b[38;2;255;0;0mred\x1b[39m");
	});

	it("applies truecolor foreground from `[r, g, b]`", () => {
		expect(fg("ocean", [0, 128, 255])).toBe(
			"\x1b[38;2;0;128;255mocean\x1b[39m",
		);
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

	it("byte-identical foreground escape to legacy `(0, 128, 255)`", () => {
		// The pre-redesign API produced "\x1b[38;2;0;128;255mhello\x1b[39m" for
		// rgb("hello", 0, 128, 255). The new fg helper must match exactly.
		expect(fg("hello", [0, 128, 255])).toBe(
			"\x1b[38;2;0;128;255mhello\x1b[39m",
		);
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

	it("byte-identical background escape to legacy `bgRgb`", () => {
		expect(bg("hello", [0, 128, 255])).toBe(
			"\x1b[48;2;0;128;255mhello\x1b[49m",
		);
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
		const outer = applyStyle(`before ${inner} after`, fgCode([0, 128, 255]));

		// red close (39m) matches dynamic fg close (39m), so dynamic fg reopens
		expect(outer).toBe(
			"\x1b[38;2;0;128;255mbefore \x1b[31mstatic\x1b[39m\x1b[38;2;0;128;255m after\x1b[39m",
		);
	});

	it("dynamic bg nested in static bg — same close (49m) triggers reopen", () => {
		const inner = bg("inner", [255, 128, 0]);
		const outer = applyStyle(`A ${inner} B`, codes.bgBlue);

		// bg close (49m) matches bgBlue close (49m), so bgBlue reopens
		expect(outer).toBe(
			"\x1b[44mA \x1b[48;2;255;128;0minner\x1b[49m\x1b[44m B\x1b[49m",
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// composeStyles round-trip
// ────────────────────────────────────────────────────────────────────────────

describe("composeStyles round-trip", () => {
	it("dynamic fg + dynamic bg compose into a single styled run", () => {
		const fgBg = composeStyles(fgCode("#ff0000"), bgCode([0, 0, 255]));
		expect(applyStyle("styled", fgBg)).toBe(
			"\x1b[38;2;255;0;0m\x1b[48;2;0;0;255mstyled\x1b[49m\x1b[39m",
		);
	});

	it("dynamic fg composed with a static modifier", () => {
		const boldDynamic = composeStyles(codes.bold, fgCode([128, 64, 32]));
		expect(applyStyle("text", boldDynamic)).toBe(
			"\x1b[1m\x1b[38;2;128;64;32mtext\x1b[39m\x1b[22m",
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Edge cases
// ────────────────────────────────────────────────────────────────────────────

describe("edge cases", () => {
	it("hex shorthand is case-insensitive", () => {
		expect(fgCode("#FFF").open).toBe("\x1b[38;2;255;255;255m");
		expect(fgCode("#aBc").open).toBe("\x1b[38;2;170;187;204m");
	});

	it("8-digit hex (with alpha) is accepted; alpha is not encoded into ansi-16m", () => {
		// Bun.color drops alpha when emitting ansi-16m. The fg open should still
		// be a valid 24-bit foreground sequence.
		const pair = fgCode("#ff000080");
		expect(pair.open).toBe("\x1b[38;2;255;0;0m");
		expect(pair.close).toBe("\x1b[39m");
	});

	it("boundary RGB values (0 and 255) round-trip", () => {
		expect(fgCode([0, 0, 0]).open).toBe("\x1b[38;2;0;0;0m");
		expect(fgCode([255, 255, 255]).open).toBe("\x1b[38;2;255;255;255m");
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
		expect(() => fg("hello", "definitely-not-a-color", "none")).toThrow(
			TypeError,
		);
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
		expect(bg("hello", "#00ff88", "truecolor")).toBe(
			`${expectedOpen}hello\x1b[49m`,
		);
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
		// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences
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
		expect(() => bg("hello", "definitely-not-a-color", "none")).toThrow(
			TypeError,
		);
	});
});
