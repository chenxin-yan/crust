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
