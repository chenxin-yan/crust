import { describe, expect, it } from "bun:test";

import { bold, magenta } from "@crustjs/style";

import { defaultTheme } from "./core/theme.ts";
import { createPrompts, prompts } from "./create-prompts.ts";
import type { ConfirmOptions } from "./prompts/confirm.ts";
import { renderPrompt } from "./testing.ts";

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createPrompts", () => {
	it("resolves instance theme over defaults", () => {
		const p = createPrompts({ theme: { prefix: magenta } });
		expect(p.theme.prefix).toBe(magenta);
		expect(p.theme.message).toBe(bold); // default preserved
	});

	it("with no options mirrors defaultTheme", () => {
		const p = createPrompts();
		expect(p.theme).toEqual(defaultTheme);
	});

	it("instance theme reaches prompt rendering", async () => {
		const p = createPrompts({ theme: { success: (t) => `<${t}>` } });
		// Non-TTY short-circuit still resolves; theme merge must not throw
		const result = await p.input({ message: "Name?", initial: "Alice" });
		expect(result).toBe("Alice");
	});

	it("instance theme styles rendered output", async () => {
		const p = createPrompts({ theme: { prefix: () => "[INST]" } });
		const prompt = renderPrompt<ConfirmOptions, boolean>(p.confirm, { message: "Continue?" });
		await tick();
		expect(prompt.screen()).toContain("[INST]");
		prompt.keys("return");
		await prompt.answer;
	});

	it("per-call theme overrides instance theme", async () => {
		const p = createPrompts({ theme: { prefix: () => "[INST]" } });
		const prompt = renderPrompt<ConfirmOptions, boolean>(p.confirm, {
			message: "Continue?",
			theme: { prefix: () => "[CALL]" },
		});
		await tick();
		expect(prompt.screen()).toContain("[CALL]");
		expect(prompt.screen()).not.toContain("[INST]");
		prompt.keys("return");
		await prompt.answer;
	});

	it("default prompts singleton uses defaultTheme", () => {
		expect(prompts.theme).toEqual(defaultTheme);
	});

	it("singleton prompt functions short-circuit like bare exports", async () => {
		const result = await prompts.confirm({ message: "Sure?", initial: true });
		expect(result).toBe(true);
	});
});
