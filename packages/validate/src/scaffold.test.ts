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
		expect(typeof mod.promptValidator).toBe("function");
		expect(typeof mod.parsePromptValue).toBe("function");
		expect(typeof mod.parsePromptValueSync).toBe("function");
		expect(typeof mod.storeValidator).toBe("function");
		expect(typeof mod.storeValidatorSync).toBe("function");
	});

	it("standard entrypoint exports exactly the documented API surface", async () => {
		const mod = await import("./standard/index.ts");
		const exports = Object.keys(mod).sort();
		expect(exports).toEqual([
			"parsePromptValue",
			"parsePromptValueSync",
			"promptValidator",
			"storeValidator",
			"storeValidatorSync",
		]);
	});

	it("zod entrypoint is importable", async () => {
		const mod = await import("./zod/index.ts");
		expect(mod).toBeDefined();
		// Command DSL
		expect(typeof mod.arg).toBe("function");
		expect(typeof mod.flag).toBe("function");
		expect(typeof mod.commandValidator).toBe("function");
		// Prompt adapters (re-exported from standard)
		expect(typeof mod.promptValidator).toBe("function");
		expect(typeof mod.parsePromptValue).toBe("function");
		expect(typeof mod.parsePromptValueSync).toBe("function");
		// Store adapters (re-exported from standard)
		expect(typeof mod.storeValidator).toBe("function");
		expect(typeof mod.storeValidatorSync).toBe("function");
	});

	it("zod entrypoint exports exactly the documented API surface", async () => {
		const mod = await import("./zod/index.ts");
		const exports = Object.keys(mod).sort();
		expect(exports).toEqual([
			"arg",
			"commandValidator",
			"flag",
			"parsePromptValue",
			"parsePromptValueSync",
			"promptValidator",
			"storeValidator",
			"storeValidatorSync",
		]);
	});

	it("effect entrypoint is importable", async () => {
		const mod = await import("./effect/index.ts");
		expect(mod).toBeDefined();
		// Command DSL
		expect(typeof mod.arg).toBe("function");
		expect(typeof mod.flag).toBe("function");
		expect(typeof mod.commandValidator).toBe("function");
		// Prompt adapters (re-exported from standard)
		expect(typeof mod.promptValidator).toBe("function");
		expect(typeof mod.parsePromptValue).toBe("function");
		expect(typeof mod.parsePromptValueSync).toBe("function");
		// Store adapters (re-exported from standard)
		expect(typeof mod.storeValidator).toBe("function");
		expect(typeof mod.storeValidatorSync).toBe("function");
	});

	it("effect entrypoint exports exactly the documented API surface", async () => {
		const mod = await import("./effect/index.ts");
		const exports = Object.keys(mod).sort();
		expect(exports).toEqual([
			"arg",
			"commandValidator",
			"flag",
			"parsePromptValue",
			"parsePromptValueSync",
			"promptValidator",
			"storeValidator",
			"storeValidatorSync",
		]);
	});

	it("prompt adapters are identical across entrypoints", async () => {
		const standard = await import("./standard/index.ts");
		const zod = await import("./zod/index.ts");
		const effect = await import("./effect/index.ts");

		// Same function references (re-exports, not copies)
		expect(zod.promptValidator).toBe(standard.promptValidator);
		expect(zod.parsePromptValue).toBe(standard.parsePromptValue);
		expect(zod.parsePromptValueSync).toBe(standard.parsePromptValueSync);
		expect(effect.promptValidator).toBe(standard.promptValidator);
		expect(effect.parsePromptValue).toBe(standard.parsePromptValue);
		expect(effect.parsePromptValueSync).toBe(standard.parsePromptValueSync);
	});

	it("store adapters are identical across entrypoints", async () => {
		const standard = await import("./standard/index.ts");
		const zod = await import("./zod/index.ts");
		const effect = await import("./effect/index.ts");

		// Same function references (re-exports, not copies)
		expect(zod.storeValidator).toBe(standard.storeValidator);
		expect(zod.storeValidatorSync).toBe(standard.storeValidatorSync);
		expect(effect.storeValidator).toBe(standard.storeValidator);
		expect(effect.storeValidatorSync).toBe(standard.storeValidatorSync);
	});
});
