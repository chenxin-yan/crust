import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createStyle, style } from "./createStyle.ts";
import { bold, red } from "./index.ts";

const originalStdoutIsTTY = process.stdout.isTTY;

beforeEach(() => {
	// Ambient NO_COLOR/FORCE_COLOR (e.g. CI runners) must not leak into the
	// auto ladder. afterEach still restores the ambient values.
	vi.stubEnv("NO_COLOR", undefined);
	vi.stubEnv("FORCE_COLOR", undefined);
	vi.stubEnv("COLORTERM", undefined);
	vi.stubEnv("TERM", undefined);
});
afterEach(() => {
	vi.unstubAllEnvs();
	Object.defineProperty(process.stdout, "isTTY", {
		configurable: true,
		value: originalStdoutIsTTY,
	});
});

const always = createStyle({ mode: "always" });

describe("createStyle — apply() under NO_COLOR", () => {
	// NO_COLOR on a TTY: colorsEnabled=false, modifiersEnabled=true.
	const s = createStyle({
		mode: "auto",
		overrides: { isTTY: true, noColor: "1", forceColor: undefined },
	});

	it("preserves modifier steps when colors are disabled", () => {
		// Regression: modifier chains must survive NO_COLOR (which only
		// disables colors).
		expect(s.italic("text")).toBe("\x1b[3mtext\x1b[23m");
		expect(s.underline("text")).toBe("\x1b[4mtext\x1b[24m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Depth-aware fg / bg on style instances
// ────────────────────────────────────────────────────────────────────────────

/** Build an `auto`-mode style with all capability inputs explicitly set. */
function autoStyle(overrides: {
	term?: string | undefined;
	colorTerm?: string | undefined;
	isTTY?: boolean;
}) {
	return createStyle({
		mode: "auto",
		overrides: {
			isTTY: overrides.isTTY ?? true,
			noColor: undefined,
			forceColor: undefined,
			colorTerm: overrides.colorTerm,
			term: overrides.term,
		},
	});
}

describe("createStyle — colorDepth introspection", () => {
	it('reflects "truecolor" in always mode', () => {
		const s = createStyle({ mode: "always" });
		expect(s.colorDepth).toBe("truecolor");
		expect(s.trueColorEnabled).toBe(true);
		expect(s.colorsEnabled).toBe(true);
	});

	it('reflects "none" in never mode', () => {
		const s = createStyle({ mode: "never" });
		expect(s.colorDepth).toBe("none");
		expect(s.trueColorEnabled).toBe(false);
		expect(s.colorsEnabled).toBe(false);
	});
});

describe("createStyle — fg/bg emit format matching colorDepth", () => {
	it("exposes dynamic chain pairs at the configured depth", () => {
		const chain = autoStyle({ term: "xterm-256color" }).fg("#ff0000");
		expect(chain.open).toBe("\x1b[38;5;196m");
		expect(`${chain.open}text${chain.close}`).toBe(chain("text"));
		expect(createStyle({ mode: "never" }).fg("#ff0000").open).toBe("");
	});

	it('bg emits ansi-256 background when capability is "256"', () => {
		const s = autoStyle({ term: "xterm-256color" });
		expect(s.bg("text", "#00ff88")).toBe("\x1b[48;5;48mtext\x1b[49m");
	});

	it('bg emits a real 16-color background SGR when capability is "16"', () => {
		// `#00ff88` quantizes to bright cyan (`96` fg → `106` bg) under the
		// standard half-channel bucketing (b=0x88=136 rounds to 1).
		const out = autoStyle({}).bg("text", "#00ff88");
		expect(out).toBe("\x1b[106mtext\x1b[49m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// createStyle — always mode
// ────────────────────────────────────────────────────────────────────────────

describe("createStyle — always mode", () => {
	const s = createStyle({ mode: "always" });

	it("reports enabled as true", () => {
		expect(s.enabled).toBe(true);
	});

	it("bold emits ANSI codes", () => {
		expect(s.bold("text")).toBe("\x1b[1mtext\x1b[22m");
	});

	it("red emits ANSI codes", () => {
		expect(s.red("text")).toBe("\x1b[31mtext\x1b[39m");
	});

	it("bgBlue emits ANSI codes", () => {
		expect(s.bgBlue("text")).toBe("\x1b[44mtext\x1b[49m");
	});

	it("supports chainable styles", () => {
		expect(s.bold.red("text")).toBe("\x1b[1m\x1b[31mtext\x1b[39m\x1b[22m");
	});

	it("last color in chain takes precedence", () => {
		expect(s.red.blue("text")).toBe("\x1b[31m\x1b[34mtext\x1b[39m\x1b[31m\x1b[39m");
	});

	it("handles empty string", () => {
		expect(s.bold("")).toBe("");
		expect(s.red("")).toBe("");
	});

	it("preserves nesting behavior", () => {
		const inner = s.blue("sky");
		const outer = s.red(`roses ${inner} are red`);
		expect(outer).toBe("\x1b[31mroses \x1b[34msky\x1b[39m\x1b[31m are red\x1b[39m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// createStyle — never mode
// ────────────────────────────────────────────────────────────────────────────

describe("createStyle — never mode", () => {
	const s = createStyle({ mode: "never" });

	it("reports enabled as false", () => {
		expect(s.enabled).toBe(false);
	});

	it("supports chainable styles without ANSI output", () => {
		expect(s.bold.red("text")).toBe("text");
		expect(s.bgBlue.underline("text")).toBe("text");
	});

	it("preserves text content structurally", () => {
		const inner = s.blue("sky");
		const outer = s.red(`roses ${inner} are red`);
		expect(outer).toBe("roses sky are red");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// createStyle — auto mode with overrides
// ────────────────────────────────────────────────────────────────────────────

describe("createStyle — auto mode with overrides", () => {
	it("enables color when TTY and NO_COLOR not set", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: true, noColor: undefined },
		});
		expect(s.enabled).toBe(true);
		expect(s.bold("text")).toBe("\x1b[1mtext\x1b[22m");
	});

	it("disables all styling when not a TTY", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: false, noColor: undefined },
		});
		expect(s.enabled).toBe(false);
		expect(s.colorsEnabled).toBe(false);
		expect(s.bold("text")).toBe("text");
		expect(s.red("text")).toBe("text");
	});

	it("disables color when NO_COLOR is set", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: true, noColor: "1" },
		});
		expect(s.enabled).toBe(true);
		expect(s.colorsEnabled).toBe(false);
		expect(s.bold("text")).toBe("\x1b[1mtext\x1b[22m");
		expect(s.red("text")).toBe("text");
	});

	it("does not disable color when NO_COLOR is empty string", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: true, noColor: "" },
		});
		expect(s.enabled).toBe(true);
		expect(s.colorsEnabled).toBe(true);
		expect(s.red("text")).toBe("\x1b[31mtext\x1b[39m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// createStyle — instance immutability
// ────────────────────────────────────────────────────────────────────────────

describe("createStyle — instance immutability", () => {
	it("returns a frozen object", () => {
		const s = createStyle({ mode: "always" });
		expect(Object.isFrozen(s)).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// createStyle — structural equivalence in never mode
// ────────────────────────────────────────────────────────────────────────────

describe("createStyle — structural equivalence", () => {
	it("never mode produces structurally identical text to always mode", () => {
		const always = createStyle({ mode: "always" });
		const never = createStyle({ mode: "never" });

		// The plain text content should be preserved
		const alwaysResult = always.bold(`hello ${always.red("world")} end`);
		const neverResult = never.bold(`hello ${never.red("world")} end`);

		// Strip ANSI from always result to compare structural equivalence
		// oxlint-disable-next-line no-control-regex -- stripping ANSI escape sequences
		const stripped = alwaysResult.replace(/\x1b\[\d+m/g, "");
		expect(stripped).toBe(neverResult);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// createStyle — dynamic color (truecolor) mode gating
// ────────────────────────────────────────────────────────────────────────────

describe("createStyle — dynamic colors always mode", () => {
	const s = createStyle({ mode: "always" });

	it("fg emits truecolor ANSI codes from `[r, g, b]`", () => {
		expect(s.fg("text", [255, 0, 0])).toBe("\x1b[38;2;255;0;0mtext\x1b[39m");
	});

	it("bg emits truecolor ANSI codes from `[r, g, b]`", () => {
		expect(s.bg("text", [0, 128, 255])).toBe("\x1b[48;2;0;128;255mtext\x1b[49m");
	});
});

describe("createStyle — dynamic colors never mode", () => {
	const s = createStyle({ mode: "never" });

	it("fg returns plain text from `[r, g, b]`", () => {
		expect(s.fg("text", [255, 0, 0])).toBe("text");
	});

	it("bg returns plain text from `[r, g, b]`", () => {
		expect(s.bg("text", [0, 128, 255])).toBe("text");
	});
});

describe("createStyle — dynamic colors auto mode with truecolor overrides", () => {
	it("emits truecolor when TTY + COLORTERM=truecolor", () => {
		const s = createStyle({
			mode: "auto",
			overrides: { isTTY: true, noColor: undefined, colorTerm: "truecolor" },
		});
		expect(s.trueColorEnabled).toBe(true);
		expect(s.fg("text", [255, 0, 0])).toBe("\x1b[38;2;255;0;0mtext\x1b[39m");
	});

	it("falls back to 256-color when TTY + TERM=xterm-256color (no truecolor env)", () => {
		const s = createStyle({
			mode: "auto",
			overrides: {
				isTTY: true,
				noColor: undefined,
				colorTerm: undefined,
				term: "xterm-256color",
			},
		});
		expect(s.enabled).toBe(true);
		expect(s.trueColorEnabled).toBe(false);
		expect(s.colorDepth).toBe("256");
		// fg now downgrades to ansi-256 instead of returning plain text.
		expect(s.fg("text", [255, 0, 0])).toBe("\x1b[38;5;196mtext\x1b[39m");
	});

	it("falls back to 16-color when TTY but no truecolor / 256 env", () => {
		const s = createStyle({
			mode: "auto",
			overrides: {
				isTTY: true,
				noColor: undefined,
				colorTerm: undefined,
				term: undefined,
			},
		});
		expect(s.enabled).toBe(true);
		expect(s.trueColorEnabled).toBe(false);
		expect(s.colorDepth).toBe("16");
		// Static 16-color helpers continue to work.
		expect(s.red("text")).toBe("\x1b[31mtext\x1b[39m");
		// Dynamic colors quantize in-package to a clean compact 16-color SGR.
		// Pure red → bright red (`91`).
		expect(s.fg("text", [255, 0, 0])).toBe("\x1b[91mtext\x1b[39m");
	});

	it("disables everything when not a TTY", () => {
		const s = createStyle({
			mode: "auto",
			overrides: {
				isTTY: false,
				noColor: undefined,
				colorTerm: "truecolor",
			},
		});
		expect(s.enabled).toBe(false);
		expect(s.colorsEnabled).toBe(false);
		expect(s.trueColorEnabled).toBe(false);
		expect(s.red("text")).toBe("text");
		expect(s.bold("text")).toBe("text");
		expect(s.fg("text", [255, 0, 0])).toBe("text");
	});
});

describe("runtime-aware default exports", () => {
	it("keeps modifiers enabled when NO_COLOR is set", () => {
		vi.stubEnv("NO_COLOR", "1");
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});

		expect(bold("text")).toBe("\x1b[1mtext\x1b[22m");
		expect(red("text")).toBe("text");
		expect(style.bold.red("text")).toBe("\x1b[1mtext\x1b[22m");
		expect(style.enabled).toBe(true);
		expect(style.colorsEnabled).toBe(false);
	});

	it("FORCE_COLOR forces colors on — overrides NO_COLOR and non-TTY", () => {
		vi.stubEnv("NO_COLOR", "1");
		vi.stubEnv("FORCE_COLOR", "3");
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: false,
		});

		expect(red("text")).toBe("\x1b[31mtext\x1b[39m");
		expect(style.colorsEnabled).toBe(true);
	});

	it("FORCE_COLOR=0 forces all ANSI off — overrides TTY", () => {
		vi.stubEnv("FORCE_COLOR", "0");
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});

		expect(red("text")).toBe("text");
		expect(bold("text")).toBe("text");
		expect(style.colorsEnabled).toBe(false);
		expect(style.enabled).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Runtime style — TERM / COLORTERM changes
// ────────────────────────────────────────────────────────────────────────────

describe("runtime style — TERM/COLORTERM changes", () => {
	beforeEach(() => {
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});
	});

	it("re-resolves colorDepth when TERM changes", () => {
		vi.stubEnv("COLORTERM", undefined);
		vi.stubEnv("TERM", "xterm-16color");
		expect(style.colorDepth).toBe("16");

		vi.stubEnv("TERM", "xterm-256color");
		expect(style.colorDepth).toBe("256");
	});

	it("re-resolves colorDepth when COLORTERM changes", () => {
		vi.stubEnv("TERM", "xterm-256color");
		vi.stubEnv("COLORTERM", undefined);
		expect(style.colorDepth).toBe("256");

		vi.stubEnv("COLORTERM", "truecolor");
		expect(style.colorDepth).toBe("truecolor");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Chainable IS AnsiPair
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

	it("top-level imports (bold, red) carry open/close", () => {
		expect(bold.open).toBe("\x1b[1m");
		expect(bold.close).toBe("\x1b[22m");
		expect(red.open).toBe("\x1b[31m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Tagged template literals
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
// fg/bg in chain (extension and root)
// ────────────────────────────────────────────────────────────────────────────

describe("fg/bg as chain methods", () => {
	it("appends a foreground color to an existing chain", () => {
		expect(always.bold.fg("#ff8800")("warning")).toBe(
			"\x1b[1m\x1b[38;2;255;136;0mwarning\x1b[39m\x1b[22m",
		);
	});

	it("appends a background color to an existing chain", () => {
		expect(always.bold.bg("#330000")("err")).toBe("\x1b[1m\x1b[48;2;51;0;0merr\x1b[49m\x1b[22m");
	});

	it("can chain after a dynamic color (fg(...).italic.underline)", () => {
		expect(always.fg("rebeccapurple").italic.underline("triple")).toBe(
			"\x1b[38;2;102;51;153m\x1b[3m\x1b[4mtriple\x1b[24m\x1b[23m\x1b[39m",
		);
	});

	it("style.fg(input) acts as a chain root (1-arg form)", () => {
		expect(always.fg("#00aaff")("dynamic")).toBe("\x1b[38;2;0;170;255mdynamic\x1b[39m");
	});

	it("style.fg(text, input) still works as direct call (2-arg form)", () => {
		expect(always.fg("text", "#00aaff")).toBe("\x1b[38;2;0;170;255mtext\x1b[39m");
	});

	it("chain-root dynamic colors carry open/close", () => {
		const root = always.fg("#00aaff");
		expect(root.open).toBe("\x1b[38;2;0;170;255m");
		expect(root.close).toBe("\x1b[39m");
	});

	it("invalid input still throws via the chain root", () => {
		expect(() => always.fg("definitely-not-a-color")).toThrow(TypeError);
		expect(() => always.bold.fg("nope")).toThrow(TypeError);
	});

	it("root fg snapshots tuple input against later caller mutation", () => {
		const s = createStyle({ mode: "always" });
		const rgb: [number, number, number] = [255, 0, 0];
		const chain = s.fg(rgb);
		rgb[0] = 0;
		rgb[1] = 255;
		const red = "\x1b[38;2;255;0;0mx\x1b[39m";
		expect(chain("x")).toBe(red);
		expect(`${chain.open}x${chain.close}`).toBe(red);
		expect(s.fg("#ff0000")("x")).toBe(red);
		expect(s.fg(rgb)("x")).toBe("\x1b[38;2;0;255;0mx\x1b[39m");
	});

	it("appended bg snapshots tuple input against later caller mutation", () => {
		const s = createStyle({ mode: "always" });
		const rgb: [number, number, number] = [51, 0, 0];
		const chain = s.bold.bg(rgb);
		rgb[0] = 0;
		rgb[2] = 51;
		const darkRed = "\x1b[1m\x1b[48;2;51;0;0mx\x1b[49m\x1b[22m";
		expect(chain("x")).toBe(darkRed);
		expect(`${chain.open}x${chain.close}`).toBe(darkRed);
		expect(s.bold.bg("#330000")("x")).toBe(darkRed);
		expect(s.bold.bg(rgb)("x")).toBe("\x1b[1m\x1b[48;2;0;0;51mx\x1b[49m\x1b[22m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Defensive nullish handling
// ────────────────────────────────────────────────────────────────────────────

describe("Defensive nullish handling", () => {
	it("red(undefined) returns '' (no styled \"undefined\")", () => {
		expect(red(undefined)).toBe("");
		expect(always.red(undefined)).toBe("");
	});

	it("red(null) returns '' (no styled \"null\")", () => {
		expect(red(null)).toBe("");
		expect(always.red(null)).toBe("");
	});

	it("red('') returns '' (no escape codes for empty content)", () => {
		expect(always.red("")).toBe("");
		expect(red("")).toBe("");
	});

	it("chain(undefined) does not crash and returns ''", () => {
		expect(always.bold.red(undefined)).toBe("");
		expect(always.bold.red.bgYellow(null)).toBe("");
	});
});

// ───────────────────────────────────────────────────────────────────────────
// Environment changes — dynamic chains
// ───────────────────────────────────────────────────────────────────────────
//
// Runtime facade chains re-resolve capabilities when called.

describe("environment changes — dynamic chains", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("top-level `bold` re-resolves on every call after an env flip", () => {
		vi.stubEnv("FORCE_COLOR", "3");
		const captured = bold;
		expect(captured("x")).toBe("\x1b[1mx\x1b[22m");
		vi.stubEnv("FORCE_COLOR", "0");
		// FORCE_COLOR=0 is the all-ANSI-off switch — captured ref follows.
		expect(captured("x")).toBe("x");
	});

	it("`style.bold` (forwarder) re-resolves after an env flip", () => {
		vi.stubEnv("FORCE_COLOR", "3");
		const captured = style.bold;
		vi.stubEnv("FORCE_COLOR", "0");
		expect(captured.red("x")).toBe("x");
	});

	it("stored sub-chains re-resolve after an env flip", () => {
		vi.stubEnv("FORCE_COLOR", "3");
		const captured = style.bold.red;
		expect(captured("x")).toBe("\x1b[1m\x1b[31mx\x1b[39m\x1b[22m");
		vi.stubEnv("FORCE_COLOR", "0");
		expect(captured("x")).toBe("x");
	});

	it("stored dynamic-color chains re-resolve color depth", () => {
		vi.stubEnv("FORCE_COLOR", "3");
		const captured = style.bold.fg("#ff0000");
		expect(captured("x")).toBe("\x1b[1m\x1b[38;2;255;0;0mx\x1b[39m\x1b[22m");
		vi.stubEnv("FORCE_COLOR", "2");
		expect(captured("x")).toBe("\x1b[1m\x1b[38;5;196mx\x1b[39m\x1b[22m");
	});
});
