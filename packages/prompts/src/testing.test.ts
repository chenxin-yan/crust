import { describe, expect, it } from "vite-plus/test";

import { encodeKey } from "./testing.ts";

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
