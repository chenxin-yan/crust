import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { select } from "./select.ts";

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

describe("select — initial value", () => {
	it("returns initial value immediately without rendering", async () => {
		const result = await select({
			message: "Pick a color",
			choices: ["red", "green", "blue"],
			initial: "green",
		});

		expect(result).toBe("green");
	});

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
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("sets initial cursor to matching default value", async () => {
		const promise = select({
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
		const promise = select({
			message: "Pick a color",
			choices: ["red", "green", "blue"],
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("red");
	});

	it("defaults cursor to first item when default value is not found", async () => {
		const promise = select({
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
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("down arrow moves cursor down", async () => {
		const promise = select({
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
		const promise = select({
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
		const promise = select({
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
		const promise = select({
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
		const promise = select({
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
		const promise = select({
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
		const promise = select({
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
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("handles string choices correctly", async () => {
		const promise = select({
			message: "Pick a color",
			choices: ["red", "green", "blue"],
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("red");
	});

	it("handles object choices with label and value", async () => {
		const promise = select<number>({
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
		const promise = select<number>({
			message: "Pick a port",
			choices: [
				{ label: "HTTP", value: 80 },
				{ label: "HTTPS", value: 443, hint: "recommended" },
			],
		});

		await tick();
		// Verify hint text is rendered
		expect(stderrOutput).toContain("recommended");

		pressKey("", { name: "return" });
		await promise;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

describe("select — rendering", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("renders message on initial display", async () => {
		const promise = select({
			message: "Choose your favorite",
			choices: ["apple", "banana", "cherry"],
		});

		await tick();
		expect(stderrOutput).toContain("Choose your favorite");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders all visible choices", async () => {
		const promise = select({
			message: "Pick",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		expect(stderrOutput).toContain("alpha");
		expect(stderrOutput).toContain("beta");
		expect(stderrOutput).toContain("gamma");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders cursor indicator on active item", async () => {
		const promise = select({
			message: "Pick",
			choices: ["alpha", "beta"],
		});

		await tick();
		expect(stderrOutput).toContain(">");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders submitted answer on confirm", async () => {
		const promise = select({
			message: "Pick a fruit",
			choices: ["apple", "banana", "cherry"],
		});

		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "return" });

		await promise;
		// After submit, the selected label should appear in the output
		expect(stderrOutput).toContain("banana");
	});

	it("renders labels for object choices", async () => {
		const promise = select<number>({
			message: "Pick",
			choices: [
				{ label: "Option A", value: 1 },
				{ label: "Option B", value: 2 },
			],
		});

		await tick();
		expect(stderrOutput).toContain("Option A");
		expect(stderrOutput).toContain("Option B");

		pressKey("", { name: "return" });
		await promise;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Viewport scrolling
// ────────────────────────────────────────────────────────────────────────────

describe("select — viewport scrolling", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("limits visible choices to maxVisible", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const promise = select({
			message: "Pick",
			choices,
			maxVisible: 5,
		});

		await tick();
		// Only first 5 items should be visible
		expect(stderrOutput).toContain("item-0");
		expect(stderrOutput).toContain("item-4");
		expect(stderrOutput).not.toContain("item-5");

		pressKey("", { name: "return" });
		await promise;
	});

	it("shows scroll-down indicator when more items below", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const promise = select({
			message: "Pick",
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
		const promise = select({
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
		expect(stderrOutput).toContain("item-3");

		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe("item-3");
	});

	it("does not show scroll indicators when all items fit", async () => {
		const promise = select({
			message: "Pick",
			choices: ["a", "b", "c"],
			maxVisible: 10,
		});

		await tick();
		// With only 3 items and maxVisible=10, no scroll indicators
		// Count "..." occurrences — should not appear as a scroll indicator line
		const lines = stderrOutput.split("\n");
		const scrollLines = lines.filter((l) => l.trim() === "...");
		expect(scrollLines.length).toBe(0);

		pressKey("", { name: "return" });
		await promise;
	});

	it("wrapping from last item scrolls viewport back to top", async () => {
		const choices = Array.from({ length: 10 }, (_, i) => `item-${i}`);
		const promise = select({
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
		expect(stderrOutput).toContain("item-0");

		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe("item-0");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("select — non-TTY", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("throws NonInteractiveError when stdin is not a TTY", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		await expect(
			select({
				message: "Pick",
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

		const result = await select({
			message: "Pick",
			choices: ["a", "b", "c"],
			initial: "b",
		});

		expect(result).toBe("b");
	});
});
