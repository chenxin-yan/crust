// ────────────────────────────────────────────────────────────────────────────
// @crustjs/prompts — Interactive terminal prompts for Crust
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type { FuzzyFilterResult, FuzzyMatchResult } from "./fuzzy.ts";
export type {
	Choice,
	PartialPromptTheme,
	PromptTheme,
	ValidateFn,
	ValidateResult,
} from "./types.ts";
export type { NormalizedChoice } from "./utils.ts";

// ────────────────────────────────────────────────────────────────────────────
// Theme
// ────────────────────────────────────────────────────────────────────────────

export { createTheme, defaultTheme, getTheme, setTheme } from "./theme.ts";

// ────────────────────────────────────────────────────────────────────────────
// Renderer
// ────────────────────────────────────────────────────────────────────────────

export type {
	HandleKeyResult,
	KeypressEvent,
	PromptConfig,
	SubmitResult,
} from "./renderer.ts";
export {
	assertTTY,
	CancelledError,
	NonInteractiveError,
	runPrompt,
	SUBMIT,
	submit,
} from "./renderer.ts";

// ────────────────────────────────────────────────────────────────────────────
// Prompts
// ────────────────────────────────────────────────────────────────────────────

export type { ConfirmOptions } from "./confirm.ts";
export { confirm } from "./confirm.ts";
export type { FilterOptions } from "./filter.ts";
export { filter } from "./filter.ts";
export type { InputOptions } from "./input.ts";
export { input } from "./input.ts";
export type { MultiselectOptions } from "./multiselect.ts";
export { multiselect } from "./multiselect.ts";
export type { PasswordOptions } from "./password.ts";
export { password } from "./password.ts";
export type { SelectOptions } from "./select.ts";
export { select } from "./select.ts";
export type { SpinnerOptions, SpinnerType } from "./spinner.ts";
export { spinner } from "./spinner.ts";

// ────────────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────────────

export { fuzzyFilter, fuzzyMatch } from "./fuzzy.ts";
export { calculateScrollOffset, normalizeChoices } from "./utils.ts";
