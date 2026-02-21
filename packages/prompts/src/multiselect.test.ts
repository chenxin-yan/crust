import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { multiselect } from "./multiselect.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

const originalIsTTY = process.stdin.isTTY;
const originalSetRawMode = process.stdin.setRawMode;
const originalIsRaw = process.stdin.isRaw;
const originalStderrWrite = process.stderr.write;

let stderrOutput: string;

function setupMocks(): void {
	stderrOutput = "";

	process.stderr.write = ((chunk: string | Uint8Array) => {
		if (typeof chunk === "string") {
			stderrOutput += chunk;
		}
		return true;
	}) as typeof process.stderr.write;

	Object.defineProperty(process.stdin, "isTTY", {
		value: true,
		writable: true,
		configurable: true,
	});

	// biome-ignore lint/suspicious/noExplicitAny: mocking process.stdin methods for testing
	(process.stdin as any).setRawMode = (mode: boolean) => {
		Object.defineProperty(process.stdin, "isRaw", {
			value: mode,
			writable: true,
			configurable: true,
		});
		return process.stdin;
	};
}

function restoreMocks(): void {
	Object.defineProperty(process.stdin, "isTTY", {
		value: originalIsTTY,
		writable: true,
		configurable: true,
	});
	Object.defineProperty(process.stdin, "isRaw", {
		value: originalIsRaw,
		writable: true,
		configurable: true,
	});
	if (originalSetRawMode) {
		process.stdin.setRawMode = originalSetRawMode;
	}
	process.stderr.write = originalStderrWrite;
	process.stdin.removeAllListeners("keypress");
}

/**
 * Emit a keypress event on stdin.
 */
function pressKey(
	char: string,
	key?: Partial<{
		name: string;
		ctrl: boolean;
		meta: boolean;
		shift: boolean;
	}>,
): void {
	process.stdin.emit("keypress", char, {
		name: key?.name ?? char,
		ctrl: key?.ctrl ?? false,
		meta: key?.meta ?? false,
		shift: key?.shift ?? false,
	});
}

/**
 * Wait briefly for async event processing.
 */
