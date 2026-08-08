import { describe, expect, it } from "bun:test";

import { bold, magenta } from "@crustjs/style";

import { defaultTheme } from "./core/theme.ts";
import { createPrompts } from "./create-prompts.ts";
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

	it("instances are isolated from each other", async () => {
		const a = createPrompts({ theme: { prefix: () => "[A]" } });
		const b = createPrompts({ theme: { prefix: () => "[B]" } });

		const first = renderPrompt<ConfirmOptions, boolean>(a.confirm, { message: "One?" });
		await tick();
		expect(first.screen()).toContain("[A]");
		expect(first.screen()).not.toContain("[B]");
		first.keys("return");
		await first.answer;

		const second = renderPrompt<ConfirmOptions, boolean>(b.confirm, { message: "Two?" });
		await tick();
		expect(second.screen()).toContain("[B]");
		expect(second.screen()).not.toContain("[A]");
		second.keys("return");
		await second.answer;

		// First instance is unaffected by the second's overrides
		const third = renderPrompt<ConfirmOptions, boolean>(a.confirm, { message: "Three?" });
		await tick();
		expect(third.screen()).toContain("[A]");
		third.keys("return");
		await third.answer;
	});

	it("keeps instance-only slots when a different slot is overridden per call", async () => {
		const p = createPrompts({
			theme: { prefix: () => "[INST]", message: (t) => `«${t}»` },
		});
		const prompt = renderPrompt<ConfirmOptions, boolean>(p.confirm, {
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
		const prompt = renderPrompt<ConfirmOptions, boolean>(p.confirm, { message: "Continue?" });
		await tick();
		expect(prompt.screen()).toContain("[ORIG]");
		expect(p.theme.prefix("")).toBe("[ORIG]");
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
});
