import { describe, expect, it } from "bun:test";

import { createPrompts } from "../create-prompts.ts";
import { pressKey, renderPrompt } from "../testing.ts";
import { select, type SelectOptions } from "./select.ts";
import { nonTTYIO, tick } from "./test-helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Initial value — object-choice numeric value
// ────────────────────────────────────────────────────────────────────────────

// The non-TTY initial-value test covers string choices; this exercises the
// non-string `initial` codepath.
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
		const prompt = renderPrompt(select, {
			message: "Pick a color",
			choices: ["red", "green", "blue"],
			default: "green",
		});

		await tick();
		// Submit immediately — should select "green" (cursor at index 1)
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("green");
	});

	it("defaults cursor to first item when no default is provided", async () => {
		const prompt = renderPrompt(select, {
			message: "Pick a color",
			choices: ["red", "green", "blue"],
		});

		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("red");
	});

	it("defaults cursor to first item when default value is not found", async () => {
		const prompt = renderPrompt(select, {
			message: "Pick a color",
			choices: ["red", "green", "blue"],
			default: "yellow",
		});

		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("red");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Arrow key navigation
// ────────────────────────────────────────────────────────────────────────────

describe("select — navigation", () => {
	it("down arrow moves cursor down", async () => {
		const prompt = renderPrompt(select, {
			message: "Pick",
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("b");
	});

	it("up arrow moves cursor up", async () => {
		const prompt = renderPrompt(select, {
			message: "Pick",
			choices: ["a", "b", "c"],
			default: "b",
		});

		await tick();
		pressKey(prompt, "", { name: "up" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("a");
	});

	it("j moves cursor down (vim)", async () => {
		const prompt = renderPrompt(select, {
			message: "Pick",
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey(prompt, "j", { name: "j" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("b");
	});

	it("k moves cursor up (vim)", async () => {
		const prompt = renderPrompt(select, {
			message: "Pick",
			choices: ["a", "b", "c"],
			default: "c",
		});

		await tick();
		pressKey(prompt, "k", { name: "k" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("b");
	});

	it("wraps to last item when moving up from first", async () => {
		const prompt = renderPrompt(select, {
			message: "Pick",
			choices: ["a", "b", "c"],
		});

		await tick();
		// Cursor at 0, up should wrap to index 2
		pressKey(prompt, "", { name: "up" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe("c");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Choice normalization
// ────────────────────────────────────────────────────────────────────────────

describe("select — choice types", () => {
	it("handles object choices with label and value", async () => {
		const prompt = renderPrompt(select, {
			message: "Pick a port",
			choices: [
				{ label: "HTTP", value: 80 },
				{ label: "HTTPS", value: 443 },
			],
		});

		await tick();
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toBe(443);
	});

	it("handles object choices with hints", async () => {
		const prompt = renderPrompt(select, {
			message: "Pick a port",
			choices: [
				{ label: "HTTP", value: 80 },
				{ label: "HTTPS", value: 443, hint: "recommended" },
			],
		});

		await tick();
		// Verify hint text is rendered
		expect(prompt.screen()).toContain("recommended");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

describe("select — rendering", () => {
	it("renders message on initial display", async () => {
		const prompt = renderPrompt(select, {
			message: "Choose your favorite",
			choices: ["apple", "banana", "cherry"],
		});

		await tick();
		expect(prompt.screen()).toContain("Choose your favorite");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});

	it("renders all visible choices", async () => {
		const prompt = renderPrompt(select, {
			message: "Pick",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		expect(prompt.screen()).toContain("alpha");
		expect(prompt.screen()).toContain("beta");
		expect(prompt.screen()).toContain("gamma");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});

	it("renders submitted answer on confirm", async () => {
		const prompt = renderPrompt(select, {
			message: "Pick a fruit",
			choices: ["apple", "banana", "cherry"],
		});

		await tick();
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		await prompt.answer;
		// After submit, the selected label should appear in the output
		expect(prompt.screen()).toContain("banana");
	});

	it("renders labels for object choices", async () => {
		const prompt = renderPrompt(select, {
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

describe("select — viewport scrolling", () => {
	it("limits visible choices to maxVisible", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const prompt = renderPrompt(select, {
			message: "Pick",
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

	it("shows scroll-down indicator when more items below", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const prompt = renderPrompt(select, {
			message: "Pick",
			choices,
			maxVisible: 5,
		});

		await tick();
		expect(prompt.screen()).toContain("...");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});

	it("scrolls down when navigating past visible items", async () => {
		const choices = Array.from({ length: 10 }, (_, i) => `item-${i}`);
		const prompt = renderPrompt(select, {
			message: "Pick",
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

	it("does not show scroll indicators when all items fit", async () => {
		const prompt = renderPrompt(select, {
			message: "Pick",
			choices: ["a", "b", "c"],
			maxVisible: 10,
		});

		await tick();
		// With only 3 items and maxVisible=10, no scroll indicators
		// Count "..." occurrences — should not appear as a scroll indicator line
		const lines = prompt.screen().split("\n");
		const scrollLines = lines.filter((l) => l.trim() === "...");
		expect(scrollLines.length).toBe(0);

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("select — no message", () => {
	it("renders default message when message is omitted", async () => {
		const prompt = renderPrompt(select, {
			choices: ["a", "b", "c"],
		});

		await tick();
		expect(prompt.screen()).toContain("Pick an option");
		expect(prompt.screen()).not.toContain("undefined");
		expect(prompt.screen()).toContain("a");

		pressKey(prompt, "", { name: "return" });
		const result = await prompt.answer;
		expect(result).toBe("a");
	});

	it("submitted output shows default message", async () => {
		const prompt = renderPrompt(select, {
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey(prompt, "", { name: "return" });

		await prompt.answer;
		expect(prompt.screen()).toContain("Pick an option");
		expect(prompt.screen()).not.toContain("undefined");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("select — non-TTY", () => {
	function nonTTY<T>(options: SelectOptions<T>): Promise<T> {
		// No explicit type arg: pins that generic pass-through wrappers still
		// resolve to the generic overload and return Promise<T>.
		return select(options, nonTTYIO());
	}

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

// ────────────────────────────────────────────────────────────────────────────
// Type-level inference (compile-time only — never executed at runtime)
// ────────────────────────────────────────────────────────────────────────────

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

async function _selectTypeInferenceTests() {
	// Literal string choices narrow to the literal union via `const T`.
	const env = await select({ message: "?", choices: ["dev", "staging", "prod"] });
	type _EnvNarrows = Expect<Equal<typeof env, "dev" | "staging" | "prod">>;

	// Object choices narrow on their literal `value`s.
	const port = await select({
		message: "?",
		choices: [
			{ label: "HTTP", value: 80 },
			{ label: "HTTPS", value: 443 },
		],
	});
	type _PortNarrows = Expect<Equal<typeof port, 80 | 443>>;

	// A widened string[] variable keeps plain string.
	const widened: string[] = ["a", "b"];
	const loose = await select({ message: "?", choices: widened });
	type _LooseIsString = Expect<Equal<typeof loose, string>>;

	// An explicit type argument still resolves to the generic overload.
	const explicit = await select<number>({
		message: "?",
		choices: [{ label: "HTTP", value: 80 }],
	});
	type _ExplicitWins = Expect<Equal<typeof explicit, number>>;

	// createPrompts instances pass narrowing through (`typeof select`).
	const p = createPrompts();
	const themed = await p.select({ message: "?", choices: ["a", "b"] });
	type _ThemedNarrows = Expect<Equal<typeof themed, "a" | "b">>;
}
void _selectTypeInferenceTests;
