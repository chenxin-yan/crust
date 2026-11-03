import { describe, expect, it } from "vite-plus/test";

import { createPromptIO, encodeKey } from "./testing.ts";

describe("encodeKey", () => {
	it("encodes ctrl combinations", () => {
		expect(encodeKey("ctrl+c")).toBe("\x03");
	});

	it("throws on unsupported key names instead of typing them", () => {
		expect(() => encodeKey("pageup")).toThrow("Unsupported key name");
		expect(() => encodeKey("constructor")).toThrow("Unsupported key name");
		expect(() => encodeKey("")).toThrow("Unsupported key name");
	});
});

describe("createPromptIO screen", () => {
	it("wraps text longer than the terminal width onto the next row", () => {
		const harness = createPromptIO();
		harness.io.output.write(`${"a".repeat(80)}${"b".repeat(5)}`);

		expect(harness.screen()).toBe(`${"a".repeat(80)}\n${"b".repeat(5)}`);
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
