import { describe, expect, it } from "bun:test";

import { createStyle } from "./createStyle.ts";

describe("createStyle — apply() under NO_COLOR", () => {
	// NO_COLOR on a TTY: colorsEnabled=false, modifiersEnabled=true.
	const s = createStyle({
		mode: "auto",
		overrides: { isTTY: true, noColor: "1" },
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
		// oxlint-disable-next-line no-control-regex -- matching ANSI escape sequences
		expect(/^\x1b\[(?:4[0-7]|10[0-7])m/.test(out)).toBe(true);
	});
});
