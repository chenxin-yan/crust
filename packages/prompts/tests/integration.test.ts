import { afterEach, describe, expect, it } from "bun:test";
// ────────────────────────────────────────────────────────────────────────────
// Integration tests — exercise @crustjs/prompts through its public barrel
// ────────────────────────────────────────────────────────────────────────────

import type { PromptTheme } from "../src/index.ts";
import {
	// Prompts
	confirm,
	// Theme
	defaultTheme,
	filter,
	// Utilities
	fuzzyFilter,
	fuzzyMatch,
	getTheme,
	input,
	multifilter,
	multiselect,
	// Renderer
	NonInteractiveError,
	normalizeChoices,
	password,
	select,
	setTheme,
} from "../src/index.ts";

// ────────────────────────────────────────────────────────────────────────────
// Theme integration
// ────────────────────────────────────────────────────────────────────────────

describe("theme integration", () => {
	it("getTheme returns a valid theme with all slots defined", () => {
		const theme = getTheme();

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
			"filterMatch",
		];

		for (const slot of requiredSlots) {
			expect(theme[slot]).toBeDefined();
			expect(typeof theme[slot]).toBe("function");
		}
	});

	it("every theme slot produces a string", () => {
		const theme = getTheme();

		for (const key of Object.keys(theme)) {
			const fn = theme[key as keyof PromptTheme];
			const result = fn("test");
			expect(typeof result).toBe("string");
		}
	});

	afterEach(() => {
		setTheme();
	});

	it("setTheme applies global overrides via getTheme", () => {
		const globalFn = (text: string) => `(${text})`;
		setTheme({ prefix: globalFn });

		const theme = getTheme();

		expect(theme.prefix("x")).toBe("(x)");
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

	it("multifilter returns initial value without rendering", async () => {
		const result = await multifilter({
			message: "Search",
			choices: ["apple", "banana", "cherry"],
			initial: ["banana", "apple"],
		});
		expect(result).toEqual(["banana", "apple"]);
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
		// `config` scores higher than `abc` because the match lands at the
		// start of the string (START_BONUS). `xyz` does not match at all.
		const items = [
			{ label: "abc", value: "abc" },
			{ label: "config", value: "config" },
			{ label: "xyz", value: "xyz" },
		];
		const results = fuzzyFilter("c", items);

		expect(results.length).toBe(2);
		expect(results[0]?.item.label).toBe("config");
		expect(results[1]?.item.label).toBe("abc");
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
	MultifilterOptions,
	MultiselectOptions,
	NormalizedChoice,
	PartialPromptTheme,
	PasswordOptions,
	PromptConfig,
	SelectOptions,
	ValidateFn,
} from "../src/index.ts";

describe("type exports", () => {
	it("all type exports are importable and resolve correctly", () => {
		// Verify type exports resolve by using them in type annotations.
		// These assignments are never executed at runtime but ensure the types
		// compile correctly. The `as` casts are intentional — they only need
		// to type-check, not produce real values.
		const _choice: Choice<string> = "test";
		const _inputOpts: InputOptions = { message: "m" };
		const _inputOptsNoMsg: InputOptions = {};
		const _passwordOpts: PasswordOptions = { message: "m" };
		const _passwordOptsNoMsg: PasswordOptions = {};
		const _confirmOpts: ConfirmOptions = { message: "m" };
		const _confirmOptsNoMsg: ConfirmOptions = {};
		const _selectOpts: SelectOptions<string> = {
			message: "m",
			choices: ["a"],
		};
		const _selectOptsNoMsg: SelectOptions<string> = {
			choices: ["a"],
		};
		const _multiselectOpts: MultiselectOptions<string> = {
			message: "m",
			choices: ["a"],
		};
		const _multiselectOptsNoMsg: MultiselectOptions<string> = {
			choices: ["a"],
		};
		const _filterOpts: FilterOptions<string> = {
			message: "m",
			choices: ["a"],
		};
		const _filterOptsNoMsg: FilterOptions<string> = {
			choices: ["a"],
		};
		const _filterMultipleOpts: FilterOptions<string> = {
			message: "m",
			// @ts-expect-error `filter` no longer supports multi-select mode
			multiple: true,
			choices: ["a"],
		};
		const _multifilterOpts: MultifilterOptions<string> = {
			message: "m",
			choices: ["a"],
		};
		const _multifilterOptsNoMsg: MultifilterOptions<string> = {
			choices: ["a"],
		};
		// ValidateFn<T> is throw-on-fail / void-on-success.
		const _validateFn: ValidateFn<string> = () => {};
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
