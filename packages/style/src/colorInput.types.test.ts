// ────────────────────────────────────────────────────────────────────────────
// ColorInput — Type-level tests
// ────────────────────────────────────────────────────────────────────────────
//
// These tests document and lock in the *type* shape of `ColorInput`. They
// pass at runtime trivially; the value comes from running `tsc --noEmit`
// over this file. Any change that widens or narrows `ColorInput` will
// fail this file at compile time.

import { describe, expect, it } from "bun:test";
import { bgCode, bg as colorBg, fg as colorFg, fgCode } from "./color.ts";
import { createStyle } from "./createStyle.ts";
import type { ColorInput, ColorString, NamedColor } from "./index.ts";
import { bg, fg } from "./runtimeExports.ts";

// ────────────────────────────────────────────────────────────────────────────
// Type-only assertions (compile-time)
// ────────────────────────────────────────────────────────────────────────────

/** Compile-time `expect(true)`. Errors here mean the types drifted. */
type Assert<T extends true> = T;

// `NamedColor` includes the canonical CSS spec entries.
type _NamedColorIncludesRebeccaPurple = Assert<
	"rebeccapurple" extends NamedColor ? true : false
>;
type _NamedColorIncludesRed = Assert<"red" extends NamedColor ? true : false>;
type _NamedColorExcludesTransparent = Assert<
	"transparent" extends NamedColor ? false : true
>;

// Every ColorString known literal accepts.
type _NamedAccepted = Assert<
	"rebeccapurple" extends ColorString ? true : false
>;
type _HexAccepted = Assert<"#ff0000" extends ColorString ? true : false>;
type _ShortHexAccepted = Assert<"#f00" extends ColorString ? true : false>;

// ColorString preserves the string fallback (LiteralUnion behavior).
type _StringFallback = Assert<
	"any-old-string" extends ColorString ? true : false
>;
type _RgbStringFallback = Assert<
	"rgb(0, 128, 255)" extends ColorString ? true : false
>;
type _HslStringFallback = Assert<
	"hsl(0, 100%, 50%)" extends ColorString ? true : false
>;

// ColorInput accepts every documented branch.
type _NumberBranch = Assert<0xff0000 extends ColorInput ? true : false>;
type _Tuple3Branch = Assert<[255, 0, 0] extends ColorInput ? true : false>;
type _Tuple4Branch = Assert<[255, 0, 0, 128] extends ColorInput ? true : false>;
type _ObjectBranch = Assert<
	{ r: 255; g: 0; b: 0 } extends ColorInput ? true : false
>;
type _ObjectAlphaBranch = Assert<
	{ r: 255; g: 0; b: 0; a: 128 } extends ColorInput ? true : false
>;

// ColorString is structurally a subset of ColorInput.
type _ColorStringIsColorInput = Assert<
	ColorString extends ColorInput ? true : false
>;

// Sanity: `boolean` is NOT assignable to ColorInput.
type _BooleanRejected = Assert<true extends ColorInput ? false : true>;

// ────────────────────────────────────────────────────────────────────────────
// Runtime sanity — every branch the types claim to accept actually works.
// ────────────────────────────────────────────────────────────────────────────

describe("ColorInput — every branch round-trips through fg()", () => {
	it("accepts a NamedColor literal", () => {
		const named: NamedColor = "rebeccapurple";
		expect(fg("x", named, "truecolor")).toBe("\x1b[38;2;102;51;153mx\x1b[39m");
	});

	it("accepts a `#rrggbb` literal", () => {
		expect(fg("x", "#ff0000", "truecolor")).toBe("\x1b[38;2;255;0;0mx\x1b[39m");
	});

	it("accepts an arbitrary string via the LiteralUnion fallback", () => {
		// `"rgb(...)"` is not in the literal-union part but type-checks
		// thanks to `string & {}` and parses at runtime via Bun.color().
		const dynamic: ColorString = "rgb(0, 128, 255)";
		expect(fg("x", dynamic, "truecolor")).toBe("\x1b[38;2;0;128;255mx\x1b[39m");
	});

	it("accepts a 3-tuple", () => {
		expect(fg("x", [255, 0, 0], "truecolor")).toBe(
			"\x1b[38;2;255;0;0mx\x1b[39m",
		);
	});

	it("accepts a `{ r, g, b }` object", () => {
		expect(fg("x", { r: 255, g: 0, b: 0 }, "truecolor")).toBe(
			"\x1b[38;2;255;0;0mx\x1b[39m",
		);
	});

	it("accepts a packed number", () => {
		expect(fg("x", 0xff0000, "truecolor")).toBe("\x1b[38;2;255;0;0mx\x1b[39m");
	});
});

