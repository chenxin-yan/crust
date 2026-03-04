// ────────────────────────────────────────────────────────────────────────────
// @crustjs/prompts — Interactive terminal prompts for Crust
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type { FuzzyFilterResult, FuzzyMatchResult } from "./core/fuzzy.ts";
export type {
	Choice,
	PartialPromptTheme,
	PromptTheme,
	ValidateFn,
	ValidateResult,
} from "./core/types.ts";
export type { NormalizedChoice } from "./core/utils.ts";

// ────────────────────────────────────────────────────────────────────────────
// Theme
// ────────────────────────────────────────────────────────────────────────────

export { createTheme, defaultTheme, getTheme, setTheme } from "./core/theme.ts";

// ────────────────────────────────────────────────────────────────────────────
// Renderer
// ────────────────────────────────────────────────────────────────────────────

export type {
	HandleKeyResult,
	KeypressEvent,
	PromptConfig,
	SubmitResult,
} from "./core/renderer.ts";
export {
	assertTTY,
	CancelledError,
	isTTY,
	NonInteractiveError,
	runPrompt,
	submit,
} from "./core/renderer.ts";

// ────────────────────────────────────────────────────────────────────────────
// Prompts
// ────────────────────────────────────────────────────────────────────────────

export type { ConfirmOptions } from "./prompts/confirm.ts";
export { confirm } from "./prompts/confirm.ts";
export type { FilterOptions } from "./prompts/filter.ts";
export { filter } from "./prompts/filter.ts";
export type { InputOptions } from "./prompts/input.ts";
export { input } from "./prompts/input.ts";
export type { MultiselectOptions } from "./prompts/multiselect.ts";
export { multiselect } from "./prompts/multiselect.ts";
export type { PasswordOptions } from "./prompts/password.ts";
export { password } from "./prompts/password.ts";
export type { SelectOptions } from "./prompts/select.ts";
export { select } from "./prompts/select.ts";
export type {
	SpinnerController,
	SpinnerOptions,
	SpinnerType,
} from "./prompts/spinner.ts";
export { spinner } from "./prompts/spinner.ts";

// ────────────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────────────

export { fuzzyFilter, fuzzyMatch } from "./core/fuzzy.ts";
export type { TextEditResult, TextEditState } from "./core/textEdit.ts";
export { CURSOR_CHAR, handleTextEdit } from "./core/textEdit.ts";
export {
	calculateScrollOffset,
	formatPromptLine,
	formatSubmitted,
	normalizeChoices,
} from "./core/utils.ts";
