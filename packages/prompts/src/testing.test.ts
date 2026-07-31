import { describe, expect, it } from "bun:test";

import { encodeKey } from "./testing.ts";

describe("encodeKey", () => {
	it("encodes named keys", () => {
		expect(encodeKey("return")).toBe("\r");
		expect(encodeKey("up")).toBe("\x1B[A");
		expect(encodeKey("space")).toBe(" ");
	});

	it("encodes ctrl combinations", () => {
		expect(encodeKey("ctrl+c")).toBe("\x03");
	});

	it("passes single printable characters through", () => {
		expect(encodeKey("y")).toBe("y");
	});

	it("throws on unsupported key names instead of typing them", () => {
		expect(() => encodeKey("pageup")).toThrow("Unsupported key name");
		expect(() => encodeKey("")).toThrow("Unsupported key name");
	});
});
