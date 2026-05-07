// ────────────────────────────────────────────────────────────────────────────
// Input — Single-line text input prompt for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { KeypressEvent, SubmitResult } from "../core/renderer.ts";
import { isTTY, runPrompt, submit } from "../core/renderer.ts";
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
 * Options for the {@link input} prompt.
 *
 * The `validate` slot is polymorphic: it accepts either a classic
 * {@link ValidateFn} (returning `true` or an error string) or a
 * {@link StandardSchemaV1} schema (Zod, Valibot, Effect Schema, …). When a
 * schema is supplied, the prompt resolves to the schema's transformed
 * `Output` type instead of the raw `string`.
 *
 * @typeParam Output - the resolved value type. Defaults to `string` (the
 * function-validate / no-validate case). Inferred automatically from the
 * shape of `validate` via the {@link input} overloads.
 *
 * @example
 * ```ts
 * // Function shape — resolves to string
 * const name = await input({
 *   message: "What is your name?",
 *   validate: (v) => v.length > 0 || "Name is required",
 * });
 * ```
 *
 * @example
 * ```ts
 * // Schema shape — resolves to the schema's parsed output type
 * const port = await input({
 *   message: "Port?",
 *   validate: z.coerce.number().int().min(1),
 * });
 * // typeof port === "number"
 * ```
 */
export interface InputOptions<Output = string> {
	/** The prompt message displayed to the user */
	readonly message?: string;
	/** Placeholder text shown when the input is empty. Overrides the default value as visual placeholder when both are set. */
	readonly placeholder?: string;
	/** Default value used when the user submits an empty input. Also shown as placeholder text when `placeholder` is not set. */
	readonly default?: string;
	/** Initial value — if provided, the prompt is skipped and this value is returned immediately */
	readonly initial?: string;
	/**
	 * Validation: either a function returning `true | string` or a
	 * Standard Schema v1 object whose parsed output replaces the raw input.
	 */
	readonly validate?: PromptValidate<Output>;
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

function createHandleKey<Output>(
	validate: PromptValidate<Output> | undefined,
	defaultValue: string | undefined,
): (
	key: KeypressEvent,
	state: InputState,
) =>
	| InputState
	| SubmitResult<Output | string>
	| Promise<InputState | SubmitResult<Output | string>> {
	return async (key, state) => {
		// Enter — submit
		if (key.name === "return") {
			const submitValue =
				state.value === "" && defaultValue !== undefined
					? defaultValue
					: state.value;

			if (validate) {
				if (isStandardSchema(validate)) {
					// Schema path — parse, render first issue on failure,
					// submit the schema's transformed output on success.
					const result = await validate["~standard"].validate(submitValue);
					if (result.issues) {
						return {
							...state,
							error: result.issues[0]?.message || "Validation failed",
						};
					}
					return submit(result.value as Output);
				}

				// Function path — preserved unchanged.
				const fnResult = await (validate as ValidateFn<string>)(submitValue);
				if (fnResult !== true) {
					return { ...state, error: fnResult };
				}
				return submit(submitValue);
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

	// Use default as placeholder when placeholder isn't explicitly set
	const effectivePlaceholder = placeholder ?? defaultValue;

	// Default hint shown after header when value is empty and default exists
	// (only when placeholder is explicitly set, to avoid redundancy)
	const defaultHint =
		defaultValue !== undefined &&
		placeholder !== undefined &&
		state.value === ""
			? ` ${theme.hint(`(${defaultValue})`)}`
			: "";

	let valueLine: string;

	if (state.value === "") {
		// Show placeholder when input is empty
		if (effectivePlaceholder) {
			valueLine = theme.placeholder(effectivePlaceholder);
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

function renderSubmitted<Output>(
	_state: InputState,
	value: Output,
	theme: PromptTheme,
	message: string | undefined,
): string {
	const prefix = theme.success(PREFIX_SUBMITTED);
	const msg = theme.message(message ?? "Enter a value");
	return formatSubmitted(prefix, msg, theme.success(String(value)));
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
 * In non-interactive environments (no TTY), the `default` value is returned
 * automatically if provided.
 *
 * The `validate` slot is **polymorphic**:
 * - When omitted or given a `ValidateFn<string>`, the prompt resolves to the
 *   raw `string` input.
 * - When given a Standard Schema v1 object, the schema parses the raw input
 *   on submit; the prompt resolves to the schema's transformed `Output` type.
 *
 * @param options - Input prompt configuration
 * @returns The user's entered text, or the schema-parsed output when a
 *          Standard Schema is supplied as `validate`.
 * @throws {NonInteractiveError} when stdin is not a TTY and no `initial` or `default` is provided
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
 * // Schema validation — returns the parsed/transformed value
 * const port = await input({
 *   message: "Port?",
 *   validate: z.coerce.number().int().min(1),
 * });
 * // typeof port === "number"
 * ```
 */
export function input<Output>(
	options: InputOptions<Output> & {
		readonly validate: StandardSchemaV1<unknown, Output>;
	},
): Promise<Output>;
export function input(
	options?: Omit<InputOptions<string>, "validate"> & {
		readonly validate?: ValidateFn<string>;
	},
): Promise<string>;
export async function input<Output>(
	options: InputOptions<Output> = {},
): Promise<Output | string> {
	// Short-circuit: return initial value immediately without rendering
	if (options.initial !== undefined) {
		return options.initial;
	}

	// Non-interactive fallback: return default value when stdin is not a TTY
	if (!isTTY() && options.default !== undefined) {
		return options.default;
	}

	const theme = resolveTheme(options.theme);

	const initialState: InputState = {
		value: "",
		cursorPos: 0,
		error: null,
	};

	return runPrompt<InputState, Output | string>({
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
		handleKey: createHandleKey<Output>(options.validate, options.default),
		renderSubmitted: (state, value, t) =>
			renderSubmitted(state, value, t, options.message),
	});
}
