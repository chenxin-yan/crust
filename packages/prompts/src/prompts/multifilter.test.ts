import { describe, expect, it } from "bun:test";

import { pressKey, renderPrompt } from "../testing.ts";
import { multifilter, type MultifilterOptions } from "./multifilter.ts";
import { nonTTYIO, tick } from "./test-helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Initial/default short-circuits
// ────────────────────────────────────────────────────────────────────────────

describe("multifilter — initial / default", () => {
	it("returns initial array immediately without rendering", async () => {
		const result = await multifilter({
			message: "Search",
			choices: ["TypeScript", "JavaScript", "Rust"],
			initial: ["Rust", "JavaScript"],
		});

		expect(result).toEqual(["Rust", "JavaScript"]);
	});
});

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
			initial: ["a"],
			default: ["c"],
		});

		expect(result).toEqual(["a"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Interactive behavior
// ────────────────────────────────────────────────────────────────────────────

describe("multifilter — interactive", () => {
	it("Space toggles selection; Enter submits values in choice order", async () => {
		const prompt = renderPrompt(multifilter, {
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		pressKey(prompt, "", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

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
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "", { name: "space" });
		await tick();

		const duplicateLines = prompt
			.screen()
			.split("\n")
			.filter((line) => line.includes("duplicate"));
		expect(duplicateLines.map((line) => line.includes("●"))).toEqual([false, true]);

		pressKey(prompt, "", { name: "return" });
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
		pressKey(prompt, "", { name: "return" });

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
		pressKey(prompt, "", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		expect(await prompt.answer).toEqual([]);
	});

	it("Enter with required and no selection shows error", async () => {
		const prompt = renderPrompt(multifilter, {
			message: "Search",
			choices: ["x", "y"],
			required: true,
		});

		await tick();
		pressKey(prompt, "", { name: "return" });
		await tick();

		expect(prompt.screen()).toContain("At least one");

		pressKey(prompt, "", { name: "space" });
		await tick();
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["x"]);
	});

	it("keeps selections when query filters the list", async () => {
		const prompt = renderPrompt(multifilter, {
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "", { name: "down" });
		await tick();
		pressKey(prompt, "", { name: "space" });
		await tick();
		pressKey(prompt, "g", { name: "g" });
		await tick();
		pressKey(prompt, "a", { name: "a" });
		await tick();
		pressKey(prompt, "m", { name: "m" });
		await tick();

		expect(prompt.screen()).toContain("gamma");
		pressKey(prompt, "", { name: "return" });

		const result = await prompt.answer;
		expect(result).toEqual(["gamma"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Type-level inference (compile-time only — never executed at runtime)
// ────────────────────────────────────────────────────────────────────────────

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

async function _multifilterTypeInferenceTests() {
	const picks = await multifilter({ message: "?", choices: ["a", "b"] });
	type _PicksNarrow = Expect<Equal<typeof picks, ("a" | "b")[]>>;

	const ports = await multifilter({
		message: "?",
		choices: [
			{ label: "HTTP", value: 80 },
			{ label: "HTTPS", value: 443 },
		],
	});
	type _PortsNarrow = Expect<Equal<typeof ports, (80 | 443)[]>>;

	const widened: string[] = ["a", "b"];
	const loose = await multifilter({ message: "?", choices: widened });
	type _LooseIsStrings = Expect<Equal<typeof loose, string[]>>;
}
void _multifilterTypeInferenceTests;
