import { describe, expect, it } from "bun:test";

describe("@crustjs/validate scaffold", () => {
	it("root entrypoint is importable", async () => {
		const mod = await import("./index.ts");
		expect(mod).toBeDefined();
		expect(Object.keys(mod)).toEqual([]);
		expect("throwValidationError" in mod).toBe(false);
	});

	it("zod entrypoint is importable", async () => {
		const mod = await import("./zod/index.ts");
		expect(mod).toBeDefined();
	});
});
