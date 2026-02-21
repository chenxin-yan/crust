import { describe, expect, it } from "bun:test";

describe("@crustjs/style", () => {
	it("should be importable", async () => {
		const mod = await import("./index.ts");
		expect(mod).toBeDefined();
	});
});
