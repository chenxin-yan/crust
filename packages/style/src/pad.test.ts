import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { center, padEnd, padStart } from "./pad.ts";
import { bold } from "./runtime-exports.ts";

beforeAll(() => vi.stubEnv("FORCE_COLOR", "3"));
afterAll(() => vi.unstubAllEnvs());

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
// padEnd — plain text
// ────────────────────────────────────────────────────────────────────────────

describe("padEnd — plain text", () => {
	it("pads on the right with spaces by default", () => {
		expect(padEnd("hi", 5)).toBe("hi   ");
	});

	it("returns text unchanged when already at target width", () => {
		expect(padEnd("hello", 5)).toBe("hello");
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
// center — plain text
// ────────────────────────────────────────────────────────────────────────────

describe("center — plain text", () => {
	it("centers with even padding", () => {
		expect(center("hi", 6)).toBe("  hi  ");
	});

	it("puts extra character on the right for odd padding", () => {
		expect(center("hi", 7)).toBe("  hi   ");
	});

	it("returns text unchanged when already at target width", () => {
		expect(center("hello", 5)).toBe("hello");
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
