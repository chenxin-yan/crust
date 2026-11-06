import { bold, magenta } from "@crustjs/style";
import { describe, expect, it } from "vite-plus/test";

import { createPrompts } from "./create-prompts.ts";
import { tick } from "./prompts/test-helpers.ts";
import { renderPrompt } from "./testing.ts";

describe("createPrompts", () => {
	it("resolves instance theme over defaults", () => {
		const p = createPrompts({ theme: { prefix: magenta } });
		expect(p.theme.prefix).toBe(magenta);
		expect(p.theme.message).toBe(bold); // default preserved
	});

	it("keeps instance-only slots when a different slot is overridden per call", async () => {
		const p = createPrompts({
			theme: { prefix: () => "[INST]", message: (t) => `«${t}»` },
		});
		const prompt = renderPrompt(p.confirm, {
			message: "Continue?",
			theme: { prefix: () => "[CALL]" },
		});
		await tick();
		expect(prompt.screen()).toContain("[CALL]"); // per-call wins the conflicting slot
		expect(prompt.screen()).toContain("«Continue?»"); // instance-only slot survives
		prompt.keys("return");
		await prompt.answer;
	});

	it("snapshots overrides at creation; later mutation has no effect", async () => {
		const overrides = { prefix: () => "[ORIG]" };
		const p = createPrompts({ theme: overrides });
		overrides.prefix = () => "[MUTATED]";
		const prompt = renderPrompt(p.confirm, { message: "Continue?" });
		await tick();
		expect(prompt.screen()).toContain("[ORIG]");
		expect(p.theme.prefix("")).toBe("[ORIG]");
		prompt.keys("return");
		await prompt.answer;
	});
});
