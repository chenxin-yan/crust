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

export type { InputOptions } from "./input.ts";
export { input } from "./input.ts";