describe("ColorInput — invalid shapes are rejected by the compiler", () => {
	it("forbids booleans, nullish, and arbitrary objects", () => {
		// Each call below has a `@ts-expect-error` directive: the `tsc` step
		// in `check:types` will fail if these become valid. Wrapping in
		// `expect(...).toThrow()` keeps the runtime side green since
		// `Bun.color()` rejects all of these at runtime as well.

		expect(() => {
			// @ts-expect-error — boolean is not a ColorInput
			colorFg("x", true, "truecolor");
		}).toThrow(TypeError);

		expect(() => {
			// @ts-expect-error — null is not a ColorInput
			colorFg("x", null, "truecolor");
		}).toThrow(TypeError);

		expect(() => {
			// @ts-expect-error — bare object without r/g/b is not a ColorInput
			colorFg("x", { hex: "#ff0000" }, "truecolor");
		}).toThrow(TypeError);

		expect(() => {
			// @ts-expect-error — 2-tuple is not a valid channel set
			colorFg("x", [255, 0], "truecolor");
		}).toThrow(); // Bun throws a plain Error here, not a TypeError
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Strict inline-literal checking — typos in inline string literals at
// `fg` / `bg` / `fgCode` / `bgCode` / `style.fg` / `style.bg` /
// `chain.fg` / `chain.bg` call sites must fail at compile time. Dynamic
// `string` / `ColorString` / `ColorInput` values must keep type-checking.
// ────────────────────────────────────────────────────────────────────────────

describe("ColorInput — inline string literals are checked at the call site", () => {
	it("rejects invalid inline literals across every public call site", () => {
		const s = createStyle({ mode: "never" });

		expect(() => {
			// @ts-expect-error — typo on a NamedColor
			fg("x", "rebbecapurple");
		}).toThrow(TypeError);

		expect(() => {
			// @ts-expect-error — arbitrary inline literal
			bg("x", "not-a-color");
		}).toThrow(TypeError);

		expect(() => {
			// @ts-expect-error — missing `#` prefix on hex-like literal
			fg("x", "ff0000");
		}).toThrow(TypeError);

		expect(() => {
			// @ts-expect-error — typo on direct color.fg
			colorFg("x", "rebbecapurple", "truecolor");
		}).toThrow(TypeError);

		expect(() => {
			// @ts-expect-error — typo on direct color.bg
			colorBg("x", "rebbecapurple", "truecolor");
		}).toThrow(TypeError);

		expect(() => {
			// @ts-expect-error — typo on fgCode pair factory
			fgCode("rebbecapurple");
		}).toThrow(TypeError);

		expect(() => {
			// @ts-expect-error — typo on bgCode pair factory
			bgCode("not-a-color");
		}).toThrow(TypeError);

		expect(() => {
			// @ts-expect-error — typo on instance.fg direct form
			s.fg("x", "rebbecapurple");
		}).toThrow(TypeError);

		expect(() => {
			// @ts-expect-error — typo on instance.fg chain-root form
			s.fg("rebbecapurple");
		}).toThrow(TypeError);

		expect(() => {
			// @ts-expect-error — typo on instance.bg direct form
			s.bg("x", "rebbecapurple");
		}).toThrow(TypeError);

		expect(() => {
			// @ts-expect-error — typo on instance.bg chain-root form
			s.bg("rebbecapurple");
		}).toThrow(TypeError);

		expect(() => {
			// @ts-expect-error — typo on chainable .fg
			s.bold.fg("rebbecapurple");
		}).toThrow(TypeError);

		expect(() => {
			// @ts-expect-error — typo on chainable .bg
			s.bold.bg("rebbecapurple");
		}).toThrow(TypeError);
	});

	it("accepts dynamic strings that flow through unchanged", () => {
		const dynamicStr: string = "rgb(0, 128, 255)";
		const dynamicColorStr: ColorString = "hsl(45, 100%, 50%)";
		const dynamicAny: ColorInput = "#ff0000";
		expect(fg("x", dynamicStr)).not.toBe("");
		expect(bg("x", dynamicColorStr)).not.toBe("");
		expect(fg("x", dynamicAny)).not.toBe("");
	});

	it("accepts every valid inline-literal shape", () => {
		expect(fg("x", "rebeccapurple")).not.toBe("");
		expect(fg("x", "#ff0000")).not.toBe("");
		expect(fg("x", "#f00")).not.toBe("");
		expect(fg("x", "rgb(0, 128, 255)")).not.toBe("");
		expect(fg("x", "hsl(45, 100%, 50%)")).not.toBe("");
		expect(fg("x", "oklch(60% 0.2 240)")).not.toBe("");
		expect(fg("x", "lab(50% 30 -20)")).not.toBe("");
		expect(fg("x", [255, 127, 80])).not.toBe("");
		expect(fg("x", [255, 127, 80, 128])).not.toBe("");
		expect(fg("x", { r: 1, g: 2, b: 3 })).not.toBe("");
		expect(fg("x", { r: 1, g: 2, b: 3, a: 4 })).not.toBe("");
		expect(fg("x", 0xff0000)).not.toBe("");
	});
});
