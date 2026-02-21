// ────────────────────────────────────────────────────────────────────────────
// Input — Single-line text input prompt for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { KeypressEvent } from "./renderer.ts";
import { runPrompt } from "./renderer.ts";
import { resolveTheme } from "./theme.ts";
import type { PartialPromptTheme, PromptTheme, ValidateFn } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for the {@link input} prompt.
 *
 * @example
 * ```ts
 * const name = await input({
 *   message: "What is your name?",
 *   placeholder: "Enter your name",
 *   validate: (v) => v.length > 0 || "Name is required",
 * });
 * ```
 */
export interface InputOptions {
	/** The prompt message displayed to the user */
	readonly message: string;
	/** Placeholder text shown when the input is empty */
	readonly placeholder?: string;
	/** Default value used when the user submits an empty input */
	readonly default?: string;
	/** Initial value — if provided, the prompt is skipped and this value is returned immediately */
	readonly initial?: string;
	/** Validation function — return `true` for valid, or a string error message */
	readonly validate?: ValidateFn<string>;
	/** Per-prompt theme overrides */
	readonly theme?: PartialPromptTheme;
}

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────

interface InputState {
	readonly value: string;
	readonly cursorPos: number;
	readonly error: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Keypress handler
// ────────────────────────────────────────────────────────────────────────────

function createHandleKey(
	validate: ValidateFn<string> | undefined,
	defaultValue: string | undefined,
): (
	key: KeypressEvent,
	state: InputState,
) =>
	| InputState
	| { readonly submit: string }
	| Promise<InputState | { readonly submit: string }> {
	return async (key, state) => {
		// Enter — submit
		if (key.name === "return") {
			const submitValue =
				state.value === "" && defaultValue !== undefined
					? defaultValue
					: state.value;

			if (validate) {
				const result = await validate(submitValue);
				if (result !== true) {
					return { ...state, error: result };
				}
			}

			return { submit: submitValue };
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

function renderInput(
	state: InputState,
	theme: PromptTheme,
	message: string,
	placeholder: string | undefined,
	defaultValue: string | undefined,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message);

	// Default hint shown after message when value is empty and default exists
	const defaultHint =
		defaultValue !== undefined && state.value === ""
			? ` ${theme.hint(`(${defaultValue})`)}`
			: "";

	let valueLine: string;

	if (state.value === "") {
		// Show placeholder when input is empty
		if (placeholder) {
			valueLine = theme.placeholder(placeholder);
		} else {
			valueLine = theme.cursor(CURSOR_CHAR);
		}
	} else {
		// Show value with cursor
		const before = state.value.slice(0, state.cursorPos);
		const after = state.value.slice(state.cursorPos);
		valueLine = `${before}${theme.cursor(CURSOR_CHAR)}${after}`;
	}

	let output = `${prefix} ${msg}${defaultHint}\n${valueLine}`;

	// Show error inline below
	if (state.error !== null) {
		output += `\n${theme.error(state.error)}`;
	}

	return output;
}

function renderSubmitted(
	_state: InputState,
	value: string,
	theme: PromptTheme,
	message: string,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message);
	return `${prefix} ${msg} ${theme.success(value)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Display an interactive single-line text input prompt.
 *
 * Supports placeholder text, default values, validation with inline error
 * display, and full cursor editing (insert, delete, arrow keys, home/end).
 *
 * If `initial` is provided, the prompt is skipped and the value is returned
 * immediately — useful for prefilling from CLI flags.
 *
 * @param options - Input prompt configuration
 * @returns The user's entered text
 * @throws {NonInteractiveError} when stdin is not a TTY and no `initial` is provided
 *
 * @example
 * ```ts
 * const name = await input({
 *   message: "What is your name?",
 *   placeholder: "John Doe",
 *   validate: (v) => v.length > 0 || "Name cannot be empty",
 * });
 * ```
 *
 * @example
 * ```ts
 * // Skip prompt when flag is provided
 * const name = await input({
 *   message: "Name?",
 *   initial: flags.name,
 * });
 * ```
 */
export async function input(options: InputOptions): Promise<string> {
	// Short-circuit: return initial value immediately without rendering
	if (options.initial !== undefined) {
		return options.initial;
	}

	const theme = resolveTheme(undefined, options.theme);

	const initialState: InputState = {
		value: "",
		cursorPos: 0,
		error: null,
	};

	return runPrompt<InputState, string>({
		initialState,
		theme,
		render: (state, t) =>
			renderInput(
				state,
				t,
				options.message,
				options.placeholder,
				options.default,
			),
		handleKey: createHandleKey(options.validate, options.default),
		renderSubmitted: (state, value, t) =>
			renderSubmitted(state, value, t, options.message),
	});
}
