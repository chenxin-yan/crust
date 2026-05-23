import { describe, expect, it } from "bun:test";

describe("@crustjs/validate scaffold", () => {
	it("root entrypoint is importable", async () => {
		const mod = await import("./index.ts");
		expect(mod).toBeDefined();
		// Root barrel is the single entry point (Standard Schema-first).
		expect(typeof mod.arg).toBe("function");
		expect(typeof mod.flag).toBe("function");
		expect(typeof mod.commandValidator).toBe("function");
		expect(typeof mod.parseValue).toBe("function");
		expect(typeof mod.isStandardSchema).toBe("function");
		expect(typeof mod.validateStandard).toBe("function");
		expect(typeof mod.validateStandardSync).toBe("function");
	});

	it("root entrypoint exports exactly the locked 7-function API surface", async () => {
		// `field()` moved to `@crustjs/store` in 0.3.0.
		const mod = await import("./index.ts");
		const exports = Object.keys(mod).sort();
		expect(exports).toEqual([
			"arg",
			"commandValidator",
			"flag",
			"isStandardSchema",
			"parseValue",
			"validateStandard",
			"validateStandardSync",
		]);
	});
});
