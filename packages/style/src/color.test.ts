import { describe, expect, it } from "vite-plus/test";

import { paint } from "./color.ts";

// ────────────────────────────────────────────────────────────────────────────
// fg / bg — direct styling functions
// ────────────────────────────────────────────────────────────────────────────

describe("fg", () => {
	it("accepts named CSS colors", () => {
		expect(paint("fg", "hi", "rebeccapurple", "truecolor")).toBe("\x1b[38;2;102;51;153mhi\x1b[39m");
	});

	it("rejects unsupported CSS functional notation", () => {
		for (const input of ["hsl(0, 100%, 50%)", "lab(50% 30 -20)", "color-mix(in srgb, red, blue)"]) {
			expect(() => paint("fg", "x", input, "truecolor")).toThrow(TypeError);
		}
	});

	it("accepts `rgb()` strings", () => {
		expect(paint("fg", "x", "rgb(0, 128, 255)", "truecolor")).toBe("\x1b[38;2;0;128;255mx\x1b[39m");
		expect(paint("fg", "x", "rgb(0 128 255)", "truecolor")).toBe("\x1b[38;2;0;128;255mx\x1b[39m");
	});

	it("rejects mixed rgb() separators", () => {
		for (const input of ["rgb(1, 2 3)", "rgb(1 2, 3)"]) {
			expect(() => paint("fg", "x", input, "truecolor")).toThrow(TypeError);
		}
	});

	it("rejects legacy packed, object, alpha, and 8-digit inputs", () => {
		for (const input of [0xff0000, { r: 255, g: 0, b: 0 }, [255, 0, 0, 128], "#ff000080"]) {
			// @ts-expect-error — legacy inputs are intentionally unsupported.
			expect(() => paint("fg", "x", input, "truecolor")).toThrow(TypeError);
		}
	});

	it("throws TypeError with quoted input embedded in message", () => {
		expect(() => paint("fg", "x", "bogus", "truecolor")).toThrow('Invalid color input: "bogus"');
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Edge cases
// ────────────────────────────────────────────────────────────────────────────

describe("edge cases", () => {
	it("hex shorthand is case-insensitive", () => {
		expect(paint("fg", "x", "#FFF", "truecolor")).toBe("\x1b[38;2;255;255;255mx\x1b[39m");
		expect(paint("fg", "x", "#aBc", "truecolor")).toBe("\x1b[38;2;170;187;204mx\x1b[39m");
	});

	it("boundary RGB values (0 and 255) round-trip", () => {
		expect(paint("fg", "x", [0, 0, 0], "truecolor")).toBe("\x1b[38;2;0;0;0mx\x1b[39m");
		expect(paint("fg", "x", [255, 255, 255], "truecolor")).toBe("\x1b[38;2;255;255;255mx\x1b[39m");
	});

	it("rejects out-of-range rgb() channels", () => {
		expect(() => paint("fg", "x", "rgb(300, 0, 0)", "truecolor")).toThrow(TypeError);
		expect(() => paint("fg", "x", "rgb(0 0 256)", "truecolor")).toThrow(TypeError);
	});

	it("rejects 4-digit hex", () => {
		expect(() => paint("fg", "x", "#f00a", "truecolor")).toThrow(TypeError);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Depth-aware fg / bg fallback
// ────────────────────────────────────────────────────────────────────────────
//
// `paint` takes an explicit `depth` that selects the matching terminal
// color format.

describe("fg — depth fallback", () => {
	it('depth="256" emits ansi-256 sequence', () => {
		expect(paint("fg", "hello", "#ff0000", "256")).toBe("\x1b[38;5;196mhello\x1b[39m");
	});

	it('depth="256" grayscale stays in range and near-grays use the ramp', () => {
		// Light grays must not round past the palette (index ≤ 255).
		expect(paint("fg", "x", [244, 244, 244], "256")).toBe("\x1b[38;5;255mx\x1b[39m");
		// Near-gray picks the closer grayscale entry over a distant cube entry.
		expect(paint("fg", "x", [120, 121, 122], "256")).toBe("\x1b[38;5;243mx\x1b[39m");
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
			expect(paint("fg", "x", input, "16")).toBe(`\x1b[${param}mx\x1b[39m`);
		}
	});

	it('depth="none" returns text unchanged', () => {
		expect(paint("fg", "hello", "#ff0000", "none")).toBe("hello");
		expect(paint("fg", "hello", [0, 128, 255], "none")).toBe("hello");
		expect(paint("fg", "hello", "rebeccapurple", "none")).toBe("hello");
	});

	it("empty text returns '' at every depth (after validation)", () => {
		expect(paint("fg", "", "#ff0000", "truecolor")).toBe("");
		expect(paint("fg", "", "#ff0000", "256")).toBe("");
		expect(paint("fg", "", "#ff0000", "16")).toBe("");
		expect(paint("fg", "", "#ff0000", "none")).toBe("");
	});

	it("empty text + invalid color still throws at every depth", () => {
		for (const depth of ["truecolor", "256", "16", "none"] as const) {
			expect(() => paint("fg", "", "definitely-not-a-color", depth)).toThrow();
		}
	});
});

describe("bg — depth fallback", () => {
	it('depth="truecolor" emits ansi-16m background', () => {
		expect(paint("bg", "hello", "#00ff88", "truecolor")).toBe("\x1b[48;2;0;255;136mhello\x1b[49m");
	});

	it('depth="256" emits ansi-256 background (38; → 48; swap)', () => {
		expect(paint("bg", "hello", "#00ff88", "256")).toBe("\x1b[48;5;48mhello\x1b[49m");
	});

	it('depth="16" emits a real 16-color background SGR', () => {
		// Pure red bg → bright red bg (`101`).
		expect(paint("bg", "hello", "#ff0000", "16")).toBe("\x1b[101mhello\x1b[49m");
	});

	it('depth="none" returns text unchanged but validates input', () => {
		expect(paint("bg", "hello", "#ff0000", "none")).toBe("hello");
		expect(() => paint("bg", "hello", "definitely-not-a-color", "none")).toThrow(TypeError);
	});
});
