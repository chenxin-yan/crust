import type { Writable } from "node:stream";

import { describe, expect, it } from "vite-plus/test";

import { createPromptIO, encodeKey } from "./testing.ts";

describe("encodeKey", () => {
	it("throws on unsupported key names instead of typing them", () => {
		expect(() => encodeKey("pageup")).toThrow("Unsupported key name");
		expect(() => encodeKey("constructor")).toThrow("Unsupported key name");
		expect(() => encodeKey("")).toThrow("Unsupported key name");
	});
});

describe("createPromptIO screen", () => {
	it("wraps later writes at the size resize() sets and emits resize", () => {
		const harness = createPromptIO();
		let resized = 0;
		// SAFETY: the fake output is a Node.js Writable; TerminalIO types only what prompts use.
		(harness.io.output as unknown as Writable).on("resize", () => resized++);
		harness.resize(10, 5);
		harness.io.output.write("a".repeat(15));

		expect(harness.io.output.columns).toBe(10);
		expect(harness.io.output.rows).toBe(5);
		expect(resized).toBe(1);
		expect(harness.screen()).toBe(`${"a".repeat(10)}\n${"a".repeat(5)}`);
	});

	it("rewraps the screen at the size resize() sets and keeps the cursor in its text", () => {
		const harness = createPromptIO();
		harness.io.output.write(`${"a".repeat(15)}\nb`);
		harness.resize(10, 5);

		expect(harness.screen()).toBe(`${"a".repeat(10)}\n${"a".repeat(5)}\nb`);

		harness.io.output.write("c");
		harness.resize(80, 5);

		expect(harness.screen()).toBe(`${"a".repeat(15)}\nbc`);
	});

	it("keeps a line break written into a wrapped row when resize() rewraps", () => {
		const harness = createPromptIO();
		harness.resize(10, 5);
		harness.io.output.write("abcdefghijkl\x1B[1A\r1234567890\nXY");
		harness.resize(80, 5);

		expect(harness.screen()).toBe("1234567890\nXY");
	});

	it("delays the wrap at the last column until another character arrives", () => {
		const harness = createPromptIO();
		harness.io.output.write(`${"a".repeat(80)}\r\nnext`);

		expect(harness.screen()).toBe(`${"a".repeat(80)}\nnext`);
	});

	it("measures wide characters by display width", () => {
		const harness = createPromptIO();
		harness.io.output.write(`${"a".repeat(79)}界x`);

		// The two-column character does not fit in the last column, so it wraps whole.
		expect(harness.screen()).toBe(`${"a".repeat(79)}\n界x`);
	});

	it("blanks the rest of a wide character when either half is overwritten", () => {
		const harness = createPromptIO();
		harness.io.output.write("界x\ra\n界y\x1B[2Gb");

		expect(harness.screen()).toBe("a x\n by");
	});

	it("attaches a separately written combining mark to a wide character's first cell", () => {
		const harness = createPromptIO();
		harness.io.output.write("界");
		harness.io.output.write("\u0301");
		harness.io.output.write("\rX");

		expect(harness.screen()).toBe("X ");
	});

	it("parses an escape sequence split across writes", () => {
		const harness = createPromptIO();
		harness.io.output.write("\x1B[");
		harness.io.output.write("31mred");
		harness.io.output.write("\x1B[0m");

		expect(harness.screen()).toBe("red");
	});

	it("gives hyperlink escape sequences no width", () => {
		const harness = createPromptIO();
		harness.io.output.write(`\x1B]8;;https://example.com/${"p".repeat(80)}\x07link\x1B]8;;\x07`);

		expect(harness.screen()).toBe("link");
	});
});
