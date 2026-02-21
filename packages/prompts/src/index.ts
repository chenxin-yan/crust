// ────────────────────────────────────────────────────────────────────────────
// @crustjs/prompts — Interactive terminal prompts for Crust
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

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

export { createTheme, defaultTheme, resolveTheme } from "./theme.ts";

// ────────────────────────────────────────────────────────────────────────────
// Renderer
// ────────────────────────────────────────────────────────────────────────────

export type {
	HandleKeyResult,
	KeypressEvent,
	PromptConfig,
} from "./renderer.ts";
export { assertTTY, NonInteractiveError, runPrompt } from "./renderer.ts";

// ────────────────────────────────────────────────────────────────────────────
// Prompts
// ────────────────────────────────────────────────────────────────────────────

export type { ConfirmOptions } from "./confirm.ts";
export { confirm } from "./confirm.ts";
export type { InputOptions } from "./input.ts";
export { input } from "./input.ts";
export type { MultiselectOptions } from "./multiselect.ts";
export { multiselect } from "./multiselect.ts";
export type { PasswordOptions } from "./password.ts";
export { password } from "./password.ts";
export type { SelectOptions } from "./select.ts";
export { select } from "./select.ts";

// ────────────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────────────

export { normalizeChoices } from "./utils.ts";
