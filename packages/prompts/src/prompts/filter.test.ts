import { describe, expect, it } from "vite-plus/test";

import { renderPrompt } from "../testing.ts";
import { filter, type FilterOptions } from "./filter.ts";
import { nonTTYIO, tick } from "./test-helpers.ts";

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
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("Rust");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Filtering behavior
// ────────────────────────────────────────────────────────────────────────────

describe("filter — typing filters the list", () => {
	it("typing a character filters the results", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust", "Python", "Go"],
		});

		await tick();
		prompt.type("py");
		await tick();

		// "Python" should be visible, "Go" should not
		expect(prompt.screen()).toContain("Python");
		expect(prompt.screen()).not.toContain("Go");

		prompt.keys("return");
		const result = await prompt.answer;
		expect(result).toBe("Python");
	});

	it("shows 'No matches' when nothing matches the query", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
		});

		await tick();
		prompt.type("zzz");
		await tick();

		expect(prompt.screen()).toContain("No matches");

		// Clear the query so Enter has a match to submit.
		prompt.keys("backspace", "backspace", "backspace", "return");
		await prompt.answer;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Navigation
// ────────────────────────────────────────────────────────────────────────────

describe("filter — navigation", () => {
	it("wraps to last item when moving up from first", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		prompt.keys("up");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toBe("gamma");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Text editing in query
// ────────────────────────────────────────────────────────────────────────────

describe("filter — query editing", () => {
	it("inserts typed text at the query cursor after moving left", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["abc", "xyz"],
		});

		await tick();
		prompt.keys("a", "c", "left", "b", "return");

		expect(await prompt.answer).toBe("abc");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

describe("filter — rendering", () => {
	it("renders placeholder when query is empty", async () => {
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices: ["TypeScript"],
			placeholder: "Type to filter...",
		});

		await tick();
		expect(prompt.screen()).toContain("Type to filter...");

		prompt.keys("return");
		await prompt.answer;
	});

	it("renders submitted answer on confirm", async () => {
		const prompt = renderPrompt(filter, {
			message: "Pick a fruit",
			choices: ["apple", "banana", "cherry"],
		});

		await tick();
		prompt.keys("down", "return");

		await prompt.answer;
		expect(prompt.screen()).toBe("✓ Pick a fruit banana");
	});

	it("renders choice hints", async () => {
		const prompt = renderPrompt(filter, {
			message: "Pick",
			choices: [{ label: "Bun", value: "bun", hint: "recommended" }],
		});

		await tick();
		expect(prompt.screen()).toContain("Bun recommended");

		prompt.keys("return");
		await prompt.answer;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Viewport scrolling
// ────────────────────────────────────────────────────────────────────────────

describe("filter — viewport scrolling", () => {
	it("scrolls down when navigating past visible items", async () => {
		const choices = Array.from({ length: 10 }, (_, i) => `item-${i}`);
		const prompt = renderPrompt(filter, {
			message: "Search",
			choices,
			maxVisible: 3,
		});

		await tick();
		prompt.keys("down", "down", "down");
		await tick();

		expect(prompt.screen()).toContain("item-3");

		prompt.keys("return");
		const result = await prompt.answer;
		expect(result).toBe("item-3");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("filter — no message", () => {
	it("renders default message before and after submission", async () => {
		const prompt = renderPrompt(filter, {
			choices: ["apple", "banana", "cherry"],
		});

		await tick();
		expect(prompt.screen()).toContain("Search and select");
		expect(prompt.screen()).not.toContain("undefined");
		expect(prompt.screen()).toContain("apple");

		prompt.keys("return");
		const result = await prompt.answer;
		expect(result).toBe("apple");
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

	it("returns default value in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Search",
			choices: ["a", "b", "c"],
			default: "b",
		});

		expect(result).toBe("b");
	});
});
