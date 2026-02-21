import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { filter } from "./filter.ts";

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

describe("filter — initial value", () => {
	it("returns initial value immediately without rendering", async () => {
		const result = await filter({
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
			initial: "Rust",
		});

		expect(result).toBe("Rust");
	});

	it("returns initial value for object choices", async () => {
		const result = await filter<number>({
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
// Filtering behavior
// ────────────────────────────────────────────────────────────────────────────

describe("filter — typing filters the list", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("empty query shows all items", async () => {
		const promise = filter({
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
		});

		await tick();
		expect(stderrOutput).toContain("TypeScript");
		expect(stderrOutput).toContain("JavaScript");
		expect(stderrOutput).toContain("Rust");

		pressKey("", { name: "return" });
		await promise;
	});

	it("typing a character filters the results", async () => {
		const promise = filter({
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust", "Python", "Go"],
		});

		await tick();
		// Type "py" to filter
		pressKey("p", { name: "p" });
		await tick();
		pressKey("y", { name: "y" });
		await tick();

		// "Python" should be visible, "Go" should not
		expect(stderrOutput).toContain("Python");

		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe("Python");
	});

	it("backspace removes filter character and re-filters", async () => {
		const promise = filter({
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
		});

		await tick();
		// Type "ru" to filter to Rust
		pressKey("r", { name: "r" });
		await tick();
		pressKey("u", { name: "u" });
		await tick();

		// Now backspace to widen the filter
		pressKey("", { name: "backspace" });
		await tick();

		// With just "r", more items may match
		// Submit to get current selection
		pressKey("", { name: "return" });
		await promise;
	});

	it("shows 'No matches' when nothing matches the query", async () => {
		const promise = filter({
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
		});

		await tick();
		// Type something that won't match anything
		pressKey("z", { name: "z" });
		await tick();
		pressKey("z", { name: "z" });
		await tick();
		pressKey("z", { name: "z" });
		await tick();

		expect(stderrOutput).toContain("No matches");

		// Backspace to clear and get matches again, then submit
		pressKey("", { name: "backspace" });
		await tick();
		pressKey("", { name: "backspace" });
		await tick();
		pressKey("", { name: "backspace" });
		await tick();
		pressKey("", { name: "return" });
		await promise;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Navigation
// ────────────────────────────────────────────────────────────────────────────

describe("filter — navigation", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("down arrow moves to next result", async () => {
		const promise = filter({
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("beta");
	});

	it("up arrow moves to previous result", async () => {
		const promise = filter({
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "up" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("beta");
	});

	it("wraps to last item when moving up from first", async () => {
		const promise = filter({
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		pressKey("", { name: "up" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("gamma");
	});

	it("wraps to first item when moving down from last", async () => {
		const promise = filter({
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		// Move to last (down 2 times), then one more to wrap
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("alpha");
	});

	it("Enter selects the highlighted result", async () => {
		const promise = filter({
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("gamma");
	});

	it("ignores navigation when no results", async () => {
		const promise = filter({
			message: "Search",
			choices: ["alpha", "beta"],
		});

		await tick();
		// Type something that won't match
		pressKey("z", { name: "z" });
		await tick();
		pressKey("z", { name: "z" });
		await tick();
		pressKey("z", { name: "z" });
		await tick();

		// Navigation should be ignored (no crash)
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "up" });
		await tick();

		// Clear query and submit
		pressKey("", { name: "backspace" });
		await tick();
		pressKey("", { name: "backspace" });
		await tick();
		pressKey("", { name: "backspace" });
		await tick();
		pressKey("", { name: "return" });
		await promise;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Text editing in query
// ────────────────────────────────────────────────────────────────────────────

describe("filter — query editing", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("left/right arrow moves cursor in query", async () => {
		const promise = filter({
			message: "Search",
			choices: ["abc", "xyz"],
		});

		await tick();
		// Type "ac"
		pressKey("a", { name: "a" });
		await tick();
		pressKey("c", { name: "c" });
		await tick();

		// Move cursor left and insert "b" to make "abc"
		pressKey("", { name: "left" });
		await tick();
		pressKey("b", { name: "b" });
		await tick();

		// "abc" should now match
		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe("abc");
	});

	it("delete key removes character at cursor", async () => {
		const promise = filter({
			message: "Search",
			choices: ["ab", "cd"],
		});

		await tick();
		// Type "axb"
		pressKey("a", { name: "a" });
		await tick();
		pressKey("x", { name: "x" });
		await tick();
		pressKey("b", { name: "b" });
		await tick();

		// Move left twice to position cursor at "x", then delete
		pressKey("", { name: "left" });
		await tick();
		pressKey("", { name: "left" });
		await tick();
		pressKey("", { name: "delete" });
		await tick();

		// Query should now be "ab"
		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe("ab");
	});

	it("home/end keys move cursor to start/end", async () => {
		const promise = filter({
			message: "Search",
			choices: ["xab", "other"],
		});

		await tick();
		// Type "ab"
		pressKey("a", { name: "a" });
		await tick();
		pressKey("b", { name: "b" });
		await tick();

		// Home, then insert "x" at start to make "xab"
		pressKey("", { name: "home" });
		await tick();
		pressKey("x", { name: "x" });
		await tick();

		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe("xab");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

describe("filter — rendering", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("renders message on initial display", async () => {
		const promise = filter({
			message: "Find a language",
			choices: ["TypeScript", "JavaScript"],
		});

		await tick();
		expect(stderrOutput).toContain("Find a language");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders placeholder when query is empty", async () => {
		const promise = filter({
			message: "Search",
			choices: ["TypeScript"],
			placeholder: "Type to filter...",
		});

		await tick();
		expect(stderrOutput).toContain("Type to filter...");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders all choices initially", async () => {
		const promise = filter({
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		expect(stderrOutput).toContain("alpha");
		expect(stderrOutput).toContain("beta");
		expect(stderrOutput).toContain("gamma");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders cursor indicator on active result", async () => {
		const promise = filter({
			message: "Search",
			choices: ["alpha", "beta"],
		});

		await tick();
		expect(stderrOutput).toContain(">");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders submitted answer on confirm", async () => {
		const promise = filter({
			message: "Pick a fruit",
			choices: ["apple", "banana", "cherry"],
		});

		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "return" });

		await promise;
		expect(stderrOutput).toContain("banana");
	});

	it("renders labels for object choices", async () => {
		const promise = filter<number>({
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

describe("filter — viewport scrolling", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("limits visible results to maxVisible", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const promise = filter({
			message: "Search",
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

	it("shows scroll indicator when more items below", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const promise = filter({
			message: "Search",
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
		const promise = filter({
			message: "Search",
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
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("filter — non-TTY", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("throws NonInteractiveError when stdin is not a TTY", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		await expect(
			filter({
				message: "Search",
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

		const result = await filter({
			message: "Search",
			choices: ["a", "b", "c"],
			initial: "b",
		});

		expect(result).toBe("b");
	});
});
