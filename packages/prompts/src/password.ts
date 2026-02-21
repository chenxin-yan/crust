// ────────────────────────────────────────────────────────────────────────────
// Password — Masked text input prompt for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { KeypressEvent } from "./renderer.ts";
import { runPrompt } from "./renderer.ts";
import { resolveTheme } from "./theme.ts";
import type { PartialPromptTheme, PromptTheme, ValidateFn } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for the {@link password} prompt.
 *
 * @example
 * ```ts
 * const secret = await password({
 *   message: "Enter your password:",
 *   validate: (v) => v.length >= 8 || "Password must be at least 8 characters",
 * });
 * ```
 */
export interface PasswordOptions {
	/** The prompt message displayed to the user */
	readonly message: string;
	/** Character used to mask the input (default: `"*"`) */
	readonly mask?: string;
	/** Validation function — return `true` for valid, or a string error message */
	readonly validate?: ValidateFn<string>;
	/** Initial value — if provided, the prompt is skipped and this value is returned immediately */
	readonly initial?: string;
	/** Per-prompt theme overrides */
	readonly theme?: PartialPromptTheme;
}

// ────────────────────────────────────────────────────────────────────────────
// State (same shape as input)
// ────────────────────────────────────────────────────────────────────────────

interface PasswordState {
	readonly value: string;
	readonly cursorPos: number;
	readonly error: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Keypress handler — reuses input's text-editing logic
// ────────────────────────────────────────────────────────────────────────────

function createHandleKey(
	validate: ValidateFn<string> | undefined,
): (
	key: KeypressEvent,
	state: PasswordState,
) =>
	| PasswordState
	| { readonly submit: string }
	| Promise<PasswordState | { readonly submit: string }> {
	return async (key, state) => {
		// Enter — submit
		if (key.name === "return") {
			if (validate) {
				const result = await validate(state.value);
				if (result !== true) {
					return { ...state, error: result };
				}
			}

			return { submit: state.value };
		}

		// Backspace — delete character before cursor
		if (key.name === "backspace") {
			if (state.cursorPos === 0) return state;
			const before = state.value.slice(0, state.cursorPos - 1);
			const after = state.value.slice(state.cursorPos);
			return {
				value: before + after,
				cursorPos: state.cursorPos - 1,
				error: null,
			};
		}

		// Delete — delete character at cursor
		if (key.name === "delete") {
			if (state.cursorPos >= state.value.length) return state;
			const before = state.value.slice(0, state.cursorPos);
			const after = state.value.slice(state.cursorPos + 1);
			return {
				value: before + after,
				cursorPos: state.cursorPos,
				error: null,
			};
		}

		// Left arrow — move cursor left
		if (key.name === "left") {
			if (state.cursorPos === 0) return state;
			return { ...state, cursorPos: state.cursorPos - 1 };
		}

		// Right arrow — move cursor right
		if (key.name === "right") {
			if (state.cursorPos >= state.value.length) return state;
			return { ...state, cursorPos: state.cursorPos + 1 };
		}

		// Home — jump to start
		if (key.name === "home") {
			return { ...state, cursorPos: 0 };
		}

		// End — jump to end
		if (key.name === "end") {
			return { ...state, cursorPos: state.value.length };
		}

		// Printable character — insert at cursor position
		if (key.char.length === 1 && !key.ctrl && !key.meta) {
			const before = state.value.slice(0, state.cursorPos);
			const after = state.value.slice(state.cursorPos);
			return {
				value: before + key.char + after,
				cursorPos: state.cursorPos + 1,
				error: null,
			};
		}

		return state;
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Render
// ────────────────────────────────────────────────────────────────────────────

const PREFIX_SYMBOL = "?";
const CURSOR_CHAR = "\u2502"; // │ — thin vertical bar as cursor indicator
const SUBMITTED_MASK_LENGTH = 4;

function renderPassword(
	state: PasswordState,
	theme: PromptTheme,
	message: string,
	mask: string,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message);

	let valueLine: string;

	if (state.value === "") {
		// Show cursor when input is empty
		valueLine = theme.cursor(CURSOR_CHAR);
	} else {
		// Show masked value with cursor
		const beforeMask = mask.repeat(state.cursorPos);
		const afterMask = mask.repeat(state.value.length - state.cursorPos);
		valueLine = `${beforeMask}${theme.cursor(CURSOR_CHAR)}${afterMask}`;
	}

	let output = `${prefix} ${msg}\n${valueLine}`;

	// Show error inline below
	if (state.error !== null) {
		output += `\n${theme.error(state.error)}`;
	}

	return output;
}

function renderSubmitted(
	_state: PasswordState,
	_value: string,
	theme: PromptTheme,
	message: string,
	mask: string,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message);
	// Show a fixed number of mask characters regardless of actual length
	const maskedDisplay = theme.success(mask.repeat(SUBMITTED_MASK_LENGTH));
	return `${prefix} ${msg} ${maskedDisplay}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Display an interactive masked password input prompt.
 *
 * Characters are shown as the mask character (default `"*"`) as the user
 * types. After submission, a fixed-length mask is displayed to prevent
 * revealing the password length.
 *
 * Supports validation with inline error display and full cursor editing
 * (insert, delete, arrow keys, home/end).
 *
 * If `initial` is provided, the prompt is skipped and the value is returned
 * immediately — useful for prefilling from CLI flags.
 *
 * @param options - Password prompt configuration
 * @returns The user's entered password
 * @throws {NonInteractiveError} when stdin is not a TTY and no `initial` is provided
 *
 * @example
 * ```ts
 * const secret = await password({
 *   message: "Enter your password:",
 *   validate: (v) => v.length >= 8 || "Password must be at least 8 characters",
 * });
 * ```
 *
 * @example
 * ```ts
 * // Custom mask character
 * const pin = await password({
 *   message: "Enter PIN:",
 *   mask: "●",
 * });
 * ```
 */
export async function password(options: PasswordOptions): Promise<string> {
	// Short-circuit: return initial value immediately without rendering
	if (options.initial !== undefined) {
		return options.initial;
	}

	const theme = resolveTheme(undefined, options.theme);
	const mask = options.mask ?? "*";

	const initialState: PasswordState = {
		value: "",
		cursorPos: 0,
		error: null,
	};

	return runPrompt<PasswordState, string>({
		initialState,
		theme,
		render: (state, t) => renderPassword(state, t, options.message, mask),
		handleKey: createHandleKey(options.validate),
		renderSubmitted: (state, value, t) =>
			renderSubmitted(state, value, t, options.message, mask),
	});
}
