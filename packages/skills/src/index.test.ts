import { describe, expect, it } from "bun:test";

// ────────────────────────────────────────────────────────────────────────────
// Baseline tests — verify the @crustjs/skills module exports load correctly
// ────────────────────────────────────────────────────────────────────────────

describe("@crustjs/skills exports", () => {
	it("exports buildManifest function", async () => {
		const mod = await import("./index.ts");
		expect(mod.buildManifest).toBeDefined();
		expect(typeof mod.buildManifest).toBe("function");
	});

	it("exports renderSkill function", async () => {
		const mod = await import("./index.ts");
		expect(mod.renderSkill).toBeDefined();
		expect(typeof mod.renderSkill).toBe("function");
	});

	it("exports generateSkill function", async () => {
		const mod = await import("./index.ts");
		expect(mod.generateSkill).toBeDefined();
		expect(typeof mod.generateSkill).toBe("function");
	});

	it("exports all expected type-related symbols", async () => {
		// Type exports don't appear at runtime, but we can verify the module
		// loads without errors and all function exports are present
		const mod = await import("./index.ts");
		const exportedKeys = Object.keys(mod).sort();
		expect(exportedKeys).toEqual(
			["buildManifest", "generateSkill", "renderSkill"].sort(),
		);
	});
});
