import { describe, expect, it } from "bun:test";
import * as codes from "../ansiCodes.ts";
import { bgRed, blue, red } from "../colors.ts";
import { bold, dim, italic } from "../modifiers.ts";
import { applyStyle, composeStyles } from "../styleEngine.ts";
import { stripAnsi } from "./stripAnsi.ts";

// ────────────────────────────────────────────────────────────────────────────
// stripAnsi — plain text passthrough
// ────────────────────────────────────────────────────────────────────────────

describe("stripAnsi — plain text", () => {
	it("returns plain text unchanged", () => {
		expect(stripAnsi("hello world")).toBe("hello world");
	});

	it("returns empty string for empty input", () => {
		expect(stripAnsi("")).toBe("");
	});

	it("preserves whitespace", () => {
		expect(stripAnsi("  hello  ")).toBe("  hello  ");
	});

	it("preserves newlines", () => {
		expect(stripAnsi("hello\nworld")).toBe("hello\nworld");
	});

	it("preserves tabs", () => {
		expect(stripAnsi("hello\tworld")).toBe("hello\tworld");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// stripAnsi — single styles
// ────────────────────────────────────────────────────────────────────────────

describe("stripAnsi — single styles", () => {
	it("strips bold", () => {
		expect(stripAnsi(bold("hello"))).toBe("hello");
	});

	it("strips dim", () => {
		expect(stripAnsi(dim("secondary"))).toBe("secondary");
	});

	it("strips italic", () => {
		expect(stripAnsi(italic("emphasis"))).toBe("emphasis");
	});

	it("strips foreground color", () => {
		expect(stripAnsi(red("error"))).toBe("error");
	});

	it("strips background color", () => {
		expect(stripAnsi(bgRed("alert"))).toBe("alert");
	});

	it("strips reset code", () => {
		expect(stripAnsi("\x1b[0m")).toBe("");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// stripAnsi — nested and composed styles
// ────────────────────────────────────────────────────────────────────────────

describe("stripAnsi — nested and composed styles", () => {
	it("strips nested styles", () => {
		const styled = bold(`hello ${red("world")}!`);
		expect(stripAnsi(styled)).toBe("hello world!");
	});

	it("strips composed styles", () => {
		const boldBlue = composeStyles(codes.bold, codes.blue);
		const styled = applyStyle("info", boldBlue);
		expect(stripAnsi(styled)).toBe("info");
	});

	it("strips multiple styled segments", () => {
		const styled = `${red("error")}: ${blue("info")} - ${bold("important")}`;
		expect(stripAnsi(styled)).toBe("error: info - important");
	});

	it("strips deeply nested styles", () => {
		const styled = bold(italic(red("deep")));
		expect(stripAnsi(styled)).toBe("deep");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// stripAnsi — raw escape sequences
// ────────────────────────────────────────────────────────────────────────────

describe("stripAnsi — raw escape sequences", () => {
	it("strips raw SGR sequences", () => {
		expect(stripAnsi("\x1b[31mhello\x1b[39m")).toBe("hello");
	});

	it("strips cursor movement sequences", () => {
		expect(stripAnsi("\x1b[2Ahello")).toBe("hello");
	});

	it("strips mixed escape and plain text", () => {
		expect(stripAnsi("before\x1b[1m middle \x1b[22mafter")).toBe(
			"before middle after",
		);
	});
});
