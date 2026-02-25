// ────────────────────────────────────────────────────────────────────────────
// Password — Masked text input prompt for @crustjs/prompts
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
	readonly message?: string;
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
	| SubmitResult<string>
	| Promise<PasswordState | SubmitResult<string>> {
	return async (key, state) => {
		// Enter — submit
		if (key.name === "return") {
			if (validate) {
				const result = await validate(state.value);
				if (result !== true) {
					return { ...state, error: result };
				}
			}

			return submit(state.value);
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

const SUBMITTED_MASK_LENGTH = 4;

function renderPassword(
	state: PasswordState,
	theme: PromptTheme,
	message: string | undefined,
	mask: string,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = message ? theme.message(message) : undefined;

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

	let output = formatPromptLine(prefix, msg, valueLine);

	// Show error inline below
	if (state.error !== null) {
		output += `\n  ${theme.error(state.error)}`;
	}

	return output;
}

function renderSubmitted(
	_state: PasswordState,
	_value: string,
	theme: PromptTheme,
	message: string | undefined,
	mask: string,
): string {
	const prefix = theme.success(PREFIX_SUBMITTED);
	const msg = message ? theme.message(message) : undefined;
	// Show a fixed number of mask characters regardless of actual length
	const maskedDisplay = theme.success(mask.repeat(SUBMITTED_MASK_LENGTH));
	return formatSubmitted(prefix, msg, maskedDisplay);
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

	const theme = resolveTheme(options.theme);
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
