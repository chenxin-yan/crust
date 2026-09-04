import { describe, expect, it } from "bun:test";

import { pressKey, renderPrompt } from "../testing.ts";
import { filter, type FilterOptions } from "./filter.ts";
import { nonTTYIO, tick } from "./test-helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Initial value — object-choice numeric value
// ────────────────────────────────────────────────────────────────────────────

// The non-TTY initial-value test covers string choices; this exercises the
// non-string `initial` codepath.
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
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
			default: "Rust",
		});

		await tick();
		// Submit immediately — should select "Rust" (cursor at matching index)
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("Rust");
	});

	it("defaults cursor to first item when no default is provided", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
		});

		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("TypeScript");
	});

	it("defaults cursor to first item when default value is not found", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
			default: "Python",
		});

		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("TypeScript");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Filtering behavior
// ────────────────────────────────────────────────────────────────────────────

describe("filter — typing filters the list", () => {
	it("empty query shows all items", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
		});

		await tick();
		expect(prompt.screen()).toContain("TypeScript");
		expect(prompt.screen()).toContain("JavaScript");
		expect(prompt.screen()).toContain("Rust");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});

	it("typing a character filters the results", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust", "Python", "Go"],
		});

		await tick();
		// Type "py" to filter
		pressKey(prompt, "p", { name: "p" });
		await tick();
		pressKey(prompt, "y", { name: "y" });
		await tick();

		// "Python" should be visible, "Go" should not
		expect(prompt.screen()).toContain("Python");

		pressKey(prompt, "", { name: "return" });
		const result = await prompt.answer;
		expect(result).toBe("Python");
	});

	it("shows 'No matches' when nothing matches the query", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
		});

		await tick();
		// Type something that won't match anything
		pressKey(prompt, "z", { name: "z" });
		await tick();
		pressKey(prompt, "z", { name: "z" });
		await tick();
		pressKey(prompt, "z", { name: "z" });
		await tick();

		expect(prompt.screen()).toContain("No matches");

		// Backspace to clear and get matches again, then submit
		pressKey(prompt, "", { name: "backspace" });
		await tick();
		pressKey(prompt, "", { name: "backspace" });
		await tick();
		pressKey(prompt, "", { name: "backspace" });
		await tick();
		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Navigation
// ────────────────────────────────────────────────────────────────────────────

describe("filter — navigation", () => {
	it("down arrow moves to next result", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("beta");
	});

	it("up arrow moves to previous result", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "", { name: "up" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("beta");
	});

	it("wraps to last item when moving up from first", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		pressKey(prompt, "", { name: "up" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("gamma");
	});

	it("ignores navigation when no results", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["alpha", "beta"],
		});

		await tick();
		// Type something that won't match
		pressKey(prompt, "z", { name: "z" });
		await tick();
		pressKey(prompt, "z", { name: "z" });
		await tick();
		pressKey(prompt, "z", { name: "z" });
		await tick();

		// Navigation should be ignored (no crash)
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "", { name: "up" });
		await tick();

		// Clear query and submit
		pressKey(prompt, "", { name: "backspace" });
		await tick();
		pressKey(prompt, "", { name: "backspace" });
		await tick();
		pressKey(prompt, "", { name: "backspace" });
		await tick();
		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Text editing in query
// ────────────────────────────────────────────────────────────────────────────

describe("filter — query editing", () => {
	it("left/right arrow moves cursor in query", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["abc", "xyz"],
		});

		await tick();
		// Type "ac"
		pressKey(prompt, "a", { name: "a" });
		await tick();
		pressKey(prompt, "c", { name: "c" });
		await tick();

		// Move cursor left and insert "b" to make "abc"
		pressKey(prompt, "", { name: "left" });
		await tick();
		pressKey(prompt, "b", { name: "b" });
		await tick();

		// "abc" should now match
		pressKey(prompt, "", { name: "return" });
		const result = await prompt.answer;
		expect(result).toBe("abc");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

describe("filter — rendering", () => {
	it("renders message on initial display", async () => {
		const prompt = renderPrompt(filter, {
			message: "Find a language",
			choices: ["TypeScript", "JavaScript"],
		});

		await tick();
		expect(prompt.screen()).toContain("Find a language");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});

	it("renders placeholder when query is empty", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["TypeScript"],
			placeholder: "Type to filter...",
		});

		await tick();
		expect(prompt.screen()).toContain("Type to filter...");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});

	it("renders submitted answer on confirm", async () => {
		const prompt = renderPrompt(filter, {
			message: "Pick a fruit",
			choices: ["apple", "banana", "cherry"],
		});

		await tick();
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		await prompt.answer;
		expect(prompt.screen()).toContain("banana");
	});

	it("renders labels for object choices", async () => {
		const prompt = renderPrompt(filter, {
			message: "Pick",
			choices: [
				{ label: "Option A", value: 1 },
				{ label: "Option B", value: 2 },
			],
		});

		await tick();
		expect(prompt.screen()).toContain("Option A");
		expect(prompt.screen()).toContain("Option B");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Viewport scrolling
// ────────────────────────────────────────────────────────────────────────────

describe("filter — viewport scrolling", () => {
	it("limits visible results to maxVisible", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices,
			maxVisible: 5,
		});

		await tick();
		// Only first 5 items should be visible
		expect(prompt.screen()).toContain("item-0");
		expect(prompt.screen()).toContain("item-4");
		expect(prompt.screen()).not.toContain("item-5");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});

	it("scrolls down when navigating past visible items", async () => {
		const choices = Array.from({ length: 10 }, (_, i) => `item-${i}`);
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices,
			maxVisible: 3,
		});

		await tick();
		// Move down 3 times to scroll past the initial viewport
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "", { name: "down" });
		await tick();

		// item-3 should now be visible
		expect(prompt.screen()).toContain("item-3");

		pressKey(prompt, "", { name: "return" });
		const result = await prompt.answer;
		expect(result).toBe("item-3");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("filter — no message", () => {
	it("renders default message when message is omitted", async () => {
		const prompt = renderPrompt(filter, {
			choices: ["apple", "banana", "cherry"],
		});

		await tick();
		expect(prompt.screen()).toContain("Search and select");
		expect(prompt.screen()).not.toContain("undefined");
		expect(prompt.screen()).toContain("apple");

		pressKey(prompt, "", { name: "return" });
		const result = await prompt.answer;
		expect(result).toBe("apple");
	});

	it("submitted output shows default message", async () => {
		const prompt = renderPrompt(filter, {
			choices: ["apple", "banana", "cherry"],
		});

		await tick();
		pressKey(prompt, "", { name: "return" });

		await prompt.answer;
		expect(prompt.screen()).toContain("Search and select");
		expect(prompt.screen()).not.toContain("undefined");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("filter — non-TTY", () => {
	function nonTTY<T>(options: FilterOptions<T>): Promise<T> {
		// No explicit type arg: pins that generic pass-through wrappers still
		// resolve to the generic overload and return Promise<T>.
		return filter(options, nonTTYIO());
	}

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

	const port = await filter({
		message: "?",
		choices: [
			{ label: "HTTP", value: 80 },
			{ label: "HTTPS", value: 443 },
		],
	});
	type _PortNarrows = Expect<Equal<typeof port, 80 | 443>>;

	const widened: string[] = ["a", "b"];
	const loose = await filter({ message: "?", choices: widened });
	type _LooseIsString = Expect<Equal<typeof loose, string>>;
}
void _filterTypeInferenceTests;
