// ────────────────────────────────────────────────────────────────────────────
// @crustjs/prompts — Interactive terminal prompts for Crust
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type { FuzzyFilterResult, FuzzyMatchResult } from "./core/fuzzy.ts";
export type {
	Choice,
	ChoiceValue,
	PartialPromptTheme,
	PromptTheme,
	ValidateFn,
} from "./core/types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Theme
// ────────────────────────────────────────────────────────────────────────────

export { defaultTheme } from "./core/theme.ts";
export type { CreatePromptsOptions, PromptsInstance } from "./create-prompts.ts";
export { createPrompts } from "./create-prompts.ts";

// ────────────────────────────────────────────────────────────────────────────
// Renderer
// ────────────────────────────────────────────────────────────────────────────

export type {
	HandleKeyResult,
	KeypressEvent,
	PromptConfig,
	PromptIO,
	PromptInput,
	PromptOutput,
	SubmitResult,
} from "./core/renderer.ts";
export {
	assertTTY,
	isTTY,
	NonInteractiveError,
	runPrompt,
	submit,
	withPromptIO,
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
export type { MultifilterOptions } from "./prompts/multifilter.ts";
export { multifilter } from "./prompts/multifilter.ts";
export type { MultiselectOptions } from "./prompts/multiselect.ts";
export { multiselect } from "./prompts/multiselect.ts";
export type { PasswordOptions } from "./prompts/password.ts";
export { password } from "./prompts/password.ts";
export type { SelectOptions } from "./prompts/select.ts";
export { select } from "./prompts/select.ts";

// ────────────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────────────

export { fuzzyFilter, fuzzyMatch } from "./core/fuzzy.ts";
export type { TextEditResult, TextEditState } from "./core/textEdit.ts";
export { handleTextEdit } from "./core/textEdit.ts";
