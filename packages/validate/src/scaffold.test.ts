import { describe, expect, it } from "bun:test";

describe("@crustjs/validate scaffold", () => {
	it("root entrypoint is importable", async () => {
		const mod = await import("./index.ts");
		expect(mod).toBeDefined();
		// Root barrel exports only type-only re-exports (ValidatedContext, ValidationIssue),
		// which are erased at runtime — no runtime value exports expected.
		expect(Object.keys(mod)).toEqual([]);
	});

	it("standard entrypoint is importable", async () => {
		const mod = await import("./standard/index.ts");
		expect(mod).toBeDefined();
		expect(typeof mod.isStandardSchema).toBe("function");
		expect(typeof mod.validateStandard).toBe("function");
		expect(typeof mod.validateStandardSync).toBe("function");
		expect(typeof mod.normalizeStandardIssues).toBe("function");
		expect(typeof mod.normalizeStandardPath).toBe("function");
		expect(typeof mod.success).toBe("function");
		expect(typeof mod.failure).toBe("function");
	});

	it("zod entrypoint is importable", async () => {
		const mod = await import("./zod/index.ts");
		expect(mod).toBeDefined();
	});

	it("effect entrypoint is importable", async () => {
		const mod = await import("./effect/index.ts");
		expect(mod).toBeDefined();
	});
});
