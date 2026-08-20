// ────────────────────────────────────────────────────────────────────────────
// Input — Single-line text input prompt for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { StandardSchema } from "@crustjs/utils/schema";

import type { PromptIO } from "../core/renderer.ts";
import { isTTY, resolvePromptIO, runPrompt } from "../core/renderer.ts";
import { PREFIX_SUBMITTED, PREFIX_SYMBOL } from "../core/symbols.ts";
import { createTextSubmitHandler, renderTextWithCursor } from "../core/textEdit.ts";
import { resolveTheme } from "../core/theme.ts";
import {
	parseShortCircuit,
	type PartialPromptTheme,
	type PromptTheme,
	type SchemaOrValidate,
	type ValidateFn,
} from "../core/types.ts";
import { formatPromptLine, formatSubmitted } from "../core/utils.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for the {@link input} prompt.
 *
 * Use `schema` for Standard Schema validation and transformation, or
 * `validate` for a throw-on-failure function. They are mutually exclusive.
 *
 * @typeParam Output - the Standard Schema output type. Defaults to `string`
 * when no schema is supplied.
 *
 * @example
 * ```ts
 * // Function shape — resolves to string
 * const name = await input({
 *   message: "What is your name?",
 *   validate: (v) => {
 *     if (v.length === 0) throw new Error("Name is required");
 *   },
 * });
 * ```
 *
 * @example
 * ```ts
 * // Schema shape — resolves to the schema's parsed output type
 * const port = await input({
 *   message: "Port?",
 *   schema: z.coerce.number().int().min(1),
 * });
 * // typeof port === "number"
 * ```
 */
interface InputBaseOptions {
	/** The prompt message displayed to the user */
	readonly message?: string;
	/** Placeholder text shown when the input is empty. Overrides the default value as visual placeholder when both are set. */
	readonly placeholder?: string;
	/** Default value used when the user submits an empty input. Also shown as placeholder text when `placeholder` is not set. */
	readonly default?: string;
	/** Initial value — if provided, the prompt is skipped and this value is returned immediately */
	readonly initial?: string;
	/** Per-prompt theme overrides */
	readonly theme?: PartialPromptTheme;
}

export type InputOptions<Output = string> = InputBaseOptions & SchemaOrValidate<Output>;

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────

interface InputState {
	readonly value: string;
	readonly cursorPos: number;
	readonly error: string | null;
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
		defaultValue !== undefined && placeholder !== undefined && state.value === ""
			? ` ${theme.hint(`(${defaultValue})`)}`
			: "";

	const valueLine = renderTextWithCursor(state.value, state.cursorPos, theme, effectivePlaceholder);

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
 * Use `schema` for Standard Schema validation/transformation or `validate`
 * for a throw-on-failure function. The two options are mutually exclusive.
 *
 * @param options - Input prompt configuration
 * @returns The entered text, or the schema's output when `schema` is supplied.
 * @throws {NonInteractiveError} when stdin is not a TTY and no `initial` or `default` is provided
 *
 * @example
 * ```ts
 * const name = await input({
 *   message: "What is your name?",
 *   placeholder: "John Doe",
 *   validate: (v) => {
 *     if (v.length === 0) throw new Error("Name cannot be empty");
 *   },
 * });
 * ```
 *
 * @example
 * ```ts
 * // Schema validation — returns the parsed/transformed value
 * const port = await input({
 *   message: "Port?",
 *   schema: z.coerce.number().int().min(1),
 * });
 * // typeof port === "number"
 * ```
 */
export function input<Output>(
	options: InputBaseOptions & {
		readonly schema: StandardSchema<unknown, Output>;
		readonly validate?: never;
	},
	io?: PromptIO,
): Promise<Output>;
export function input(
	options?: InputBaseOptions & {
		readonly schema?: never;
		readonly validate?: ValidateFn<string>;
	},
	io?: PromptIO,
): Promise<string>;
export async function input<Output>(
	options: InputOptions<Output> = {},
	io?: PromptIO,
): Promise<Output | string> {
	if (options.schema !== undefined && options.validate !== undefined) {
		throw new Error('input() cannot combine "schema" with "validate"');
	}

	// Schema short-circuits must preserve the promised output type.
	if (options.initial !== undefined) {
		if (options.schema) return parseShortCircuit(options.schema, options.initial, "initial");
		return options.initial;
	}

	const promptIO = resolvePromptIO(io);

	// Non-interactive defaults also flow through the schema.
	if (!isTTY(promptIO.input) && options.default !== undefined) {
		if (options.schema) return parseShortCircuit(options.schema, options.default, "default");
		return options.default;
	}

	const theme = resolveTheme(options.theme);

	const initialState: InputState = {
		value: "",
		cursorPos: 0,
		error: null,
	};

	return runPrompt<InputState, Output | string>(
		{
			initialState,
			theme,
			render: (state, t) =>
				renderInput(state, t, options.message, options.placeholder, options.default),
			handleKey: createTextSubmitHandler<Output>(options.schema, options.validate, options.default),
			renderSubmitted: (state, value, t) => renderSubmitted(state, value, t, options.message),
		},
		promptIO,
	);
}
