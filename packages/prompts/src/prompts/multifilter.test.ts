import { describe, expect, it } from "vite-plus/test";

import { renderPrompt } from "../testing.ts";
import { multifilter, type MultifilterOptions } from "./multifilter.ts";
import { nonTTYIO, tick } from "./test-helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Non-TTY behavior
// ────────────────────────────────────────────────────────────────────────────

describe("multifilter — non-TTY", () => {
	function nonTTY<T>(options: MultifilterOptions<T>): Promise<T[]> {
		// No explicit type arg: pins that generic pass-through wrappers still
		// resolve to the generic overload and return Promise<T[]>.
		return multifilter(options, nonTTYIO());
	}

	it("returns default array in non-TTY environment", async () => {
		const result = await nonTTY({
			message: "Search",
			choices: ["a", "b", "c"],
			default: ["b", "c"],
		});

		expect(result).toEqual(["b", "c"]);
	});

	it("checks required, min and max on the default like Enter would", async () => {
		const choices = ["a", "b", "c"];
		await expect(nonTTY<string>({ choices, required: true, default: [] })).rejects.toThrow(
			"default value rejected: At least one item must be selected",
		);
		await expect(nonTTY({ choices, min: 2, default: ["a"] })).rejects.toThrow(
			"default value rejected: Select at least 2 items",
		);
		await expect(nonTTY({ choices, max: 1, initial: ["a", "b"] })).rejects.toThrow(
			"initial value rejected: Select at most 1 item",
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Interactive behavior
// ────────────────────────────────────────────────────────────────────────────

describe("multifilter — interactive", () => {
	it("renders choice hints", async () => {
		const prompt = renderPrompt(multifilter, {
			message: "Search",
			choices: [{ label: "Bun", value: "bun", hint: "recommended" }],
		});

		await tick();
		expect(prompt.screen()).toContain("Bun recommended");

		prompt.keys("return");
		await prompt.answer;
	});

	it("Space toggles selection; Enter submits values in choice order", async () => {
		const prompt = renderPrompt(multifilter, {
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		prompt.keys("down", "space", "up", "space", "return");

		const result = await prompt.answer;
		expect(result).toEqual(["alpha", "beta"]);
	});

	it("toggles the highlighted choice when duplicate choices share a label and value", async () => {
		const value = { id: 1 };
		const prompt = renderPrompt(multifilter, {
			message: "Search",
			choices: [
				{ label: "duplicate", value },
				{ label: "duplicate", value },
			],
		});

		await tick();
		prompt.keys("down", "space");
		await tick();

		const duplicateLines = prompt
			.screen()
			.split("\n")
			.filter((line) => line.includes("duplicate"));
		expect(duplicateLines.map((line) => line.includes("●"))).toEqual([false, true]);

		prompt.keys("return");
		expect(await prompt.answer).toEqual([value]);
	});

	it("pre-selects from default", async () => {
		const prompt = renderPrompt(multifilter, {
			message: "Search",
			choices: ["a", "b", "c"],
			default: ["c"],
		});

		await tick();
		expect(prompt.screen()).toContain("●");
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toEqual(["c"]);
	});

	it("positions the cursor on an undefined default value", async () => {
		const prompt = renderPrompt(multifilter, {
			message: "Search",
			choices: [
				{ label: "first", value: "first" },
				{ label: "unset", value: undefined },
			],
			default: [undefined],
		});

		await tick();
		prompt.keys("space", "return");

		expect(await prompt.answer).toEqual([]);
	});

	it("Enter with required and no selection shows error", async () => {
		const prompt = renderPrompt(multifilter, {
			message: "Search",
			choices: ["x", "y"],
			required: true,
		});

		await tick();
		prompt.keys("return");
		await tick();

		expect(prompt.screen()).toContain("At least one");

		prompt.keys("space", "return");

		const result = await prompt.answer;
		expect(result).toEqual(["x"]);
	});

	it("keeps selections when query filters the list", async () => {
		const prompt = renderPrompt(multifilter, {
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		prompt.keys("down", "down", "space");
		prompt.type("alp");
		await tick();

		expect(prompt.screen()).toContain("alpha");
		expect(prompt.screen()).not.toContain("gamma");
		prompt.keys("return");

		const result = await prompt.answer;
		expect(result).toEqual(["gamma"]);
	});
});
