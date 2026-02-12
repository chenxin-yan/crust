import { describe, expect, it } from "bun:test";
import { hello } from "../src/index";

describe("smoke test", () => {
	it("should pass a trivial test", () => {
		expect(1 + 1).toBe(2);
	});

	it("should import and run hello from @crust/core", () => {
		expect(hello("world")).toBe("Hello, world!");
	});
});
