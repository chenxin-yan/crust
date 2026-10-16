import { describe, expect, it } from "vite-plus/test";

import { styleMethodPairs } from "./ansi-codes.ts";
import { applyStyle } from "./style-engine.ts";

// ────────────────────────────────────────────────────────────────────────────
// applyStyle — basic application
// ────────────────────────────────────────────────────────────────────────────

describe("applyStyle — basic", () => {
	it("wraps text with open and close sequences", () => {
		const result = applyStyle("hello", styleMethodPairs.bold);
		expect(result).toBe("\x1b[1mhello\x1b[22m");
	});

	it("returns empty string for empty input", () => {
		const result = applyStyle("", styleMethodPairs.bold);
		expect(result).toBe("");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// applyStyle — nesting
// ────────────────────────────────────────────────────────────────────────────

describe("applyStyle — nesting", () => {
	it("bold wrapping red — no interference since close codes differ", () => {
		// red("world") = "\x1b[31mworld\x1b[39m"
		// Bold close is 22m, red close is 39m — they don't collide.
		// Bold remains active through the red segment because red only
		// resets the foreground color, not the intensity attribute.
		const inner = applyStyle("world", styleMethodPairs.red);
		const outer = applyStyle(`hello ${inner}!`, styleMethodPairs.bold);

		expect(outer).toBe("\x1b[1mhello \x1b[31mworld\x1b[39m!\x1b[22m");
	});

	it("handles bold wrapping dim where both share close code 22m", () => {
		// Both bold and dim close with \x1b[22m. When bold wraps dim, the
		// dim close should trigger bold to reopen.
		const inner = applyStyle("soft", styleMethodPairs.dim);
		const outer = applyStyle(`start ${inner} end`, styleMethodPairs.bold);

		expect(outer).toBe("\x1b[1mstart \x1b[2msoft\x1b[22m\x1b[1m end\x1b[22m");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// applyStyle — boundary / edge cases
// ────────────────────────────────────────────────────────────────────────────

describe("applyStyle — edge cases", () => {
	it("is null-safe (matches chain behavior)", () => {
		expect(applyStyle(undefined, styleMethodPairs.bold)).toBe("");
		expect(applyStyle(null, styleMethodPairs.red)).toBe("");
	});
});
