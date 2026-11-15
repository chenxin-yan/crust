import { describe, expect, it } from "vite-plus/test";

import { SCROLL_INDICATOR } from "../core/symbols.ts";
import { renderPrompt } from "../testing.ts";
import { multiselect, type MultiselectOptions } from "./multiselect.ts";
import { nonTTYIO, tick } from "./test-helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Default pre-selection
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — default value", () => {
	it("positions the cursor on the first default value", async () => {
		const prompt = renderPrompt(multiselect, {
			message: "Select toppings",
			choices: ["cheese", "pepperoni", "mushrooms"],
			default: ["mushrooms"],
		});

		await tick();
		prompt.keys("space", "return");

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
// Navigation
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — navigation", () => {
	it.each([
		["j moves cursor down (vim)", ["j"], ["b"]],
		["k moves cursor up (vim)", ["down", "k"], ["a"]],
	])("%s", async (_title, keys, expected) => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
		});

		await tick();
		prompt.keys(...keys, "space", "return");

		expect(await prompt.answer).toEqual(expected);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Toggle all and invert
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — toggle all / invert", () => {
	it.each([
		["'a' selects all items when none are selected", {}, ["a"], ["a", "b", "c"]],
		["'a' deselects all items when all are selected", { default: ["a", "b", "c"] }, ["a"], []],
		[
			"'a' deselects all items when max is reached",
			{ choices: ["a", "b", "c", "d"], max: 2 },
			["a", "a"],
			[],
		],
		["'i' inverts selection", { default: ["a"] }, ["i"], ["b", "c"]],
	])("%s", async (_title, options: Partial<MultiselectOptions<string>>, keys, expected) => {
		const prompt = renderPrompt(multiselect, {
			message: "Select",
			choices: ["a", "b", "c"],
			...options,
		});

		await tick();
		prompt.keys(...keys, "return");

		expect(await prompt.answer).toEqual(expected);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

describe("multiselect — validation", () => {
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
		prompt.keys("space", "return");
		await tick();

		expect(prompt.screen()).toContain("Select at least 2 items");

		prompt.keys("down", "space", "return");

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

		expect(prompt.screen()).toContain("Select at most 1 item");

		prompt.keys("space", "return");

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
		prompt.keys("return");
		await tick();
		expect(prompt.screen()).toContain("At least one item must be selected");

		prompt.keys("down");
		await tick();
		expect(prompt.screen()).not.toContain("At least one item must be selected");

		prompt.keys("space", "return");

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

		prompt.keys("space", "return");

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
