// ────────────────────────────────────────────────────────────────────────────
// Password — Masked text input prompt for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { KeypressEvent, SubmitResult } from "../core/renderer.ts";
import { runPrompt, submit } from "../core/renderer.ts";
import { PREFIX_SUBMITTED, PREFIX_SYMBOL } from "../core/symbols.ts";
import { CURSOR_CHAR, handleTextEdit } from "../core/textEdit.ts";
import { resolveTheme } from "../core/theme.ts";
import {
	isStandardSchema,
	type PartialPromptTheme,
	type PromptTheme,
	type PromptValidate,
	type ValidateFn,
} from "../core/types.ts";
import { formatPromptLine, formatSubmitted } from "../core/utils.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for the {@link password} prompt.
 *
 * The `validate` slot is polymorphic: it accepts either a classic
 * {@link ValidateFn} (returning `true` or an error string) or a
 * {@link StandardSchemaV1} schema. When a schema is supplied, the prompt
 * resolves to the schema's transformed `Output` type instead of `string`.
 *
 * @example
 * ```ts
 * const secret = await password({
 *   message: "Enter your password:",
 *   validate: (v) => v.length >= 8 || "Password must be at least 8 characters",
 * });
 * ```
 */
export interface PasswordOptions<Output = string> {
	/** The prompt message displayed to the user */
	readonly message?: string;
	/** Character used to mask the input (default: `"*"`) */
	readonly mask?: string;
	/**
	 * Validation: either a function returning `true | string` or a
	 * Standard Schema v1 object whose parsed output replaces the raw input.
	 */
	readonly validate?: PromptValidate<Output>;
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

function createHandleKey<Output>(
	validate: PromptValidate<Output> | undefined,
): (
	key: KeypressEvent,
	state: PasswordState,
) =>
	| PasswordState
	| SubmitResult<Output | string>
	| Promise<PasswordState | SubmitResult<Output | string>> {
	return async (key, state) => {
		// Enter — submit
		if (key.name === "return") {
			if (validate) {
				if (isStandardSchema(validate)) {
					const result = await validate["~standard"].validate(state.value);
					if (result.issues) {
						return {
							...state,
							error: result.issues[0]?.message || "Validation failed",
						};
					}
					return submit(result.value as Output);
				}

				const fnResult = await (validate as ValidateFn<string>)(state.value);
				if (fnResult !== true) {
					return { ...state, error: fnResult };
				}
				return submit(state.value);
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
	const msg = theme.message(message ?? "Enter a password");

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

function renderSubmitted<Output>(
	_state: PasswordState,
	_value: Output,
	theme: PromptTheme,
	message: string | undefined,
	mask: string,
): string {
	const prefix = theme.success(PREFIX_SUBMITTED);
	const msg = theme.message(message ?? "Enter a password");
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
 * The `validate` slot is **polymorphic**:
 * - When omitted or given a `ValidateFn<string>`, the prompt resolves to the
 *   raw `string` input.
 * - When given a Standard Schema v1 object, the schema parses the raw input
 *   on submit; the prompt resolves to the schema's transformed `Output` type.
 *
 * @param options - Password prompt configuration
 * @returns The user's entered password, or the schema-parsed output when a
 *          Standard Schema is supplied as `validate`.
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
export function password<Output>(
	options: PasswordOptions<Output> & {
		readonly validate: StandardSchemaV1<unknown, Output>;
	},
): Promise<Output>;
export function password(
	options?: Omit<PasswordOptions<string>, "validate"> & {
		readonly validate?: ValidateFn<string>;
	},
): Promise<string>;
export async function password<Output>(
	options: PasswordOptions<Output> = {},
): Promise<Output | string> {
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

	return runPrompt<PasswordState, Output | string>({
		initialState,
		theme,
		render: (state, t) => renderPassword(state, t, options.message, mask),
		handleKey: createHandleKey<Output>(options.validate),
		renderSubmitted: (state, value, t) =>
			renderSubmitted(state, value, t, options.message, mask),
	});
}
