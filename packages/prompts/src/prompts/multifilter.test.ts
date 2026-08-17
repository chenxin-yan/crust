import { describe, expect, it } from "bun:test";

import { createPromptIO, renderPrompt, type RenderedPrompt } from "../testing.ts";
import { multifilter, type MultifilterOptions } from "./multifilter.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

let activePrompt: Pick<RenderedPrompt<unknown>, "type" | "keys" | "screen">;

function start<T>(options: MultifilterOptions<T>): Promise<T[]> {
	const prompt = renderPrompt<MultifilterOptions<T>, T[]>(multifilter, options);
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
		const promise = start({
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		pressKey("", { name: "space" });
		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["alpha", "beta"]);
	});

	it("pre-selects from default", async () => {
		const promise = start({
			message: "Search",
			choices: ["a", "b", "c"],
			default: ["c"],
		});

		await tick();
		expect(screen()).toContain("●");
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["c"]);
	});

	it("Enter with required and no selection shows error", async () => {
		const promise = start({
			message: "Search",
			choices: ["x", "y"],
			required: true,
		});

		await tick();
		pressKey("", { name: "return" });
		await tick();

		expect(screen()).toContain("At least one");

		pressKey("", { name: "space" });
		await tick();
		pressKey("", { name: "return" });

		const result = await promise;
		expect(result).toEqual(["x"]);
	});

	it("keeps selections when query filters the list", async () => {
		const promise = start({
			message: "Search",
			choices: ["alpha", "beta", "gamma"],
		});

		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "down" });
		await tick();
		pressKey("", { name: "space" });
		await tick();
		pressKey("g", { name: "g" });
		await tick();
		pressKey("a", { name: "a" });
		await tick();
		pressKey("m", { name: "m" });
		await tick();

		expect(screen()).toContain("gamma");
		pressKey("", { name: "return" });

		const result = await promise;
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
