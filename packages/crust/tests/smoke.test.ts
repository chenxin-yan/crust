import { describe, expect, it } from "bun:test";

describe("crust package smoke test", () => {
	it("should pass a trivial test", () => {
		expect(true).toBe(true);
	});
});
