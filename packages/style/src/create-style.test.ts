import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createStyle, style } from "./create-style.ts";
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

	it("supports chainable styles", () => {
		expect(s.bold.red("text")).toBe("\x1b[1m\x1b[31mtext\x1b[39m\x1b[22m");
	});

	it("last color in chain takes precedence", () => {
		expect(s.red.blue("text")).toBe("\x1b[31m\x1b[34mtext\x1b[39m\x1b[31m\x1b[39m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// createStyle — never mode
// ────────────────────────────────────────────────────────────────────────────

describe("createStyle — never mode", () => {
	const s = createStyle({ mode: "never" });

	it("supports chainable styles without ANSI output", () => {
		expect(s.bold.red("text")).toBe("text");
		expect(s.bgBlue.underline("text")).toBe("text");
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
// createStyle — dynamic color (truecolor) mode gating
// ────────────────────────────────────────────────────────────────────────────

describe("createStyle — dynamic colors auto mode with truecolor overrides", () => {
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
});

// ────────────────────────────────────────────────────────────────────────────
// Chainable IS AnsiPair
// ────────────────────────────────────────────────────────────────────────────

describe("ChainableStyleFn extends AnsiPair", () => {
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

	it("can chain after a dynamic color (fg(...).italic.underline)", () => {
		expect(always.fg("rebeccapurple").italic.underline("triple")).toBe(
			"\x1b[38;2;102;51;153m\x1b[3m\x1b[4mtriple\x1b[24m\x1b[23m\x1b[39m",
		);
	});

	it("style.fg(text, input) still works as direct call (2-arg form)", () => {
		expect(always.fg("text", "#00aaff")).toBe("\x1b[38;2;0;170;255mtext\x1b[39m");
	});

	it("invalid input still throws via the chain root", () => {
		expect(() => always.fg("definitely-not-a-color")).toThrow(TypeError);
		expect(() => always.bold.fg("nope")).toThrow(TypeError);
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
