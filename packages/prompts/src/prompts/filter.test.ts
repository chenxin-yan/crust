import { describe, expect, it } from "bun:test";

import { createPromptIO, renderPrompt, type RenderedPrompt } from "../testing.ts";
import { filter, type FilterOptions } from "./filter.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

let activePrompt: Pick<RenderedPrompt<unknown>, "type" | "keys" | "screen">;

function start<T>(options: FilterOptions<T>): Promise<T> {
	const prompt = renderPrompt<FilterOptions<T>, T>(filter, options);
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
describe("filter — initial value", () => {
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
// Default value cursor positioning
// ────────────────────────────────────────────────────────────────────────────

describe("filter — default value", () => {
	it("sets initial cursor to matching default value", async () => {
		const promise = start({
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
			default: "Rust",
		});

		await tick();
		// Submit immediately — should select "Rust" (cursor at matching index)
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("Rust");
	});

	it("defaults cursor to first item when no default is provided", async () => {
		const promise = start({
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("TypeScript");
	});

	it("defaults cursor to first item when default value is not found", async () => {
		const promise = start({
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
			default: "Python",
		});

		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toBe("TypeScript");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Filtering behavior
// ────────────────────────────────────────────────────────────────────────────

describe("filter — typing filters the list", () => {
	it("empty query shows all items", async () => {
		const promise = start({
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
		});

		await tick();
		expect(screen()).toContain("TypeScript");
		expect(screen()).toContain("JavaScript");
		expect(screen()).toContain("Rust");

		pressKey("", { name: "return" });
		await promise;
	});

	it("typing a character filters the results", async () => {
		const promise = start({
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
		expect(screen()).toContain("Python");

		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe("Python");
	});

	it("backspace removes filter character and re-filters", async () => {
		const promise = start({
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
		const promise = start({
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

		expect(screen()).toContain("No matches");

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
	it("down arrow moves to next result", async () => {
		const promise = start({
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
		const promise = start({
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
		const promise = start({
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
		const promise = start({
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
		const promise = start({
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
		const promise = start({
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
	it("left/right arrow moves cursor in query", async () => {
		const promise = start({
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
		const promise = start({
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
		const promise = start({
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
	it("renders message on initial display", async () => {
		const promise = start({
			message: "Find a language",
			choices: ["TypeScript", "JavaScript"],
		});

		await tick();
		expect(screen()).toContain("Find a language");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders placeholder when query is empty", async () => {
		const promise = start({
			message: "Search",
			choices: ["TypeScript"],
			placeholder: "Type to filter...",
		});

		await tick();
		expect(screen()).toContain("Type to filter...");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders all choices initially", async () => {
		const promise = start({
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		expect(screen()).toContain("alpha");
		expect(screen()).toContain("beta");
		expect(screen()).toContain("gamma");

		pressKey("", { name: "return" });
		await promise;
	});

	it("renders cursor indicator on active result", async () => {
		const promise = start({
			message: "Search",
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

describe("filter — viewport scrolling", () => {
	it("limits visible results to maxVisible", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const promise = start({
			message: "Search",
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

	it("shows scroll indicator when more items below", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const promise = start({
			message: "Search",
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
		expect(screen()).toContain("item-3");

		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe("item-3");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("filter — no message", () => {
	it("renders default message when message is omitted", async () => {
		const promise = start({
			choices: ["apple", "banana", "cherry"],
		});

		await tick();
		expect(screen()).toContain("Search and select");
		expect(screen()).not.toContain("undefined");
		expect(screen()).toContain("apple");

		pressKey("", { name: "return" });
		const result = await promise;
		expect(result).toBe("apple");
	});

	it("submitted output shows default message", async () => {
		const promise = start({
			choices: ["apple", "banana", "cherry"],
		});

		await tick();
		pressKey("", { name: "return" });

		await promise;
		expect(screen()).toContain("Search and select");
		expect(screen()).not.toContain("undefined");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("filter — non-TTY", () => {
	function nonTTY<T>(options: FilterOptions<T>): Promise<T> {
		return filter<T>(options, nonTTYIO());
	}

	it("throws NonInteractiveError when stdin is not a TTY", async () => {
		await expect(
			nonTTY({
				message: "Search",
				choices: ["a", "b", "c"],
			}),
		).rejects.toThrow("interactive terminal");
	});

	it("returns initial value in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Search",
			choices: ["a", "b", "c"],
			initial: "b",
		});

		expect(result).toBe("b");
	});

	it("returns default value in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Search",
			choices: ["a", "b", "c"],
			default: "b",
		});

		expect(result).toBe("b");
	});

	it("throws NonInteractiveError when no default or initial in non-TTY", async () => {
		await expect(
			nonTTY({
				message: "Search",
				choices: ["a", "b", "c"],
			}),
		).rejects.toThrow("interactive terminal");
	});

	it("prefers initial over default in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Search",
			choices: ["a", "b", "c"],
			initial: "a",
			default: "c",
		});

		expect(result).toBe("a");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Type-level inference (compile-time only — never executed at runtime)
// ────────────────────────────────────────────────────────────────────────────

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

async function _filterTypeInferenceTests() {
	const pick = await filter({ message: "?", choices: ["prettier", "eslint"] });
	type _PickNarrows = Expect<Equal<typeof pick, "prettier" | "eslint">>;
}
void _filterTypeInferenceTests;
