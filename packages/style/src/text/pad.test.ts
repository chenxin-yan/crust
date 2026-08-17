import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { bold } from "../runtimeExports.ts";
import { setEnv, snapshotEnv } from "../testEnv.ts";
import { center, padEnd, padStart } from "./pad.ts";

const restoreEnv = snapshotEnv("FORCE_COLOR");
beforeAll(() => setEnv("FORCE_COLOR", "3"));
afterAll(restoreEnv);

// ────────────────────────────────────────────────────────────────────────────
// padStart — plain text
// ────────────────────────────────────────────────────────────────────────────

describe("padStart — plain text", () => {
	it("pads on the left with spaces by default", () => {
		expect(padStart("hi", 5)).toBe("   hi");
	});

	it("pads with custom fill character", () => {
		expect(padStart("hi", 5, ".")).toBe("...hi");
	});

	it("returns text unchanged when already at target width", () => {
		expect(padStart("hello", 5)).toBe("hello");
	});

	it("returns text unchanged when wider than target", () => {
		expect(padStart("hello world", 5)).toBe("hello world");
	});

	it("pads empty string", () => {
		expect(padStart("", 3)).toBe("   ");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// padStart — styled text
// ────────────────────────────────────────────────────────────────────────────

describe("padStart — styled text", () => {
	it("pads based on visible width, ignoring ANSI", () => {
		const styled = bold("hi");
		const result = padStart(styled, 5);
		// Padding goes before the styled text
		expect(result).toBe(`   ${styled}`);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// padStart — full-width characters
// ────────────────────────────────────────────────────────────────────────────

describe("padStart — full-width characters", () => {
	it("pads correctly with CJK characters", () => {
		// \u4f60 = 你, visible width = 2
		expect(padStart("\u4f60", 5)).toBe("   \u4f60");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// padEnd — plain text
// ────────────────────────────────────────────────────────────────────────────

describe("padEnd — plain text", () => {
	it("pads on the right with spaces by default", () => {
		expect(padEnd("hi", 5)).toBe("hi   ");
	});

	it("pads with custom fill character", () => {
		expect(padEnd("hi", 5, ".")).toBe("hi...");
	});

	it("returns text unchanged when already at target width", () => {
		expect(padEnd("hello", 5)).toBe("hello");
	});

	it("returns text unchanged when wider than target", () => {
		expect(padEnd("hello world", 5)).toBe("hello world");
	});

	it("pads empty string", () => {
		expect(padEnd("", 3)).toBe("   ");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// padEnd — styled text
// ────────────────────────────────────────────────────────────────────────────

describe("padEnd — styled text", () => {
	it("pads based on visible width, ignoring ANSI", () => {
		const styled = bold("hi");
		const result = padEnd(styled, 5);
		// Padding goes after the styled text
		expect(result).toBe(`${styled}   `);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// padEnd — full-width characters
// ────────────────────────────────────────────────────────────────────────────

describe("padEnd — full-width characters", () => {
	it("pads correctly with CJK characters", () => {
		expect(padEnd("\u4f60", 5)).toBe("\u4f60   ");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// center — plain text
// ────────────────────────────────────────────────────────────────────────────

describe("center — plain text", () => {
	it("centers with even padding", () => {
		expect(center("hi", 6)).toBe("  hi  ");
	});

	it("puts extra character on the right for odd padding", () => {
		expect(center("hi", 7)).toBe("  hi   ");
	});

	it("centers with custom fill character", () => {
		expect(center("hi", 6, "-")).toBe("--hi--");
	});

	it("returns text unchanged when already at target width", () => {
		expect(center("hello", 5)).toBe("hello");
	});

	it("returns text unchanged when wider than target", () => {
		expect(center("hello world", 5)).toBe("hello world");
	});

	it("centers empty string", () => {
		expect(center("", 4)).toBe("    ");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// center — styled text
// ────────────────────────────────────────────────────────────────────────────

describe("center — styled text", () => {
	it("centers based on visible width, ignoring ANSI", () => {
		const styled = bold("hi");
		const result = center(styled, 6);
		expect(result).toBe(`  ${styled}  `);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// center — full-width characters
// ────────────────────────────────────────────────────────────────────────────

describe("center — full-width characters", () => {
	it("centers CJK text correctly", () => {
		// \u4f60 = 你, visible width = 2
		expect(center("\u4f60", 6)).toBe("  \u4f60  ");
	});
});
