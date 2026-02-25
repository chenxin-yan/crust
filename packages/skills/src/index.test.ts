import { describe, expect, it } from "bun:test";

// ────────────────────────────────────────────────────────────────────────────
// Baseline tests — verify the @crustjs/skills module exports load correctly
// ────────────────────────────────────────────────────────────────────────────

describe("@crustjs/skills exports", () => {
	it("exports generateSkill function", async () => {
		const mod = await import("./index.ts");
		expect(mod.generateSkill).toBeDefined();
		expect(typeof mod.generateSkill).toBe("function");
	});

	it("exports uninstallSkill function", async () => {
		const mod = await import("./index.ts");
		expect(mod.uninstallSkill).toBeDefined();
		expect(typeof mod.uninstallSkill).toBe("function");
	});

	it("exports skillStatus function", async () => {
		const mod = await import("./index.ts");
		expect(mod.skillStatus).toBeDefined();
		expect(typeof mod.skillStatus).toBe("function");
	});

	it("exports skillPlugin function", async () => {
		const mod = await import("./index.ts");
		expect(mod.skillPlugin).toBeDefined();
		expect(typeof mod.skillPlugin).toBe("function");
	});

	it("exports all expected function symbols", async () => {
		const mod = await import("./index.ts");
		const exportedKeys = Object.keys(mod).sort();
		expect(exportedKeys).toEqual(
			["generateSkill", "skillPlugin", "skillStatus", "uninstallSkill"].sort(),
		);
	});
});
