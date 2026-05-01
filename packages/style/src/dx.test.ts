// ────────────────────────────────────────────────────────────────────────────
// DX-locking tests — chain richness, defensive inputs, error messages
// ────────────────────────────────────────────────────────────────────────────
//
// These tests guard the developer-experience guarantees of the package:
//   1. Chainables ARE AnsiPairs (open/close attached, composeStyles works)
//   2. Tagged templates are interleaved correctly (no comma-join bug)
//   3. fg/bg work as chain extensions and as chain roots
//   4. Nullish/non-string inputs never crash and never emit "undefined"
//   5. Error messages are stable (snapshotted) — refactors must update
//      both the message and these snapshots in the same change.

import { afterEach, describe, expect, it } from "bun:test";
import {
	applyStyle,
	bg,
	bold,
	composeStyles,
	createStyle,
	fg,
	fgCode,
	getGlobalColorMode,
	linkCode,
	red,
	setGlobalColorMode,
	style,
} from "./index.ts";

const always = createStyle({ mode: "always" });

// ────────────────────────────────────────────────────────────────────────────
// 1. Chainable IS AnsiPair
// ────────────────────────────────────────────────────────────────────────────

describe("ChainableStyleFn extends AnsiPair", () => {
	it("attaches open/close to a leaf chainable", () => {
		expect(always.bold.open).toBe("\x1b[1m");
		expect(always.bold.close).toBe("\x1b[22m");
		expect(always.red.open).toBe("\x1b[31m");
		expect(always.red.close).toBe("\x1b[39m");
	});

	it("composes open/close across a chain (bold.red.bgYellow)", () => {
		const chain = always.bold.red.bgYellow;
		expect(chain.open).toBe("\x1b[1m\x1b[31m\x1b[43m");
		expect(chain.close).toBe("\x1b[49m\x1b[39m\x1b[22m");
	});

	it("chain.open + text + chain.close === chain(text)", () => {
		const direct = always.bold.red("X");
		const indirect = `${always.bold.red.open}X${always.bold.red.close}`;
		expect(direct).toBe(indirect);
	});

	it("composeStyles accepts chainables as AnsiPair", () => {
		const composed = composeStyles(always.bold, always.red, always.bgYellow);
		expect(applyStyle("hi", composed)).toBe(
			"\x1b[1m\x1b[31m\x1b[43mhi\x1b[49m\x1b[39m\x1b[22m",
		);
	});

	it("top-level imports (bold, red) carry open/close", () => {
		expect(bold.open).toBe("\x1b[1m");
		expect(bold.close).toBe("\x1b[22m");
		expect(red.open).toBe("\x1b[31m");
		// composeStyles works with top-level imports + AnsiPair factories
		const composed = composeStyles(bold, red, fgCode("#0080ff"));
		expect(typeof composed.open).toBe("string");
		expect(typeof composed.close).toBe("string");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Tagged template literals
// ────────────────────────────────────────────────────────────────────────────

describe("ChainableStyleFn — tagged template literals", () => {
	it("interleaves strings and values correctly", () => {
		const ms = 42;
		expect(always.red`build in ${ms}ms`).toBe("\x1b[31mbuild in 42ms\x1b[39m");
	});

	it("supports nested templates with re-opening", () => {
		const out = always.bold`Build ${always.cyan`./dist`} in 42ms`;
		// bold opens; cyan opens & closes inside; bold's open re-applied
		// after cyan's close (style engine re-opens after a matching close).
		expect(out).toBe("\x1b[1mBuild \x1b[36m./dist\x1b[39m in 42ms\x1b[22m");
	});

	it("coerces nullish/number/object interpolations to strings", () => {
		expect(always.red`${null}-${undefined}-${0}-${{ a: 1 }}`).toBe(
			"\x1b[31mnull-undefined-0-[object Object]\x1b[39m",
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// 3. fg/bg in chain (extension and root)
// ────────────────────────────────────────────────────────────────────────────

describe("fg/bg as chain methods", () => {
	it("appends a foreground color to an existing chain", () => {
		expect(always.bold.fg("#ff8800")("warning")).toBe(
			"\x1b[1m\x1b[38;2;255;136;0mwarning\x1b[39m\x1b[22m",
		);
	});

	it("appends a background color to an existing chain", () => {
		expect(always.bold.bg("#330000")("err")).toBe(
			"\x1b[1m\x1b[48;2;51;0;0merr\x1b[49m\x1b[22m",
		);
	});

	it("can chain after a dynamic color (fg(...).italic.underline)", () => {
		expect(always.fg("rebeccapurple").italic.underline("triple")).toBe(
			"\x1b[38;2;102;51;153m\x1b[3m\x1b[4mtriple\x1b[24m\x1b[23m\x1b[39m",
		);
	});

	it("style.fg(input) acts as a chain root (1-arg form)", () => {
		expect(always.fg("#00aaff")("dynamic")).toBe(
			"\x1b[38;2;0;170;255mdynamic\x1b[39m",
		);
	});

	it("style.fg(text, input) still works as direct call (2-arg form)", () => {
		expect(always.fg("text", "#00aaff")).toBe(
			"\x1b[38;2;0;170;255mtext\x1b[39m",
		);
	});

	it("composes via composeStyles with chain-root dynamic colors", () => {
		const composed = composeStyles(always.bold, always.fg("#00aaff"));
		expect(applyStyle("hi", composed)).toBe(
			"\x1b[1m\x1b[38;2;0;170;255mhi\x1b[39m\x1b[22m",
		);
	});

	it("invalid input still throws via the chain root", () => {
		expect(() => always.fg("definitely-not-a-color")).toThrow(TypeError);
		expect(() => always.bold.fg("nope")).toThrow(TypeError);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Defensive nullish handling
// ────────────────────────────────────────────────────────────────────────────

describe("Defensive nullish handling", () => {
	it("red(undefined) returns '' (no styled \"undefined\")", () => {
		expect(red(undefined as unknown as string)).toBe("");
		expect(always.red(undefined as unknown as string)).toBe("");
	});

	it("red(null) returns '' (no styled \"null\")", () => {
		expect(red(null as unknown as string)).toBe("");
		expect(always.red(null as unknown as string)).toBe("");
	});

	it("red('') returns '' (no escape codes for empty content)", () => {
		expect(always.red("")).toBe("");
		expect(red("")).toBe("");
	});

	it("chain(undefined) does not crash and returns ''", () => {
		expect(always.bold.red(undefined as unknown as string)).toBe("");
		expect(always.bold.red.bgYellow(null as unknown as string)).toBe("");
	});

	it("applyStyle is null-safe (matches chain behavior)", () => {
		expect(applyStyle(undefined as unknown as string, always.bold)).toBe("");
		expect(applyStyle(null as unknown as string, always.red)).toBe("");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// 5. Error message snapshots
// ────────────────────────────────────────────────────────────────────────────

describe("Error messages — locked via snapshots", () => {
	it("fg invalid input echoes the bad value", () => {
		expect(() => fg("hello", "definitely-not-a-color")).toThrow(
			'Invalid color input: "definitely-not-a-color"',
		);
	});

	it("fg with empty text + invalid input still throws (no silent mask)", () => {
		expect(() => fg("", "garbage")).toThrow('Invalid color input: "garbage"');
	});

	it("bg invalid input echoes the bad value", () => {
		expect(() => bg("hi", "nope")).toThrow('Invalid color input: "nope"');
	});

	it("fgCode invalid input echoes the bad value", () => {
		expect(() => fgCode("bogus")).toThrow('Invalid color input: "bogus"');
	});

	it("linkCode rejects URLs with spaces and echoes the URL", () => {
		// Use `linkCode` directly: top-level `link` goes through the runtime
		// facade which suppresses (and therefore skips validation) when
		// hyperlinks are disabled (e.g. non-TTY tests). `linkCode` always
		// validates because it's how callers get an AnsiPair regardless of
		// emission mode.
		expect(() => linkCode("https://example.com/with space")).toThrow(
			'Invalid hyperlink URL: "https://example.com/with space" must contain only printable ASCII characters without spaces.',
		);
	});

	it("linkCode rejects non-printable IDs and echoes the value", () => {
		expect(() => linkCode("https://example.com", { id: "bad\x00id" })).toThrow(
			'Invalid hyperlink id: "bad\\u0000id" must contain only printable ASCII characters.',
		);
	});

	it("linkCode rejects ID with reserved char (no echo, message names char)", () => {
		// The reserved-char message is intentionally short — the constraint
		// (`":"` and `";"` are reserved by OSC 8) is the actionable part.
		expect(() =>
			linkCode("https://example.com", { id: "has;reserved" }),
		).toThrow('":" and ";" are reserved by the OSC 8 format.');
	});
});

// ────────────────────────────────────────────────────────────────────────────
// 6. Sanity — `style` (auto facade) still works in this test environment
// ────────────────────────────────────────────────────────────────────────────

describe("global style facade", () => {
	it("exposes the chain at top level", () => {
		// style is in auto mode; output may or may not include ANSI
		// depending on whether the test runner is a TTY. We just assert
		// that the chainable shape exists.
		expect(typeof style.bold).toBe("function");
		expect(typeof style.bold.red).toBe("function");
		expect(typeof style.bold.fg).toBe("function");
		expect(typeof style.bold.open).toBe("string");
		expect(typeof style.bold.close).toBe("string");
	});
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Top-level chainables — full surface
// ───────────────────────────────────────────────────────────────────────────
//
// Locks in B1 from the adversarial review: top-level imports must
// expose the same surface as `style.bold` etc. (tagged templates,
// chain methods, fg/bg, AnsiPair shape).

describe("top-level chainables — full surface", () => {
	afterEach(() => {
		setGlobalColorMode(undefined);
	});

	it("top-level `bold` exposes `.fg`, `.bg`, `.open`, `.close`", () => {
		expect(typeof bold.fg).toBe("function");
		expect(typeof bold.bg).toBe("function");
		expect(typeof bold.open).toBe("string");
		expect(typeof bold.close).toBe("string");
	});

	it("top-level tagged-template interleaves interpolations", () => {
		setGlobalColorMode("always");
		expect(bold`hello ${42}!`).toBe("\x1b[1mhello 42!\x1b[22m");
	});

	it("top-level `bold.fg('#f00')('x')` chain root works", () => {
		setGlobalColorMode("always");
		expect(bold.fg("#ff0000")("x")).toBe(
			"\x1b[1m\x1b[38;2;255;0;0mx\x1b[39m\x1b[22m",
		);
	});

	it("top-level chain `bold.red.bgYellow('hi')` composes", () => {
		setGlobalColorMode("always");
		expect(bold.red.bgYellow("hi")).toBe(
			"\x1b[1m\x1b[31m\x1b[43mhi\x1b[49m\x1b[39m\x1b[22m",
		);
	});
});

// ───────────────────────────────────────────────────────────────────────────
// 8. setGlobalColorMode — capture semantics
// ───────────────────────────────────────────────────────────────────────────
//
// Locks in H1 from the adversarial review: forwarders re-resolve;
// sub-chain captures snapshot (documented limitation).

describe("setGlobalColorMode — capture semantics", () => {
	afterEach(() => {
		setGlobalColorMode(undefined);
	});

	it("top-level `bold` re-resolves on every call after mode flip", () => {
		setGlobalColorMode("always");
		const captured = bold;
		setGlobalColorMode("never");
		// `"never"` disables all ANSI (matches createStyle({ mode: "never" }))
		expect(captured("x")).toBe("x");
	});

	it("`style.bold` (forwarder) re-resolves after mode flip", () => {
		setGlobalColorMode("always");
		const captured = style.bold;
		setGlobalColorMode("never");
		// `"never"` suppresses all ANSI — the forwarder resolves the current
		// runtime style which has modifiers + colors both off.
		expect(captured.red("x")).toBe("x");
	});

	it("sub-chain capture (`style.bold.red`) snapshots at access time", () => {
		// This is documented behavior: capturing a deeper chain locks the
		// resolved chainable to the runtime instance active at capture time.
		// Matches chalk/ansis. To stay dynamic, capture the leaf only.
		setGlobalColorMode("always");
		const snapshot = style.bold.red;
		setGlobalColorMode("never");
		// snapshot is locked to the always-instance: full color emitted.
		expect(snapshot("x")).toBe("\x1b[1m\x1b[31mx\x1b[39m\x1b[22m");
	});

	it("getGlobalColorMode reflects the current override", () => {
		expect(getGlobalColorMode()).toBeUndefined();
		setGlobalColorMode("always");
		expect(getGlobalColorMode()).toBe("always");
		setGlobalColorMode(undefined);
		expect(getGlobalColorMode()).toBeUndefined();
	});
});

// ───────────────────────────────────────────────────────────────────────────
// 9. Hyperlink validation through `style.link` (B3)
// ───────────────────────────────────────────────────────────────────────────
//
// `style.link` previously returned `text` unchanged when hyperlinks
// were disabled (non-TTY auto), bypassing URL validation. After B3 the
// validation runs even when emission is suppressed.

describe("style.link validates URLs even when hyperlinks are suppressed", () => {
	it("throws on bad URL with hyperlinks disabled (mode='never')", () => {
		const s = createStyle({ mode: "never" });
		expect(() => s.link("docs", "https://example.com/with space")).toThrow(
			/Invalid hyperlink URL/,
		);
	});

	it("throws on bad URL with hyperlinks enabled (mode='always')", () => {
		const s = createStyle({ mode: "always" });
		expect(() => s.link("docs", "https://example.com/with space")).toThrow(
			/Invalid hyperlink URL/,
		);
	});

	it("returns text only (no escapes) when valid URL but disabled", () => {
		const s = createStyle({ mode: "never" });
		expect(s.link("docs", "https://crustjs.dev")).toBe("docs");
	});
});
