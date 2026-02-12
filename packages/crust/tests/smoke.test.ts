import { describe, expect, it } from "bun:test";
import { hello } from "@crust/core";

describe("crust package smoke test", () => {
	it("should re-export @crust/core APIs", () => {
		expect(typeof hello).toBe("function");
	});

	it("should pass a trivial test", () => {
		expect(true).toBe(true);
	});
});
