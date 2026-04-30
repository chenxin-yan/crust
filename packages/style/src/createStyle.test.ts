import { describe, expect, it } from "bun:test";
import * as codes from "./ansiCodes.ts";
import { createStyle } from "./createStyle.ts";
import {
	isModifierName,
	modifierNames,
	styleMethodNames,
} from "./styleMethodRegistry.ts";

describe("createStyle — apply() under NO_COLOR", () => {
	// NO_COLOR on a TTY: colorsEnabled=false, modifiersEnabled=true.
	const s = createStyle({
		mode: "auto",
		overrides: { isTTY: true, noColor: "1" },
	});

	it("reports colors disabled but modifiers enabled", () => {
		expect(s.colorsEnabled).toBe(false);
		expect(s.enabled).toBe(true);
	});

	it("chained modifier methods still emit ANSI", () => {
		// Baseline: chaining continues to work under NO_COLOR.
		expect(s.bold("text")).toBe("\x1b[1mtext\x1b[22m");
	});

	it("apply() preserves modifier pairs when colors are disabled", () => {
		// Regression: previously apply() gated on colorsEnabled only, so
		// modifier pairs were stripped under NO_COLOR.
		expect(s.apply("text", codes.bold)).toBe("\x1b[1mtext\x1b[22m");
		expect(s.apply("text", codes.italic)).toBe("\x1b[3mtext\x1b[23m");
		expect(s.apply("text", codes.underline)).toBe("\x1b[4mtext\x1b[24m");
	});

	it("apply() strips color pairs when colors are disabled", () => {
		expect(s.apply("text", codes.red)).toBe("text");
		expect(s.apply("text", codes.bgBlue)).toBe("text");
	});
});

describe("createStyle — apply() in other modes", () => {
	it("mode=always emits both modifier and color pairs", () => {
		const s = createStyle({ mode: "always" });
		expect(s.apply("x", codes.bold)).toBe("\x1b[1mx\x1b[22m");
		expect(s.apply("x", codes.red)).toBe("\x1b[31mx\x1b[39m");
	});

	it("mode=never strips both modifier and color pairs", () => {
		const s = createStyle({ mode: "never" });
		expect(s.apply("x", codes.bold)).toBe("x");
		expect(s.apply("x", codes.red)).toBe("x");
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

	it('reflects "256" in auto mode with TERM=xterm-256color', () => {
		const s = autoStyle({ term: "xterm-256color" });
		expect(s.colorDepth).toBe("256");
		expect(s.trueColorEnabled).toBe(false);
		expect(s.colorsEnabled).toBe(true);
	});

	it('reflects "16" in auto mode with bare TTY', () => {
		expect(autoStyle({}).colorDepth).toBe("16");
	});
});

describe("createStyle — fg/bg emit format matching colorDepth", () => {
	it('fg emits ansi-256 escape when capability is "256"', () => {
		const s = autoStyle({ term: "xterm-256color" });
		const expectedOpen = Bun.color("#ff0000", "ansi-256");
		expect(s.fg("text", "#ff0000")).toBe(`${expectedOpen}text\x1b[39m`);
	});

	it('fg emits a standard 16-color SGR when capability is "16"', () => {
		// Pure red → bright red (`91`); quantized in-package, not via
		// `Bun.color(_, "ansi-16")` which is malformed in some Bun versions
		// (oven-sh/bun#22161).
		expect(autoStyle({}).fg("text", "#ff0000")).toBe("\x1b[91mtext\x1b[39m");
	});

	it('fg returns text unchanged when capability is "none"', () => {
		const s = autoStyle({ isTTY: false });
		expect(s.colorDepth).toBe("none");
		expect(s.fg("text", "#ff0000")).toBe("text");
	});

	it('bg emits ansi-256 background when capability is "256"', () => {
		const s = autoStyle({ term: "xterm-256color" });
		const fgOpen = Bun.color("#00ff88", "ansi-256") as string;
		const expectedOpen = fgOpen.replace("\x1b[38;", "\x1b[48;");
		expect(s.bg("text", "#00ff88")).toBe(`${expectedOpen}text\x1b[49m`);
	});

	it('bg emits a real 16-color background SGR when capability is "16"', () => {
		// `#00ff88` quantizes to bright cyan (`96` fg → `106` bg) under the
		// standard half-channel bucketing (b=0x88=136 rounds to 1).
		const out = autoStyle({}).bg("text", "#00ff88");
		expect(out).toBe("\x1b[106mtext\x1b[49m");
		// Invariant: bg open must always be a background SGR, never a fg one.
		// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences
		expect(/^\x1b\[(?:4[0-7]|10[0-7])m/.test(out)).toBe(true);
	});

	it('bg returns text unchanged when capability is "none"', () => {
		expect(createStyle({ mode: "never" }).bg("text", "#00ff88")).toBe("text");
	});

	it("empty text short-circuits at every depth", () => {
		for (const term of [undefined, "xterm-256color", "xterm-direct"]) {
			const s = autoStyle({ term });
			expect(s.fg("", "#ff0000")).toBe("");
			expect(s.bg("", "#ff0000")).toBe("");
		}
	});
});

describe("styleMethodRegistry — modifier classification", () => {
	it("every modifier name is a registered style method name", () => {
		const allNames = new Set<string>(styleMethodNames);
		for (const name of modifierNames) {
			expect(allNames.has(name)).toBe(true);
		}
	});

	it("isModifierName identifies modifiers and excludes colors", () => {
		for (const name of modifierNames) {
			expect(isModifierName(name)).toBe(true);
		}
		expect(isModifierName("red")).toBe(false);
		expect(isModifierName("bgBlue")).toBe(false);
		expect(isModifierName("brightGreen")).toBe(false);
	});
});
