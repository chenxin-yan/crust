import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { center, padEnd, padStart } from "./pad.ts";
import { bold } from "./runtime-exports.ts";

beforeAll(() => vi.stubEnv("FORCE_COLOR", "3"));
afterAll(() => vi.unstubAllEnvs());

describe.each([
	["padStart", padStart],
	["padEnd", padEnd],
	["center", center],
])("%s", (_name, pad) => {
	it("returns text unchanged when already at target width", () => {
		expect(pad("hello", 5)).toBe("hello");
	});
});

describe("padStart", () => {
	it("pads with custom fill character", () => {
		expect(padStart("hi", 5, ".")).toBe("...hi");
	});
});

describe("center", () => {
	it("puts extra character on the right for odd padding", () => {
		expect(center("hi", 7)).toBe("  hi   ");
	});
});

describe("styled text", () => {
	it.each([
		["padStart", padStart, 5, "   ", ""],
		["padEnd", padEnd, 5, "", "   "],
		["center", center, 6, "  ", "  "],
	])("%s pads based on visible width, ignoring ANSI", (_name, pad, width, before, after) => {
		const styled = bold("hi");
		expect(pad(styled, width)).toBe(`${before}${styled}${after}`);
	});
});
