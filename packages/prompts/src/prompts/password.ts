// ────────────────────────────────────────────────────────────────────────────
// Password — Masked text input prompt for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { StandardSchema } from "@crustjs/utils/schema";

import type { PromptIO } from "../core/renderer.ts";
import { runPrompt } from "../core/renderer.ts";
import { resolveTextShortCircuit } from "../core/short-circuit.ts";
import { PREFIX_SUBMITTED, PREFIX_SYMBOL } from "../core/symbols.ts";
import { createTextSubmitHandler, CURSOR_CHAR } from "../core/text-edit.ts";
import type { TextSubmitState } from "../core/text-edit.ts";
import type {
	PartialPromptTheme,
	PromptTheme,
	SchemaOrValidate,
	ValidateFn,
} from "../core/types.ts";
import { formatPromptLine, formatSubmitted } from "../core/utils.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

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
export type PasswordOptions<Output = string> = PasswordBaseOptions & SchemaOrValidate<Output>;

// ────────────────────────────────────────────────────────────────────────────
// Render
// ────────────────────────────────────────────────────────────────────────────

const SUBMITTED_MASK_LENGTH = 4;

/** Count code points, the unit `handleTextEdit` moves the cursor by, so each mask char is one step. */
function codePointCount(text: string): number {
	// oxlint-disable-next-line typescript/no-misused-spread -- code points, not graphemes, match the cursor step.
	return [...text].length;
}

function renderPassword(
	state: TextSubmitState,
	theme: PromptTheme,
	message: string | undefined,
	mask: string,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message ?? "Enter a password");

	const beforeMask = mask.repeat(codePointCount(state.value.slice(0, state.cursorPos)));
	const afterMask = mask.repeat(codePointCount(state.value.slice(state.cursorPos)));
	const valueLine = `${beforeMask}${theme.cursor(CURSOR_CHAR)}${afterMask}`;

	let output = formatPromptLine(prefix, msg, valueLine);

	// Show error inline below
	if (state.error !== null) {
		output += `\n  ${theme.error(state.error)}`;
	}

	return output;
}

function renderSubmitted(theme: PromptTheme, message: string | undefined, mask: string): string {
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
	const shortCircuit = await resolveTextShortCircuit("password", options, io);
	if (shortCircuit.shortCircuited) return shortCircuit.value;
	const { promptIO } = shortCircuit;

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
			renderSubmitted: (_state, _value, t) => renderSubmitted(t, options.message, mask),
		},
		promptIO,
	);
}
