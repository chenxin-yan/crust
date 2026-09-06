import { describe, expect, it } from "bun:test";
// ────────────────────────────────────────────────────────────────────────────
// Integration tests — exercise @crustjs/prompts through its public barrel
// ────────────────────────────────────────────────────────────────────────────

import type { StandardSchema } from "@crustjs/utils/schema";
// ────────────────────────────────────────────────────────────────────────────
// Type exports — compile-time verification
// ────────────────────────────────────────────────────────────────────────────
//
// These type annotations verify that all public type exports are importable
// and resolve correctly. If any type is removed from the barrel, this file
// will fail to compile.

import { createPrompts, fuzzyFilter } from "../src/index.ts";
import type {
	Choice,
	ConfirmOptions,
	CreatePromptsOptions,
	FilterOptions,
	FuzzyFilterResult,
	FuzzyMatchResult,
	HandleKeyResult,
	InputOptions,
	KeypressEvent,
	MultifilterOptions,
	MultiselectOptions,
	PartialPromptTheme,
	PasswordOptions,
	PromptConfig,
	PromptsInstance,
	SelectOptions,
	ValidateFn,
} from "../src/index.ts";

describe("fuzzy matching integration", () => {
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

// Compile-time regression checks; intentionally never invoked.
// all type exports are importable and resolve correctly
function _typecheckAllTypeExportsAreImportableAndResolveCorrectly() {
	// Verify type exports resolve by using them in type annotations.
	// These assignments are never executed at runtime but ensure the types
	// compile correctly.
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

	// Factory types resolve, and bound prompts preserve the bare-export
	// overloads: schema-aware input infers the schema output type.
	const _createOpts: CreatePromptsOptions = { theme: {} };
	const p: PromptsInstance = createPrompts();
	const numberSchema: StandardSchema<unknown, number> = {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: () => ({ value: 1 }),
		},
	};
	const assertInput = (): Promise<number> => p.input({ message: "m", schema: numberSchema });
	const assertInputPlain = (): Promise<string> => p.input({ message: "m" });
	void assertInput;
	void assertInputPlain;
	void _createOpts;
}
