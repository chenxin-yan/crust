import { describe, expect, it } from "bun:test";

import { createPromptIO, renderPrompt, type RenderedPrompt } from "../testing.ts";
import { multiselect, type MultiselectOptions } from "./multiselect.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

let activePrompt: Pick<RenderedPrompt<unknown>, "type" | "keys" | "screen">;

function start<T>(options: MultiselectOptions<T>): Promise<T[]> {
	const prompt = renderPrompt<MultiselectOptions<T>, T[]>(multiselect, options);
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
// Initial value — object-choice numeric values
// ────────────────────────────────────────────────────────────────────────────

// String-choice happy-path is in tests/integration.test.ts; this exercises the
// non-string `initial` codepath that integration does not cover.
describe("multiselect — initial value", () => {
	it("returns initial value for object choices", async () => {
		const result = await multiselect<number>({
			message: "Select ports",
			choices: [
				{ label: "HTTP", value: 80 },
				{ label: "HTTPS", value: 443 },
			],
			initial: [443],
		});

		expect(result).toEqual([443]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Default pre-selection
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — default value", () => {
	it("pre-selects items matching default values", async () => {
		const promise = start({
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
			default: ["cheese", "mushrooms"],
		});

		await tick();
		// Submit immediately — should return pre-selected items
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["cheese", "mushrooms"]);
	});

	it("returns empty array when no defaults and nothing selected", async () => {
		const promise = start({
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual([]);
	});

	it("ignores default values that don't match any choice", async () => {
		const promise = start({
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
			default: ["cheese", "nonexistent"],
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["cheese"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Space toggles selection
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — Space toggle", () => {
	it("Space toggles selection on current item", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		// Toggle first item on
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["a"]);
	});

	it("Space toggles off a selected item", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
			default: ["a"],
		});

		await tick();
		// Toggle first item off (it was pre-selected)
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual([]);
	});

	it("can select multiple items", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		// Select first item
		pressKey(" ", { name: "space" });
		await tick();
		// Move down and select second
		pressKey("", { name: "down" });
		await tick();
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["a", "b"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Navigation
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — navigation", () => {
	it("down arrow moves cursor down", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["b"]);
	});

	it("up arrow moves cursor up", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		// Move down to b, then up back to a
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "up" });
		await tick();
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["a"]);
	});

	it("j moves cursor down (vim)", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey("j", { name: "j" });
		await tick();
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["b"]);
	});

	it("k moves cursor up (vim)", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("k", { name: "k" });
		await tick();
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["a"]);
	});

	it("wraps to last item when moving up from first", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey("", { name: "up" });
		await tick();
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["c"]);
	});

	it("wraps to first item when moving down from last", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		// Move to last item (down, down)
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "down" });
		await tick();
		// Wrap to first
		pressKey("", { name: "down" });
		await tick();
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["a"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Toggle all and invert
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — toggle all / invert", () => {
	it("'a' selects all items when none are selected", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey("a", { name: "a" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["a", "b", "c"]);
	});

	it("'a' deselects all items when all are selected", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
			default: ["a", "b", "c"],
		});

		await tick();
		pressKey("a", { name: "a" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual([]);
	});

	it("'a' selects all when some are selected (not all)", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
			default: ["a"],
		});

		await tick();
		pressKey("a", { name: "a" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["a", "b", "c"]);
	});

	it("'i' inverts selection", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
			default: ["a"],
		});

		await tick();
		pressKey("i", { name: "i" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["b", "c"]);
	});

	it("'i' inverts from all selected to none", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
			default: ["a", "b", "c"],
		});

		await tick();
		pressKey("i", { name: "i" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual([]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — validation", () => {
	it("required blocks empty submit", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
			required: true,
		});

		await tick();
		// Try to submit with nothing selected
		pressKey("", { name: "return" });
		await tick();

		// Error should be shown
		expect(screen()).toContain("At least one item must be selected");

		// Select something and submit
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["a"]);
	});

	it("min validation blocks submit when too few selected", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
			min: 2,
		});

		await tick();
		// Select only 1 item
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });
		await tick();

		// Error should be shown
		expect(screen()).toContain("Select at least 2 items");

		// Select another item and submit
		pressKey("", { name: "down" });
		await tick();
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["a", "b"]);
	});

	it("max validation blocks submit when too many selected", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
			max: 1,
			default: ["a", "b"],
		});

		await tick();
		pressKey("", { name: "return" });
		await tick();

		// Error should be shown
		expect(screen()).toContain("Select at most 1 item");

		// Deselect one and submit
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["b"]);
	});

	it("error clears when user navigates", async () => {
		const promise = start({
			message: "Select",
			choices: ["a", "b", "c"],
			required: true,
		});

		await tick();
		// Submit with nothing — triggers error
		pressKey("", { name: "return" });
		await tick();
		expect(screen()).toContain("At least one item must be selected");

		// Navigate — error should clear

		pressKey("", { name: "down" });
		await tick();

		// The error should no longer appear in new output
		expect(screen()).not.toContain("At least one item must be selected");

		// Select and submit
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["b"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — rendering", () => {
	it("renders message on initial display", async () => {
		const promise = start({
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
		});

		await tick();
		expect(screen()).toContain("Select toppings");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders all choices with checkboxes", async () => {
		const promise = start({
			message: "Select",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		expect(screen()).toContain("alpha");
		expect(screen()).toContain("beta");
		expect(screen()).toContain("gamma");
		expect(screen()).toContain("○");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders checked boxes for selected items", async () => {
		const promise = start({
			message: "Select",
			choices: ["alpha", "beta", "gamma"],
			default: ["alpha"],
		});

		await tick();
		expect(screen()).toContain("●");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders cursor indicator on active item", async () => {
		const promise = start({
			message: "Select",
			choices: ["alpha", "beta"],
		});

		await tick();
		expect(screen()).toContain("›");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders hint line with keybindings", async () => {
		const promise = start({
			message: "Select",
			choices: ["alpha", "beta"],
		});

		await tick();
		expect(screen()).toContain("Space to toggle");
		expect(screen()).toContain("Enter to confirm");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders submitted answer with comma-separated labels", async () => {
		const promise = start({
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
			default: ["cheese", "mushrooms"],
		});

		await tick();
		pressKey("", { name: "return" });

		await promise;
		// After submit, should show comma-separated labels
		expect(screen()).toContain("cheese, mushrooms");
	});

	it("renders hints for object choices", async () => {
		const promise = start({
			message: "Select features",
			choices: [
				{ label: "TypeScript", value: "ts", hint: "recommended" },
				{ label: "ESLint", value: "eslint" },
			],
		});

		await tick();
		expect(screen()).toContain("recommended");

		pressKey("", { name: "return" });
		await promise;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Viewport scrolling
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — viewport scrolling", () => {
	it("limits visible choices to maxVisible", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const promise = start({
			message: "Select",
			choices,
			maxVisible: 5,
		});

		await tick();
		expect(screen()).toContain("item-0");
		expect(screen()).toContain("item-4");
		expect(screen()).not.toContain("item-5");

		pressKey("", { name: "return" });
		await promise;
	});

	it("shows scroll-down indicator when more items below", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const promise = start({
			message: "Select",
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
			message: "Select",
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
		await promise;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — no message", () => {
	it("renders default message when message is omitted", async () => {
		const promise = start({
			choices: ["a", "b", "c"],
		});

		await tick();
		expect(screen()).toContain("Pick one or more");
		expect(screen()).not.toContain("undefined");
		expect(screen()).toContain("a");

		// Select first item and submit
		pressKey("", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["a"]);
	});

	it("submitted output shows default message", async () => {
		const promise = start({
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey("", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		await promise;
		expect(screen()).toContain("Pick one or more");
		expect(screen()).not.toContain("undefined");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — non-TTY", () => {
	function nonTTY<T>(options: MultiselectOptions<T>): Promise<T[]> {
		return multiselect(options, nonTTYIO());
	}

	it("throws NonInteractiveError when stdin is not a TTY", async () => {
		await expect(
			nonTTY({
				message: "Select",
				choices: ["a", "b", "c"],
			}),
		).rejects.toThrow("interactive terminal");
	});

	it("returns initial value in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Select",
			choices: ["a", "b", "c"],
			initial: ["b"],
		});

		expect(result).toEqual(["b"]);
	});

	it("returns default values in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Select",
			choices: ["a", "b", "c"],
			default: ["a", "c"],
		});

		expect(result).toEqual(["a", "c"]);
	});

	it("throws NonInteractiveError when no default or initial in non-TTY", async () => {
		await expect(
			nonTTY({
				message: "Select",
				choices: ["a", "b", "c"],
			}),
		).rejects.toThrow("interactive terminal");
	});

	it("prefers initial over default in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Select",
			choices: ["a", "b", "c"],
			initial: ["a"],
			default: ["b", "c"],
		});

		expect(result).toEqual(["a"]);
	});
});
