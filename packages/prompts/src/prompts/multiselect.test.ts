import { describe, expect, it } from "bun:test";

import { pressKey, renderPrompt } from "../testing.ts";
import { multiselect, type MultiselectOptions } from "./multiselect.ts";
import { nonTTYIO, tick } from "./test-helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Initial value — object-choice numeric values
// ────────────────────────────────────────────────────────────────────────────

// The non-TTY initial-value test covers string choices; this exercises the
// non-string `initial` codepath.
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
		const prompt = renderPrompt(multiselect, {
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
			default: ["cheese", "mushrooms"],
		});

		await tick();
		// Submit immediately — should return pre-selected items
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["cheese", "mushrooms"]);
	});

	it("returns empty array when no defaults and nothing selected", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
		});

		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual([]);
	});

	it("ignores default values that don't match any choice", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
			default: ["cheese", "nonexistent"],
		});

		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["cheese"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Space toggles selection
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — Space toggle", () => {
	it("Space toggles selection on current item", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		// Toggle first item on
		pressKey(prompt, " ", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["a"]);
	});

	it("Space toggles off a selected item", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
			default: ["a"],
		});

		await tick();
		// Toggle first item off (it was pre-selected)
		pressKey(prompt, " ", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual([]);
	});

	it("can select multiple items", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		// Select first item
		pressKey(prompt, " ", { name: "space" });
		await tick();
		// Move down and select second
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, " ", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["a", "b"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Navigation
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — navigation", () => {
	it("down arrow moves cursor down", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, " ", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["b"]);
	});

	it("up arrow moves cursor up", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		// Move down to b, then up back to a
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "", { name: "up" });
		await tick();
		pressKey(prompt, " ", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["a"]);
	});

	it("j moves cursor down (vim)", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey(prompt, "j", { name: "j" });
		await tick();
		pressKey(prompt, " ", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["b"]);
	});

	it("k moves cursor up (vim)", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "k", { name: "k" });
		await tick();
		pressKey(prompt, " ", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["a"]);
	});

	it("wraps to last item when moving up from first", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey(prompt, "", { name: "up" });
		await tick();
		pressKey(prompt, " ", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["c"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Toggle all and invert
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — toggle all / invert", () => {
	it("'a' selects all items when none are selected", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey(prompt, "a", { name: "a" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["a", "b", "c"]);
	});

	it("'a' deselects all items when all are selected", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
			default: ["a", "b", "c"],
		});

		await tick();
		pressKey(prompt, "a", { name: "a" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual([]);
	});

	it("'a' selects all when some are selected (not all)", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
			default: ["a"],
		});

		await tick();
		pressKey(prompt, "a", { name: "a" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["a", "b", "c"]);
	});

	it("'i' inverts selection", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
			default: ["a"],
		});

		await tick();
		pressKey(prompt, "i", { name: "i" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["b", "c"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — validation", () => {
	it("required blocks empty submit", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
			required: true,
		});

		await tick();
		// Try to submit with nothing selected
		pressKey(prompt, "", { name: "return" });
		await tick();

		// Error should be shown
		expect(prompt.screen()).toContain("At least one item must be selected");

		// Select something and submit
		pressKey(prompt, " ", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["a"]);
	});

	it("min validation blocks submit when too few selected", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
			min: 2,
		});

		await tick();
		// Select only 1 item
		pressKey(prompt, " ", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });
		await tick();

		// Error should be shown
		expect(prompt.screen()).toContain("Select at least 2 items");

		// Select another item and submit
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, " ", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["a", "b"]);
	});

	it("max validation blocks submit when too many selected", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
			max: 1,
			default: ["a", "b"],
		});

		await tick();
		pressKey(prompt, "", { name: "return" });
		await tick();

		// Error should be shown
		expect(prompt.screen()).toContain("Select at most 1 item");

		// Deselect one and submit
		pressKey(prompt, " ", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["b"]);
	});

	it("error clears when user navigates", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
			required: true,
		});

		await tick();
		// Submit with nothing — triggers error
		pressKey(prompt, "", { name: "return" });
		await tick();
		expect(prompt.screen()).toContain("At least one item must be selected");

		// Navigate — error should clear

		pressKey(prompt, "", { name: "down" });
		await tick();

		// The error should no longer appear in new output
		expect(prompt.screen()).not.toContain("At least one item must be selected");

		// Select and submit
		pressKey(prompt, " ", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["b"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — rendering", () => {
	it("renders message on initial display", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
		});

		await tick();
		expect(prompt.screen()).toContain("Select toppings");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});

	it("renders all choices with checkboxes", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		expect(prompt.screen()).toContain("alpha");
		expect(prompt.screen()).toContain("beta");
		expect(prompt.screen()).toContain("gamma");
		expect(prompt.screen()).toContain("○");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});

	it("renders checked boxes for selected items", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["alpha", "beta", "gamma"],
			default: ["alpha"],
		});

		await tick();
		expect(prompt.screen()).toContain("●");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});

	it("renders submitted answer with comma-separated labels", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
			default: ["cheese", "mushrooms"],
		});

		await tick();
		pressKey(prompt, "", { name: "return" });

		await prompt.answer;
		// After submit, should show comma-separated labels
		expect(prompt.screen()).toContain("cheese, mushrooms");
	});

	it("renders hints for object choices", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select features",
			choices: [
				{ label: "TypeScript", value: "ts", hint: "recommended" },
				{ label: "ESLint", value: "eslint" },
			],
		});

		await tick();
		expect(prompt.screen()).toContain("recommended");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Viewport scrolling
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — viewport scrolling", () => {
	it("limits visible choices to maxVisible", async () => {
		const choices = Array.from({ length: 20 }, (_, i) => `item-${i}`);
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices,
			maxVisible: 5,
		});

		await tick();
		expect(prompt.screen()).toContain("item-0");
		expect(prompt.screen()).toContain("item-4");
		expect(prompt.screen()).not.toContain("item-5");

		pressKey(prompt, "", { name: "return" });
		await prompt.answer;
	});

	it("scrolls down when navigating past visible items", async () => {
		const choices = Array.from({ length: 10 }, (_, i) => `item-${i}`);
		const prompt = renderPrompt(multiselect, {
			message: "Select",
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
		await prompt.answer;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — no message", () => {
	it("renders default message when message is omitted", async () => {
		const prompt = renderPrompt(multiselect, {
			choices: ["a", "b", "c"],
		});

		await tick();
		expect(prompt.screen()).toContain("Pick one or more");
		expect(prompt.screen()).not.toContain("undefined");
		expect(prompt.screen()).toContain("a");

		// Select first item and submit
		pressKey(prompt, "", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["a"]);
	});

	it("submitted output shows default message", async () => {
		const prompt = renderPrompt(multiselect, {
			choices: ["a", "b", "c"],
		});

		await tick();
		pressKey(prompt, "", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		await prompt.answer;
		expect(prompt.screen()).toContain("Pick one or more");
		expect(prompt.screen()).not.toContain("undefined");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — non-TTY", () => {
	function nonTTY<T>(options: MultiselectOptions<T>): Promise<T[]> {
		// No explicit type arg: pins that generic pass-through wrappers still
		// resolve to the generic overload and return Promise<T[]>.
		return multiselect(options, nonTTYIO());
	}

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

// ────────────────────────────────────────────────────────────────────────────
// Type-level inference (compile-time only — never executed at runtime)
// ────────────────────────────────────────────────────────────────────────────

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

async function _multiselectTypeInferenceTests() {
	const tags = await multiselect({ message: "?", choices: ["a", "b"] });
	type _TagsNarrow = Expect<Equal<typeof tags, ("a" | "b")[]>>;

	const ports = await multiselect({
		message: "?",
		choices: [
			{ label: "HTTP", value: 80 },
			{ label: "HTTPS", value: 443 },
		],
	});
	type _PortsNarrow = Expect<Equal<typeof ports, (80 | 443)[]>>;

	const widened: string[] = ["a", "b"];
	const loose = await multiselect({ message: "?", choices: widened });
	type _LooseIsStrings = Expect<Equal<typeof loose, string[]>>;
}
void _multiselectTypeInferenceTests;
