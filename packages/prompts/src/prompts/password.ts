// ────────────────────────────────────────────────────────────────────────────
// Password — Masked text input prompt for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { StandardSchema } from "@crustjs/utils/schema";

import type { KeypressEvent, PromptIO, SubmitResult } from "../core/renderer.ts";
import { resolvePromptIO, runPrompt, submit } from "../core/renderer.ts";
import { PREFIX_SUBMITTED, PREFIX_SYMBOL } from "../core/symbols.ts";
import { CURSOR_CHAR, handleTextEdit } from "../core/textEdit.ts";
import { resolveTheme } from "../core/theme.ts";
import {
	parseShortCircuit,
	type PartialPromptTheme,
	validateSubmitValue,
	type PromptTheme,
	type ValidateFn,
} from "../core/types.ts";
import { formatPromptLine, formatSubmitted } from "../core/utils.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for the {@link password} prompt.
 *
 * Use `schema` for Standard Schema validation and transformation, or
 * `validate` for a throw-on-failure function. They are mutually exclusive.
 *
 * @example
 * ```ts
 * const secret = await password({
 *   message: "Enter your password:",
 *   validate: (v) => {
 *     if (v.length < 8) throw new Error("Password must be at least 8 characters");
 *   },
 * });
 * ```
 */
export interface PasswordOptions<Output = string> {
	/** The prompt message displayed to the user */
	readonly message?: string;
	/**
	 * Character used to mask the input.
	 *
	 * @default "*"
	 */
	readonly mask?: string;
	/** Standard Schema that owns validation, transformation, defaults, and optionality. */
	readonly schema?: StandardSchema<unknown, Output>;
	/** Throw-on-failure validation function. Cannot be combined with `schema`. */
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

function createHandleKey<Output>(
	schema: StandardSchema<unknown, Output> | undefined,
	validate: ValidateFn<string> | undefined,
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
			const result = await validateSubmitValue(state.value, schema, validate);
			return result.ok ? submit(result.value) : { ...state, error: result.error };
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
 * Use `schema` for Standard Schema validation/transformation or `validate`
 * for a throw-on-failure function. The two options are mutually exclusive.
 *
 * @param options - Password prompt configuration
 * @returns The entered text, or the schema's output when `schema` is supplied.
 * @throws {NonInteractiveError} when stdin is not a TTY and no `initial` is provided
 *
 * @example
 * ```ts
 * const secret = await password({
 *   message: "Enter your password:",
 *   validate: (v) => {
 *     if (v.length < 8) throw new Error("Password must be at least 8 characters");
 *   },
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
	options: Omit<PasswordOptions<Output>, "schema" | "validate"> & {
		readonly schema: StandardSchema<unknown, Output>;
		readonly validate?: never;
	},
	io?: PromptIO,
): Promise<Output>;
export function password(
	options?: Omit<PasswordOptions, "schema"> & { readonly schema?: never },
	io?: PromptIO,
): Promise<string>;
export async function password<Output>(
	options: PasswordOptions<Output> = {},
	io?: PromptIO,
): Promise<Output | string> {
	if (options.schema !== undefined && options.validate !== undefined) {
		throw new Error('password() cannot combine "schema" with "validate"');
	}

	// Schema short-circuits must preserve the promised output type.
	if (options.initial !== undefined) {
		if (options.schema) return parseShortCircuit(options.schema, options.initial, "initial");
		return options.initial;
	}

	const promptIO = resolvePromptIO(io);

	const theme = resolveTheme(options.theme);
	const mask = options.mask ?? "*";

	const initialState: PasswordState = {
		value: "",
		cursorPos: 0,
		error: null,
	};

	return runPrompt<PasswordState, Output | string>(
		{
			initialState,
			theme,
			render: (state, t) => renderPassword(state, t, options.message, mask),
			handleKey: createHandleKey<Output>(options.schema, options.validate),
			renderSubmitted: (state, value, t) => renderSubmitted(state, value, t, options.message, mask),
		},
		promptIO,
	);
}
