// ────────────────────────────────────────────────────────────────────────────
// Input — Single-line text input prompt for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { KeypressEvent, SubmitResult } from "../core/renderer.ts";
import { runPrompt, submit } from "../core/renderer.ts";
import { PREFIX_SUBMITTED, PREFIX_SYMBOL } from "../core/symbols.ts";
import { CURSOR_CHAR, handleTextEdit } from "../core/textEdit.ts";
import { resolveTheme } from "../core/theme.ts";
import type {
	PartialPromptTheme,
	PromptTheme,
	ValidateFn,
} from "../core/types.ts";
import { formatPromptLine, formatSubmitted } from "../core/utils.ts";

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
 *
 * @example
 * ```ts
 * // Without a message — renders prefix + input only
 * const name = await input({ placeholder: "Enter your name" });
 * ```
 */
export interface InputOptions {
	/** The prompt message displayed to the user */
	readonly message?: string;
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
	| SubmitResult<string>
	| Promise<InputState | SubmitResult<string>> {
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

			return submit(submitValue);
		}

		// Delegate to shared text-editing handler
		const edit = handleTextEdit(key, state.value, state.cursorPos);
		if (edit) {
			return { value: edit.text, cursorPos: edit.cursorPos, error: null };
		}

		return state;
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Render
// ────────────────────────────────────────────────────────────────────────────

function renderInput(
	state: InputState,
	theme: PromptTheme,
	message: string | undefined,
	placeholder: string | undefined,
	defaultValue: string | undefined,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message ?? "Enter a value");

	// Default hint shown after header when value is empty and default exists
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

	let output = formatPromptLine(prefix, msg, valueLine, defaultHint);

	// Show error inline below
	if (state.error !== null) {
		output += `\n  ${theme.error(state.error)}`;
	}

	return output;
}

function renderSubmitted(
	_state: InputState,
	value: string,
	theme: PromptTheme,
	message: string | undefined,
): string {
	const prefix = theme.success(PREFIX_SUBMITTED);
	const msg = theme.message(message ?? "Enter a value");
	return formatSubmitted(prefix, msg, theme.success(value));
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

	const theme = resolveTheme(options.theme);

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
