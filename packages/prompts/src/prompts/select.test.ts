import { describe, expect, it } from "bun:test";

import { createPromptIO, renderPrompt, type RenderedPrompt } from "../testing.ts";
import { select, type SelectOptions } from "./select.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

let activePrompt: Pick<RenderedPrompt<unknown>, "type" | "keys" | "screen">;

function start<T>(options: SelectOptions<T>): Promise<T> {
	const prompt = renderPrompt<SelectOptions<T>, T>(select, options);
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
// Initial value — object-choice numeric value
// ────────────────────────────────────────────────────────────────────────────

// String-choice happy-path is in tests/integration.test.ts; this exercises the
// non-string `initial` codepath that integration does not cover.
describe("select — initial value", () => {
	it("returns initial value for object choices", async () => {
		const result = await select<number>({
			message: "Pick a port",
			choices: [
				{ label: "HTTP", value: 80 },
				{ label: "HTTPS", value: 443 },
			],
			initial: 443,
		});

		expect(result).toBe(443);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Default cursor position
// ────────────────────────────────────────────────────────────────────────────

describe("select — default value", () => {
	it("sets initial cursor to matching default value", async () => {
		const promise = start({
			message: "Pick a color",
			choices: ["red", "green", "blue"],
			default: "green",
		});

		await tick();
		// Submit immediately — should select "green" (cursor at index 1)
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("green");
	});

	it("defaults cursor to first item when no default is provided", async () => {
		const promise = start({
			message: "Pick a color",
			choices: ["red", "green", "blue"],
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("red");
	});

	it("defaults cursor to first item when default value is not found", async () => {
		const promise = start({
			message: "Pick a color",
			choices: ["red", "green", "blue"],
			default: "yellow",
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("red");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Arrow key navigation
// ────────────────────────────────────────────────────────────────────────────

describe("select — navigation", () => {
	it("down arrow moves cursor down", async () => {
		const promise = start({
			message: "Pick",
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("b");
	});

	it("up arrow moves cursor up", async () => {
		const promise = start({
			message: "Pick",
			choices: ["a", "b", "c"],
			default: "b",
		});

		await tick();
		pressKey("", { name: "up" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("a");
	});

	it("j moves cursor down (vim)", async () => {
		const promise = start({
			message: "Pick",
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey("j", { name: "j" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("b");
	});

	it("k moves cursor up (vim)", async () => {
		const promise = start({
			message: "Pick",
			choices: ["a", "b", "c"],
			default: "c",
		});

		await tick();
		pressKey("k", { name: "k" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("b");
	});

	it("wraps to last item when moving up from first", async () => {
		const promise = start({
			message: "Pick",
			choices: ["a", "b", "c"],
		});

		await tick();
		// Cursor at 0, up should wrap to index 2
		pressKey("", { name: "up" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("c");
	});

	it("wraps to first item when moving down from last", async () => {
		const promise = start({
			message: "Pick",
			choices: ["a", "b", "c"],
			default: "c",
		});

		await tick();
		// Cursor at 2, down should wrap to index 0
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("a");
	});

	it("Enter selects the highlighted item", async () => {
		const promise = start({
			message: "Pick",
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("c");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Choice normalization
// ────────────────────────────────────────────────────────────────────────────

describe("select — choice types", () => {
	it("handles string choices correctly", async () => {
		const promise = start({
			message: "Pick a color",
			choices: ["red", "green", "blue"],
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("red");
	});

	it("handles object choices with label and value", async () => {
		const promise = start({
			message: "Pick a port",
			choices: [
				{ label: "HTTP", value: 80 },
				{ label: "HTTPS", value: 443 },
			],
		});

		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe(443);
	});

	it("handles object choices with hints", async () => {
		const promise = start({
			message: "Pick a port",
			choices: [
				{ label: "HTTP", value: 80 },
				{ label: "HTTPS", value: 443, hint: "recommended" },
			],
		});

		await tick();
		// Verify hint text is rendered
		expect(screen()).toContain("recommended");

		pressKey("", { name: "return" });
		await promise;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

describe("select — rendering", () => {
	it("renders message on initial display", async () => {
		const promise = start({
			message: "Choose your favorite",
			choices: ["apple", "banana", "cherry"],
		});

		await tick();
		expect(screen()).toContain("Choose your favorite");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders all visible choices", async () => {
		const promise = start({
			message: "Pick",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		expect(screen()).toContain("alpha");
		expect(screen()).toContain("beta");
		expect(screen()).toContain("gamma");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders cursor indicator on active item", async () => {
		const promise = start({
			message: "Pick",
			choices: ["alpha", "beta"],
		});

		await tick();
		expect(screen()).toContain("›");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders submitted answer on confirm", async () => {
		const promise = start({
			message: "Pick a fruit",
			choices: ["apple", "banana", "cherry"],
		});

		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "return" });

		await promise;
		// After submit, the selected label should appear in the output
		expect(screen()).toContain("banana");
	});

	it("renders labels for object choices", async () => {
		const promise = start({
			message: "Pick",
			choices: [
				{ label: "Option A", value: 1 },
				{ label: "Option B", value: 2 },
			],
		});

		await tick();
		expect(screen()).toContain("Option A");
		expect(screen()).toContain("Option B");

		pressKey("", { name: "return" });
		await promise;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Viewport scrolling
// ────────────────────────────────────────────────────────────────────────────

describe("select — viewport scrolling", () => {
	it("limits visible choices to maxVisible", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const promise = start({
			message: "Pick",
			choices,
			maxVisible: 5,
		});

		await tick();
		// Only first 5 items should be visible
		expect(screen()).toContain("item-0");
		expect(screen()).toContain("item-4");
		expect(screen()).not.toContain("item-5");

		pressKey("", { name: "return" });
		await promise;
	});

	it("shows scroll-down indicator when more items below", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const promise = start({
			message: "Pick",
			choices,
			maxVisible: 5,
		});

		await tick();
		expect(screen()).toContain("...");

		pressKey("", { name: "return" });
		await promise;
	});

	it("scrolls down when navigating past visible items", async () => {
		const choices = Array.from({ length: 10 }, (_, i) => `item-${i}`);
		const promise = start({
			message: "Pick",
			choices,
			maxVisible: 3,
		});

		await tick();
		// Move down 3 times to scroll past the initial viewport
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "down" });
		await tick();

		// item-3 should now be visible
		expect(screen()).toContain("item-3");

		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe("item-3");
	});

	it("does not show scroll indicators when all items fit", async () => {
		const promise = start({
			message: "Pick",
			choices: ["a", "b", "c"],
			maxVisible: 10,
		});

		await tick();
		// With only 3 items and maxVisible=10, no scroll indicators
		// Count "..." occurrences — should not appear as a scroll indicator line
		const lines = screen().split("\n");
		const scrollLines = lines.filter((l) => l.trim() === "...");
		expect(scrollLines.length).toBe(0);

		pressKey("", { name: "return" });
		await promise;
	});

	it("wrapping from last item scrolls viewport back to top", async () => {
		const choices = Array.from({ length: 10 }, (_, i) => `item-${i}`);
		const promise = start({
			message: "Pick",
			choices,
			maxVisible: 3,
			default: "item-9",
		});

		await tick();
		// At bottom, wrap to top
		pressKey("", { name: "down" });
		await tick();

		// Should now show the first items
		expect(screen()).toContain("item-0");

		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe("item-0");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("select — no message", () => {
	it("renders default message when message is omitted", async () => {
		const promise = start({
			choices: ["a", "b", "c"],
		});

		await tick();
		expect(screen()).toContain("Pick an option");
		expect(screen()).not.toContain("undefined");
		expect(screen()).toContain("a");

		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe("a");
	});

	it("submitted output shows default message", async () => {
		const promise = start({
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey("", { name: "return" });

		await promise;
		expect(screen()).toContain("Pick an option");
		expect(screen()).not.toContain("undefined");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("select — non-TTY", () => {
	function nonTTY<T>(options: SelectOptions<T>): Promise<T> {
		return select(options, nonTTYIO());
	}

	it("throws NonInteractiveError when stdin is not a TTY", async () => {
		await expect(
			nonTTY({
				message: "Pick",
				choices: ["a", "b", "c"],
			}),
		).rejects.toThrow("interactive terminal");
	});

	it("returns initial value in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Pick",
			choices: ["a", "b", "c"],
			initial: "b",
		});

		expect(result).toBe("b");
	});

	it("returns default value in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Pick",
			choices: ["a", "b", "c"],
			default: "b",
		});

		expect(result).toBe("b");
	});

	it("throws NonInteractiveError when no default or initial in non-TTY", async () => {
		await expect(
			nonTTY({
				message: "Pick",
				choices: ["a", "b", "c"],
			}),
		).rejects.toThrow("interactive terminal");
	});

	it("prefers initial over default in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Pick",
			choices: ["a", "b", "c"],
			initial: "a",
			default: "c",
		});

		expect(result).toBe("a");
	});
});
