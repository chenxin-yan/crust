import { describe, expect, it } from "bun:test";

import { renderPrompt } from "../testing.ts";
import { confirm, type ConfirmOptions } from "./confirm.ts";
import { nonTTYIO, tick } from "./test-helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Default value
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — default value", () => {
	it("defaults to true when no default is specified", async () => {
		const prompt = renderPrompt(confirm, { message: "Continue?" });

		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe(true);
	});

	it("uses default: false when specified", async () => {
		const prompt = renderPrompt(confirm, {
			message: "Continue?",
			default: false,
		});

		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Toggle behavior
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — toggle", () => {
	it("left arrow toggles value", async () => {
		const prompt = renderPrompt(confirm, { message: "Continue?" });

		await tick();
		// Default is true, left should toggle to false
		prompt.keys("left");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe(false);
	});

	it("right arrow toggles value", async () => {
		const prompt = renderPrompt(confirm, { message: "Continue?" });

		await tick();
		// Default is true, right should toggle to false
		prompt.keys("right");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe(false);
	});

	it("tab toggles value", async () => {
		const prompt = renderPrompt(confirm, { message: "Continue?" });

		await tick();
		// Default is true, tab should toggle to false
		prompt.keys("tab");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe(false);
	});

	it("double toggle returns to original value", async () => {
		const prompt = renderPrompt(confirm, { message: "Continue?" });

		await tick();
		// Toggle twice — should be back to true
		prompt.keys("left");
		await tick();
		prompt.keys("right");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Keyboard shortcuts
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — shortcuts", () => {
	it("y key sets value to true", async () => {
		const prompt = renderPrompt(confirm, {
			message: "Continue?",
			default: false,
		});

		await tick();
		prompt.type("y");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe(true);
	});

	it("Y key sets value to true", async () => {
		const prompt = renderPrompt(confirm, {
			message: "Continue?",
			default: false,
		});

		await tick();
		prompt.type("Y");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe(true);
	});

	it("n key sets value to false", async () => {
		const prompt = renderPrompt(confirm, { message: "Continue?" });

		await tick();
		prompt.type("n");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe(false);
	});

	it("N key sets value to false", async () => {
		const prompt = renderPrompt(confirm, { message: "Continue?" });

		await tick();
		prompt.type("N");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe(false);
	});

	it("h key sets value to true (yes/active)", async () => {
		const prompt = renderPrompt(confirm, {
			message: "Continue?",
			default: false,
		});

		await tick();
		prompt.type("h");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe(true);
	});

	it("l key sets value to false (no/inactive)", async () => {
		const prompt = renderPrompt(confirm, { message: "Continue?" });

		await tick();
		prompt.type("l");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Custom labels
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — custom labels", () => {
	it("renders custom active and inactive labels", async () => {
		const prompt = renderPrompt(confirm, {
			message: "Accept terms?",
			active: "Agree",
			inactive: "Decline",
		});

		await tick();
		expect(prompt.screen()).toContain("Agree");
		expect(prompt.screen()).toContain("Decline");

		prompt.keys("return");
		await prompt.answer;
	});

	it("shows selected custom label on submit", async () => {
		const prompt = renderPrompt(confirm, {
			message: "Proceed?",
			active: "Accept",
			inactive: "Reject",
			default: false,
		});

		await tick();
		// Toggle to true (Accept)
		prompt.type("y");
		await tick();
		prompt.keys("return");

		await prompt.answer;
		expect(prompt.screen()).toBe("✓ Proceed? Accept");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — rendering", () => {
	it("renders message on initial display", async () => {
		const prompt = renderPrompt(confirm, { message: "Deploy to production?" });

		await tick();
		expect(prompt.screen()).toContain("Deploy to production?");

		prompt.keys("return");
		await prompt.answer;
	});

	it("renders submitted answer on confirm", async () => {
		const prompt = renderPrompt(confirm, { message: "Continue?" });

		await tick();
		prompt.type("n");
		await tick();
		prompt.keys("return");

		await prompt.answer;
		// After submission, the selected answer should appear
		expect(prompt.screen()).toBe("✓ Continue? No");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — no message", () => {
	it("renders default message before and after submission", async () => {
		const prompt = renderPrompt(confirm, {});

		await tick();
		expect(prompt.screen()).toContain("Are you sure?");
		expect(prompt.screen()).not.toContain("undefined");
		expect(prompt.screen()).toContain("Yes");
		expect(prompt.screen()).toContain("No");

		prompt.keys("return");
		const result = await prompt.answer;
		expect(result).toBe(true);
		expect(prompt.screen()).toContain("Are you sure?");
		expect(prompt.screen()).not.toContain("undefined");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — non-TTY", () => {
	function nonTTY(options: ConfirmOptions): Promise<boolean> {
		return confirm(options, nonTTYIO());
	}

	it("returns initial value in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Continue?",
			initial: false,
		});

		expect(result).toBe(false);
	});

	it("returns explicit default value in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Continue?",
			default: false,
		});

		expect(result).toBe(false);
	});

	it("throws NonInteractiveError when no explicit default in non-TTY", async () => {
		await expect(nonTTY({ message: "Continue?" })).rejects.toThrow("interactive terminal");
	});

	it("prefers initial over default in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Continue?",
			initial: true,
			default: false,
		});

		expect(result).toBe(true);
	});
});
