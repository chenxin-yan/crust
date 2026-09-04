// ────────────────────────────────────────────────────────────────────────────
// Password — Masked text input prompt for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { StandardSchema } from "@crustjs/utils/schema";

import type { PromptIO } from "../core/renderer.ts";
import { resolvePromptIO, runPrompt } from "../core/renderer.ts";
import { PREFIX_SUBMITTED, PREFIX_SYMBOL } from "../core/symbols.ts";
import { createTextSubmitHandler, CURSOR_CHAR } from "../core/textEdit.ts";
import type { TextSubmitState } from "../core/textEdit.ts";
import type {
	PartialPromptTheme,
	PromptTheme,
	SchemaOrValidate,
	ValidateFn,
} from "../core/types.ts";
import { formatPromptLine, formatSubmitted } from "../core/utils.ts";
import { resolvePromptInitial } from "../core/validate.ts";

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
interface PasswordBaseOptions {
	/** The prompt message displayed to the user */
	readonly message?: string;
	/**
	 * Character used to mask the input.
	 *
	 * @default "*"
	 */
	readonly mask?: string;
	/** Initial value — if provided, the prompt is skipped and this value is returned immediately */
	readonly initial?: string;
	/** Per-prompt theme overrides */
	readonly theme?: PartialPromptTheme;
}

export type PasswordOptions<Output = string> = PasswordBaseOptions & SchemaOrValidate<Output>;

// ────────────────────────────────────────────────────────────────────────────
// Render
// ────────────────────────────────────────────────────────────────────────────

const SUBMITTED_MASK_LENGTH = 4;

function renderPassword(
	state: TextSubmitState,
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
	_state: TextSubmitState,
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
	options: PasswordBaseOptions & {
		readonly schema: StandardSchema<unknown, Output>;
		readonly validate?: never;
	},
	io?: PromptIO,
): Promise<Output>;
export function password(
	options?: PasswordBaseOptions & {
		readonly schema?: never;
		readonly validate?: ValidateFn<string>;
	},
	io?: PromptIO,
): Promise<string>;
export async function password<Output>(
	options: PasswordOptions<Output> = {},
	io?: PromptIO,
): Promise<Output | string> {
	const initial = await resolvePromptInitial("password", options);
	if (initial.shortCircuited) return initial.value;

	const promptIO = resolvePromptIO(io);

	const mask = options.mask ?? "*";

	const initialState: TextSubmitState = {
		value: "",
		cursorPos: 0,
		error: null,
	};

	return runPrompt<TextSubmitState, Output | string>(
		{
			initialState,
			theme: options.theme,
			render: (state, t) => renderPassword(state, t, options.message, mask),
			handleKey: createTextSubmitHandler<Output>(options.schema, options.validate),
			renderSubmitted: (state, value, t) => renderSubmitted(state, value, t, options.message, mask),
		},
		promptIO,
	);
}
