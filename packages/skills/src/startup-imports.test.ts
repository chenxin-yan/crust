import { expect, it, vi } from "vite-plus/test";

// Only the `skills` command prompts or shows a spinner; other commands should not pay to load them.
vi.mock("@crustjs/prompts", () => {
	throw new Error("@crustjs/prompts was loaded on import");
});
vi.mock("@crustjs/progress", () => {
	throw new Error("@crustjs/progress was loaded on import");
});

it("does not load prompts or progress when imported", async () => {
	await expect(import("./index.ts")).resolves.toHaveProperty("skill");
});
