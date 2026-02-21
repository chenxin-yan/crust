import { describe, expect, it } from "bun:test";

// ────────────────────────────────────────────────────────────────────────────
// Integration tests — Verify public API surface of @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

// Import everything from the barrel to verify all exports are accessible
import type { PromptTheme } from "../src/index.ts";
import {
	assertTTY,
	// Prompts
	confirm,
	// Theme
	createTheme,
	defaultTheme,
	filter,
	// Utilities
	fuzzyFilter,
	fuzzyMatch,
	input,
	multiselect,
	// Renderer
	NonInteractiveError,
	normalizeChoices,
	password,
	resolveTheme,
	runPrompt,
	select,
	spinner,
} from "../src/index.ts";

// ────────────────────────────────────────────────────────────────────────────
// Export availability
// ────────────────────────────────────────────────────────────────────────────

describe("barrel exports", () => {
	it("exports all prompt functions", () => {
		expect(typeof input).toBe("function");
		expect(typeof password).toBe("function");
		expect(typeof confirm).toBe("function");
		expect(typeof select).toBe("function");
		expect(typeof multiselect).toBe("function");
		expect(typeof filter).toBe("function");
		expect(typeof spinner).toBe("function");
	});

	it("exports theme functions and default theme", () => {
		expect(typeof createTheme).toBe("function");
		expect(typeof resolveTheme).toBe("function");
		expect(defaultTheme).toBeDefined();
		expect(typeof defaultTheme.prefix).toBe("function");
		expect(typeof defaultTheme.message).toBe("function");
		expect(typeof defaultTheme.error).toBe("function");
	});

	it("exports renderer utilities", () => {
		expect(typeof runPrompt).toBe("function");
		expect(typeof assertTTY).toBe("function");
		expect(NonInteractiveError).toBeDefined();
		expect(NonInteractiveError.prototype).toBeInstanceOf(Error);
	});

	it("exports fuzzy matching utilities", () => {
		expect(typeof fuzzyMatch).toBe("function");
		expect(typeof fuzzyFilter).toBe("function");
	});

	it("exports normalizeChoices utility", () => {
		expect(typeof normalizeChoices).toBe("function");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Theme integration
// ────────────────────────────────────────────────────────────────────────────

describe("createTheme integration", () => {
	it("returns a valid theme with all slots defined", () => {
		const theme = createTheme();

		const requiredSlots: (keyof PromptTheme)[] = [
			"prefix",
			"message",
			"placeholder",
			"cursor",
			"selected",
			"unselected",
			"error",
			"success",
			"hint",
			"spinner",
			"filterMatch",
		];

		for (const slot of requiredSlots) {
			expect(theme[slot]).toBeDefined();
			expect(typeof theme[slot]).toBe("function");
		}
	});

	it("returns a theme where every slot produces a string", () => {
		const theme = createTheme();

		for (const key of Object.keys(theme)) {
			const fn = theme[key as keyof PromptTheme];
			const result = fn("test");
			expect(typeof result).toBe("string");
		}
	});

	it("resolveTheme layers overrides correctly", () => {
		const customFn = (text: string) => `[${text}]`;
		const globalFn = (text: string) => `(${text})`;

		const theme = resolveTheme({ prefix: globalFn }, { error: customFn });

		expect(theme.prefix("x")).toBe("(x)");
		expect(theme.error("y")).toBe("[y]");
		// Other slots retain defaults
		expect(theme.message).toBe(defaultTheme.message);
		expect(theme.cursor).toBe(defaultTheme.cursor);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Initial value short-circuit
// ────────────────────────────────────────────────────────────────────────────

describe("initial value short-circuit", () => {
	it("input returns initial value without rendering", async () => {
		const result = await input({ message: "Name?", initial: "Alice" });
		expect(result).toBe("Alice");
	});

	it("password returns initial value without rendering", async () => {
		const result = await password({ message: "Secret?", initial: "s3cret" });
		expect(result).toBe("s3cret");
	});

	it("confirm returns initial value without rendering", async () => {
		const result = await confirm({ message: "Continue?", initial: true });
		expect(result).toBe(true);
	});

	it("confirm returns false initial value", async () => {
		const result = await confirm({ message: "Continue?", initial: false });
		expect(result).toBe(false);
	});

	it("select returns initial value without rendering", async () => {
		const result = await select({
			message: "Pick one",
			choices: ["a", "b", "c"],
			initial: "b",
		});
		expect(result).toBe("b");
	});

	it("multiselect returns initial value without rendering", async () => {
		const result = await multiselect({
			message: "Pick some",
			choices: ["a", "b", "c"],
			initial: ["a", "c"],
		});
		expect(result).toEqual(["a", "c"]);
	});

	it("filter returns initial value without rendering", async () => {
		const result = await filter({
			message: "Search",
			choices: ["apple", "banana", "cherry"],
			initial: "banana",
		});
		expect(result).toBe("banana");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Utility integration
// ────────────────────────────────────────────────────────────────────────────

describe("normalizeChoices integration", () => {
	it("normalizes string choices", () => {
		const choices = normalizeChoices(["a", "b", "c"]);
		expect(choices).toEqual([
			{ label: "a", value: "a" },
			{ label: "b", value: "b" },
			{ label: "c", value: "c" },
		]);
	});

	it("normalizes object choices with hints", () => {
		const choices = normalizeChoices([
			{ label: "One", value: 1, hint: "first" },
			{ label: "Two", value: 2 },
		]);
		expect(choices).toEqual([
			{ label: "One", value: 1, hint: "first" },
			{ label: "Two", value: 2 },
		]);
	});
});

describe("fuzzy matching integration", () => {
	it("fuzzyMatch finds character-in-order matches", () => {
		const result = fuzzyMatch("abc", "aXbXc");
		expect(result.match).toBe(true);
		expect(result.indices).toEqual([0, 2, 4]);
	});

	it("fuzzyMatch rejects out-of-order queries", () => {
		const result = fuzzyMatch("cba", "abc");
		expect(result.match).toBe(false);
	});

	it("fuzzyFilter returns sorted results", () => {
		const items = [
			{ label: "banana", value: "banana" },
			{ label: "bar", value: "bar" },
			{ label: "xyz", value: "xyz" },
		];
		const results = fuzzyFilter("ba", items);

		// "bar" and "banana" should match, "xyz" should not
		expect(results.length).toBe(2);
		for (const r of results) {
			expect(["bar", "banana"]).toContain(r.item.label);
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// NonInteractiveError
// ────────────────────────────────────────────────────────────────────────────

describe("NonInteractiveError", () => {
	it("is an instance of Error", () => {
		const err = new NonInteractiveError("test");
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(NonInteractiveError);
		expect(err.message).toBe("test");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Type exports — compile-time verification
// ────────────────────────────────────────────────────────────────────────────
//
// These type annotations verify that all public type exports are importable
// and resolve correctly. If any type is removed from the barrel, this file
// will fail to compile.

import type {
	Choice,
	ConfirmOptions,
	FilterOptions,
	FuzzyFilterResult,
	FuzzyMatchResult,
	HandleKeyResult,
	InputOptions,
	KeypressEvent,
	MultiselectOptions,
	NormalizedChoice,
	PartialPromptTheme,
	PasswordOptions,
	PromptConfig,
	SelectOptions,
	SpinnerOptions,
	SpinnerType,
	ValidateFn,
	ValidateResult,
} from "../src/index.ts";

describe("type exports", () => {
	it("all type exports are importable and resolve correctly", () => {
		// Verify type exports resolve by using them in type annotations.
		// These assignments are never executed at runtime but ensure the types
		// compile correctly. The `as` casts are intentional — they only need
		// to type-check, not produce real values.
		const _choice: Choice<string> = "test";
		const _inputOpts: InputOptions = { message: "m" };
		const _passwordOpts: PasswordOptions = { message: "m" };
		const _confirmOpts: ConfirmOptions = { message: "m" };
		const _selectOpts: SelectOptions<string> = {
			message: "m",
			choices: ["a"],
		};
		const _multiselectOpts: MultiselectOptions<string> = {
			message: "m",
			choices: ["a"],
		};
		const _filterOpts: FilterOptions<string> = {
			message: "m",
			choices: ["a"],
		};
		const _spinnerOpts: SpinnerOptions<string> = {
			message: "m",
			task: async () => "done",
		};
		const _spinnerType: SpinnerType = "dots";
		const _validateResult: ValidateResult = true;
		const _validateFn: ValidateFn<string> = () => true;
		const _partialTheme: PartialPromptTheme = {};
		const _normalized: NormalizedChoice<string> = {
			label: "a",
			value: "a",
		};
		const _fuzzyMatch: FuzzyMatchResult = {
			match: true,
			score: 1,
			indices: [0],
		};
		const _fuzzyFilter: FuzzyFilterResult<string> = {
			item: { label: "a", value: "a" },
			score: 1,
			indices: [0],
		};
		const _keypress: KeypressEvent = {
			char: "a",
			name: "a",
			ctrl: false,
			meta: false,
			shift: false,
		};

		// HandleKeyResult and PromptConfig are generic interfaces — verify they
		// accept type parameters
		type _HKR = HandleKeyResult<{ value: string }, string>;
		type _PC = PromptConfig<{ value: string }, string>;

		// All type annotations above compiled successfully
		expect(true).toBe(true);
	});
});
