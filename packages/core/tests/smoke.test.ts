import { describe, expect, it } from "bun:test";

describe("smoke test", () => {
	it("should pass a trivial test", () => {
		expect(1 + 1).toBe(2);
	});
});
