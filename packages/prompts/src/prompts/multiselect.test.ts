import { describe, expect, it } from "vite-plus/test";

import { SCROLL_INDICATOR } from "../core/symbols.ts";
import { renderPrompt } from "../testing.ts";
import { multiselect, type MultiselectOptions } from "./multiselect.ts";
import { nonTTYIO, tick } from "./test-helpers.ts";

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
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toEqual(["cheese", "mushrooms"]);
	});

	it("positions the cursor on the first default value", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
			default: ["mushrooms"],
		});

		await tick();
		prompt.keys("space");
		await tick();
		prompt.keys("return");

		expect(await prompt.answer).toEqual([]);
	});

	it("ignores default values that don't match any choice", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
			default: ["cheese", "nonexistent"],
		});

		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toEqual(["cheese"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Space toggles selection
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — Space toggle", () => {
	it("Space toggles off a selected item", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
			default: ["a"],
		});

		await tick();
		// Toggle first item off (it was pre-selected)
		prompt.type(" ");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toEqual([]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Navigation
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — navigation", () => {
	it("j moves cursor down (vim)", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		prompt.type("j");
		await tick();
		prompt.type(" ");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toEqual(["b"]);
	});

	it("k moves cursor up (vim)", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		prompt.keys("down");
		await tick();
		prompt.type("k");
		await tick();
		prompt.type(" ");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toEqual(["a"]);
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
		prompt.type("a");
		await tick();
		prompt.keys("return");

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
		prompt.type("a");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toEqual([]);
	});

	it("'i' inverts selection", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
			default: ["a"],
		});

		await tick();
		prompt.type("i");
		await tick();
		prompt.keys("return");

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
		prompt.keys("return");
		await tick();

		// Error should be shown
		expect(prompt.screen()).toContain("At least one item must be selected");

		// Select something and submit
		prompt.type(" ");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toEqual(["a"]);
	});

	for (const [name, constraint, error] of [
		["required", { required: true }, "At least one item must be selected"],
		["min", { min: 1 }, "Select at least 1 item"],
	] as const) {
		for (const navigation of [[], ["up"]] as const) {
			it(`${name} blocks submit of empty choices after ${[...navigation, "space"].join(" ")}`, async () => {
				const options: MultiselectOptions<string> = {
					message: "Select",
					choices: [],
					...constraint,
				};
				const prompt = renderPrompt(multiselect, options);

				await tick();
				prompt.keys(...navigation);
				prompt.type(" ");
				await tick();
				prompt.keys("return");
				await tick();

				expect(prompt.screen()).toContain(error);
				expect(prompt.screen()).not.toContain(SCROLL_INDICATOR);
				prompt.keys("ctrl+c");
				await expect(prompt.answer).rejects.toMatchObject({ name: "AbortError" });
			});
		}
	}

	it("min validation blocks submit when too few selected", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
			min: 2,
		});

		await tick();
		// Select only 1 item
		prompt.type(" ");
		await tick();
		prompt.keys("return");
		await tick();

		// Error should be shown
		expect(prompt.screen()).toContain("Select at least 2 items");

		// Select another item and submit
		prompt.keys("down");
		await tick();
		prompt.type(" ");
		await tick();
		prompt.keys("return");

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
		prompt.keys("return");
		await tick();

		// Error should be shown
		expect(prompt.screen()).toContain("Select at most 1 item");

		// Deselect one and submit
		prompt.type(" ");
		await tick();
		prompt.keys("return");

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
		prompt.keys("return");
		await tick();
		expect(prompt.screen()).toContain("At least one item must be selected");

		// Navigate — error should clear

		prompt.keys("down");
		await tick();

		// The error should no longer appear in new output
		expect(prompt.screen()).not.toContain("At least one item must be selected");

		// Select and submit
		prompt.type(" ");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toEqual(["b"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — rendering", () => {
	it("renders submitted answer with comma-separated labels", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
			default: ["cheese", "mushrooms"],
		});

		await tick();
		prompt.keys("return");

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

		prompt.keys("return");
		await prompt.answer;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// No message
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — no message", () => {
	it("renders default message before and after submission", async () => {
		const prompt = renderPrompt(multiselect, {
			choices: ["a", "b", "c"],
		});

		await tick();
		expect(prompt.screen()).toContain("Pick one or more");
		expect(prompt.screen()).not.toContain("undefined");
		expect(prompt.screen()).toContain("a");

		// Select first item and submit
		prompt.keys("space");
		await tick();
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toEqual(["a"]);
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

	it("returns default values in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Select",
			choices: ["a", "b", "c"],
			default: ["a", "c"],
		});

		expect(result).toEqual(["a", "c"]);
	});
});
