import { describe, expect, it } from "bun:test";

import { createPromptIO, renderPrompt, type RenderedPrompt } from "../testing.ts";
import { confirm, type ConfirmOptions } from "./confirm.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

let activePrompt: Pick<RenderedPrompt<unknown>, "type" | "keys" | "screen">;

function start(options: ConfirmOptions): Promise<boolean> {
	const prompt = renderPrompt<ConfirmOptions, boolean>(confirm, options);
	activePrompt = prompt;
	return prompt.answer;
}

function pressKey(
	char: string,
	key?: Partial<{ name: string; ctrl: boolean; meta: boolean; shift: boolean }>,
): void {
	if (key?.ctrl) {
		activePrompt.keys(`ctrl+${key.name ?? char}`);
	} else if (char === "") {
		activePrompt.keys(key?.name ?? "");
	} else {
		activePrompt.type(char);
	}
}

function screen(): string {
	return activePrompt.screen();
}

function tick(ms = 10): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function nonTTYIO() {
	return createPromptIO({ isTTY: false }).io;
}
// ────────────────────────────────────────────────────────────────────────────
// Default value
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — default value", () => {
	it("defaults to true when no default is specified", async () => {
		const promise = start({ message: "Continue?" });

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(true);
	});

	it("uses default: false when specified", async () => {
		const promise = start({
			message: "Continue?",
			default: false,
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(false);
	});

	it("uses default: true when specified", async () => {
		const promise = start({
			message: "Continue?",
			default: true,
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Toggle behavior
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — toggle", () => {
	it("left arrow toggles value", async () => {
		const promise = start({ message: "Continue?" });

		await tick();
		// Default is true, left should toggle to false
		pressKey("", { name: "left" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(false);
	});

	it("right arrow toggles value", async () => {
		const promise = start({ message: "Continue?" });

		await tick();
		// Default is true, right should toggle to false
		pressKey("", { name: "right" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(false);
	});

	it("tab toggles value", async () => {
		const promise = start({ message: "Continue?" });

		await tick();
		// Default is true, tab should toggle to false
		pressKey("", { name: "tab" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(false);
	});

	it("double toggle returns to original value", async () => {
		const promise = start({ message: "Continue?" });

		await tick();
		// Toggle twice — should be back to true
		pressKey("", { name: "left" });
		await tick();
		pressKey("", { name: "right" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Keyboard shortcuts
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — shortcuts", () => {
	it("y key sets value to true", async () => {
		const promise = start({
			message: "Continue?",
			default: false,
		});

		await tick();
		pressKey("y");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(true);
	});

	it("Y key sets value to true", async () => {
		const promise = start({
			message: "Continue?",
			default: false,
		});

		await tick();
		pressKey("Y", { name: "y", shift: true });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(true);
	});

	it("n key sets value to false", async () => {
		const promise = start({ message: "Continue?" });

		await tick();
		pressKey("n");
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(false);
	});

	it("N key sets value to false", async () => {
		const promise = start({ message: "Continue?" });

		await tick();
		pressKey("N", { name: "n", shift: true });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(false);
	});

	it("h key sets value to true (yes/active)", async () => {
		const promise = start({
			message: "Continue?",
			default: false,
		});

		await tick();
		pressKey("h", { name: "h" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(true);
	});

	it("l key sets value to false (no/inactive)", async () => {
		const promise = start({ message: "Continue?" });

		await tick();
		pressKey("l", { name: "l" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(false);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Custom labels
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — custom labels", () => {
	it("renders custom active and inactive labels", async () => {
		const promise = start({
			message: "Accept terms?",
			active: "Agree",
			inactive: "Decline",
		});

		await tick();
		expect(screen()).toContain("Agree");
		expect(screen()).toContain("Decline");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders default Yes/No labels when not customized", async () => {
		const promise = start({ message: "Continue?" });

		await tick();
		expect(screen()).toContain("Yes");
		expect(screen()).toContain("No");

		pressKey("", { name: "return" });
		await promise;
	});

	it("shows selected custom label on submit", async () => {
		const promise = start({
			message: "Accept?",
			active: "Accept",
			inactive: "Reject",
			default: false,
		});

		await tick();
		// Toggle to true (Accept)
		pressKey("y");
		await tick();
		pressKey("", { name: "return" });

		await promise;
		expect(screen()).toContain("Accept");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — rendering", () => {
	it("renders message on initial display", async () => {
		const promise = start({ message: "Deploy to production?" });

		await tick();
		expect(screen()).toContain("Deploy to production?");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders separator between options", async () => {
		const promise = start({ message: "Continue?" });

		await tick();
		expect(screen()).toContain(" · ");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders submitted answer on confirm", async () => {
		const promise = start({ message: "Continue?" });

		await tick();
		pressKey("n");
		await tick();
		pressKey("", { name: "return" });

		await promise;
		// After submission, the selected answer should appear
		expect(screen()).toContain("No");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — no message", () => {
	it("renders default message when message is omitted", async () => {
		const promise = start({});

		await tick();
		expect(screen()).toContain("Are you sure?");
		expect(screen()).not.toContain("undefined");
		expect(screen()).toContain("Yes");
		expect(screen()).toContain("No");

		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe(true);
	});

	it("submitted output shows default message", async () => {
		const promise = start({});

		await tick();
		pressKey("", { name: "return" });

		await promise;
		expect(screen()).toContain("Are you sure?");
		expect(screen()).not.toContain("undefined");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("confirm — non-TTY", () => {
	function nonTTY(options: ConfirmOptions): Promise<boolean> {
		return confirm(options, nonTTYIO());
	}

	it("throws NonInteractiveError when stdin is not a TTY", async () => {
		await expect(nonTTY({ message: "Continue?" })).rejects.toThrow("interactive terminal");
	});

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

	it("returns explicit default true in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Continue?",
			default: true,
		});

		expect(result).toBe(true);
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