function tick(ms = 10): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ────────────────────────────────────────────────────────────────────────────
// Initial value short-circuit
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — initial value", () => {
	it("returns initial value immediately without rendering", async () => {
		const result = await multiselect({
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
			initial: ["cheese", "mushrooms"],
		});

		expect(result).toEqual(["cheese", "mushrooms"]);
	});

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
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("pre-selects items matching default values", async () => {
		const promise = multiselect({
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
		const promise = multiselect({
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual([]);
	});

	it("ignores default values that don't match any choice", async () => {
		const promise = multiselect({
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
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("Space toggles selection on current item", async () => {
		const promise = multiselect({
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
		const promise = multiselect({
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
		const promise = multiselect({
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
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("down arrow moves cursor down", async () => {
		const promise = multiselect({
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
		const promise = multiselect({
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
		const promise = multiselect({
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
		const promise = multiselect({
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
		const promise = multiselect({
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
		const promise = multiselect({
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
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("'a' selects all items when none are selected", async () => {
		const promise = multiselect({
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
		const promise = multiselect({
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
		const promise = multiselect({
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
		const promise = multiselect({
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
		const promise = multiselect({
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
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("required blocks empty submit", async () => {
		const promise = multiselect({
			message: "Select",
			choices: ["a", "b", "c"],
			required: true,
		});

		await tick();
		// Try to submit with nothing selected
		pressKey("", { name: "return" });
		await tick();

		// Error should be shown
		expect(stderrOutput).toContain("At least one item must be selected");

		// Select something and submit
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["a"]);
	});

	it("min validation blocks submit when too few selected", async () => {
		const promise = multiselect({
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
		expect(stderrOutput).toContain("Select at least 2 items");

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
		const promise = multiselect({
			message: "Select",
			choices: ["a", "b", "c"],
			max: 1,
			default: ["a", "b"],
		});

		await tick();
		pressKey("", { name: "return" });
		await tick();

		// Error should be shown
		expect(stderrOutput).toContain("Select at most 1 item");

		// Deselect one and submit
		pressKey(" ", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["b"]);
	});

	it("error clears when user navigates", async () => {
		const promise = multiselect({
			message: "Select",
			choices: ["a", "b", "c"],
			required: true,
		});

		await tick();
		// Submit with nothing — triggers error
		pressKey("", { name: "return" });
		await tick();
		expect(stderrOutput).toContain("At least one item must be selected");

		// Navigate — error should clear
		stderrOutput = "";
		pressKey("", { name: "down" });
		await tick();

		// The error should no longer appear in new output
		expect(stderrOutput).not.toContain("At least one item must be selected");

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
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("renders message on initial display", async () => {
		const promise = multiselect({
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
		});

		await tick();
		expect(stderrOutput).toContain("Select toppings");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders all choices with checkboxes", async () => {
		const promise = multiselect({
			message: "Select",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		expect(stderrOutput).toContain("alpha");
		expect(stderrOutput).toContain("beta");
		expect(stderrOutput).toContain("gamma");
		expect(stderrOutput).toContain("[ ]");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders checked boxes for selected items", async () => {
		const promise = multiselect({
			message: "Select",
			choices: ["alpha", "beta", "gamma"],
			default: ["alpha"],
		});

		await tick();
		expect(stderrOutput).toContain("[x]");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders cursor indicator on active item", async () => {
		const promise = multiselect({
			message: "Select",
			choices: ["alpha", "beta"],
		});

		await tick();
		expect(stderrOutput).toContain(">");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders hint line with keybindings", async () => {
		const promise = multiselect({
			message: "Select",
			choices: ["alpha", "beta"],
		});

		await tick();
		expect(stderrOutput).toContain("Space to toggle");
		expect(stderrOutput).toContain("Enter to confirm");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders submitted answer with comma-separated labels", async () => {
		const promise = multiselect({
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
			default: ["cheese", "mushrooms"],
		});

		await tick();
		pressKey("", { name: "return" });

		await promise;
		// After submit, should show comma-separated labels
		expect(stderrOutput).toContain("cheese, mushrooms");
	});

	it("renders hints for object choices", async () => {
		const promise = multiselect<string>({
			message: "Select features",
			choices: [
				{ label: "TypeScript", value: "ts", hint: "recommended" },
				{ label: "ESLint", value: "eslint" },
			],
		});

		await tick();
		expect(stderrOutput).toContain("recommended");

		pressKey("", { name: "return" });
		await promise;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Viewport scrolling
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — viewport scrolling", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("limits visible choices to maxVisible", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const promise = multiselect({
			message: "Select",
			choices,
			maxVisible: 5,
		});

		await tick();
		expect(stderrOutput).toContain("item-0");
		expect(stderrOutput).toContain("item-4");
		expect(stderrOutput).not.toContain("item-5");

		pressKey("", { name: "return" });
		await promise;
	});

	it("shows scroll-down indicator when more items below", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const promise = multiselect({
			message: "Select",
			choices,
			maxVisible: 5,
		});

		await tick();
		expect(stderrOutput).toContain("...");

		pressKey("", { name: "return" });
		await promise;
	});

	it("scrolls down when navigating past visible items", async () => {
		const choices = Array.from({ length: 10 }, (_, i) => `item-${i}`);
		const promise = multiselect({
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
		expect(stderrOutput).toContain("item-3");

		pressKey("", { name: "return" });
		await promise;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — non-TTY", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("throws NonInteractiveError when stdin is not a TTY", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		await expect(
			multiselect({
				message: "Select",
				choices: ["a", "b", "c"],
			}),
		).rejects.toThrow("interactive terminal");
	});

	it("returns initial value in non-TTY environment", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		const result = await multiselect({
			message: "Select",
			choices: ["a", "b", "c"],
			initial: ["b"],
		});

		expect(result).toEqual(["b"]);
	});
});
