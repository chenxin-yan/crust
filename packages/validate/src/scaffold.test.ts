import { describe, expect, it } from "bun:test";

describe("@crustjs/validate scaffold", () => {
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
