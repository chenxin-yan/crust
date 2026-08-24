// ────────────────────────────────────────────────────────────────────────────
// Select — Single selection from a list of choices for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import { setupListPrompt } from "../core/list.ts";
import type { KeypressEvent, PromptIO, SubmitResult } from "../core/renderer.ts";
import { runPrompt, submit } from "../core/renderer.ts";
import { CURSOR_INDICATOR, PREFIX_SUBMITTED, PREFIX_SYMBOL } from "../core/symbols.ts";
import type { Choice, ChoiceValue, PartialPromptTheme, PromptTheme } from "../core/types.ts";
import type { NormalizedChoice } from "../core/utils.ts";
import { formatSubmitted, moveCursor, renderChoiceList } from "../core/utils.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for the {@link select} prompt.
 *
 * @example
 * ```ts
 * const color = await select({
 *   message: "Pick a color",
 *   choices: ["red", "green", "blue"],
 * });
 * ```
 *
 * @example
 * ```ts
 * const port = await select<number>({
 *   message: "Choose a port",
 *   choices: [
 *     { label: "HTTP", value: 80 },
 *     { label: "HTTPS", value: 443, hint: "recommended" },
 *   ],
 *   default: 443,
 * });
 * ```
 */
export interface SelectOptions<T> {
	/** The prompt message displayed to the user */
	readonly message?: string;
	/** List of choices — strings or `{ label, value, hint? }` objects */
	readonly choices: readonly Choice<T>[];
	/** Default value — sets the initial cursor position using reference equality for object values. */
	readonly default?: T;
	/** Initial value — if provided, the prompt is skipped and this value is returned immediately */
	readonly initial?: T;
	/**
	 * Maximum number of visible choices before scrolling.
	 *
	 * @default 10
	 */
	readonly maxVisible?: number;
	/** Per-prompt theme overrides */
	readonly theme?: PartialPromptTheme;
}

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────

interface SelectState<T> {
	readonly cursor: number;
	readonly choices: readonly NormalizedChoice<T>[];
	readonly scrollOffset: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Keypress handler
// ────────────────────────────────────────────────────────────────────────────

function createHandleKey<T>(
	maxVisible: number,
): (key: KeypressEvent, state: SelectState<T>) => SelectState<T> | SubmitResult<T> {
	return (key, state) => {
		const totalItems = state.choices.length;

		// Enter — submit currently highlighted item
		if (key.name === "return") {
			const selected = state.choices[state.cursor];
			if (selected) {
				return submit(selected.value);
			}
			return state;
		}

		// Arrow keys or vim bindings — move cursor with wrapping
		if (["up", "down", "k", "j"].includes(key.name)) {
			const delta = key.name === "up" || key.name === "k" ? -1 : 1;
			return {
				...state,
				...moveCursor(state.cursor, totalItems, delta, state.scrollOffset, maxVisible),
			};
		}

		return state;
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Render
// ────────────────────────────────────────────────────────────────────────────

function renderSelect<T>(
	state: SelectState<T>,
	theme: PromptTheme,
	message: string | undefined,
	maxVisible: number,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message ?? "Pick an option");
	const lines: string[] = [`${prefix} ${msg}`];
	lines.push(
		...renderChoiceList(
			state.choices,
			state.scrollOffset,
			maxVisible,
			(choice, choiceIndex) => {
				const hintText = choice.hint ? ` ${theme.hint(choice.hint)}` : "";
				return choiceIndex === state.cursor
					? `${theme.cursor(CURSOR_INDICATOR)} ${theme.selected(choice.label)}${hintText}`
					: `  ${theme.unselected(choice.label)}${hintText}`;
			},
			theme.hint,
		),
	);

	return lines.join("\n");
}

function renderSubmitted<T>(
	state: SelectState<T>,
	_value: T,
	theme: PromptTheme,
	message: string | undefined,
): string {
	const prefix = theme.success(PREFIX_SUBMITTED);
	const msg = theme.message(message ?? "Pick an option");
	const selected = state.choices[state.cursor];
	const label = selected ? selected.label : "";
	return formatSubmitted(prefix, msg, theme.success(label));
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Display an interactive single-selection prompt from a list of choices.
 *
 * Navigate with Up/Down arrows (or k/j vim keys), confirm with Enter.
 * When the list exceeds `maxVisible` items, the viewport scrolls with
 * indicators showing more items above or below.
 *
 * If `initial` is provided, the prompt is skipped and the value is returned
 * immediately -- useful for prefilling from CLI flags.
 *
 * In non-interactive environments (no TTY), the `default` value is returned
 * automatically if provided.
 *
 * @param options - Select prompt configuration
 * @returns The value of the selected choice
 * @throws {NonInteractiveError} when stdin is not a TTY and no `initial` or `default` is provided
 *
 * @example
 * ```ts
 * const color = await select({
 *   message: "Pick a color",
 *   choices: ["red", "green", "blue"],
 * });
 * ```
 *
 * @example
 * ```ts
 * const port = await select<number>({
 *   message: "Choose a port",
 *   choices: [
 *     { label: "HTTP", value: 80 },
 *     { label: "HTTPS", value: 443, hint: "recommended" },
 *   ],
 *   default: 443,
 * });
 * ```
 *
 * @example
 * ```ts
 * // Skip prompt when flag is provided
 * const env = await select({
 *   message: "Environment?",
 *   choices: ["dev", "staging", "prod"],
 *   initial: flags.env,
 * });
 * ```
 */
// Narrowing overloads: a literal non-empty choices tuple narrows the result
// to the union of its values, and widened `readonly string[]` choices keep
// `string`. Non-tuple `readonly Choice<T>[]` (e.g. generic wrappers over
// SelectOptions<T>) matches neither and falls through to the generic
// overload, so `select(options)` inside a wrapper stays `Promise<T>`.
export function select<const C extends readonly [Choice<unknown>, ...Choice<unknown>[]]>(
	options: SelectOptions<ChoiceValue<C>> & { readonly choices: C },
	io?: PromptIO,
): Promise<ChoiceValue<C>>;
export function select(
	options: SelectOptions<string> & { readonly choices: readonly string[] },
	io?: PromptIO,
): Promise<string>;
export function select<T>(options: SelectOptions<T>, io?: PromptIO): Promise<T>;
export async function select<T>(options: SelectOptions<T>, io?: PromptIO): Promise<T> {
	const setup = setupListPrompt<T, T>(options, io, options.default);
	if (setup.shortCircuited) return setup.value;

	const { choices, cursor, maxVisible, promptIO, scrollOffset } = setup;
	const initialState: SelectState<T> = { cursor, choices, scrollOffset };

	return runPrompt<SelectState<T>, T>(
		{
			initialState,
			theme: options.theme,
			render: (state, t) => renderSelect(state, t, options.message, maxVisible),
			handleKey: createHandleKey<T>(maxVisible),
			renderSubmitted: (state, value, t) => renderSubmitted(state, value, t, options.message),
		},
		promptIO,
	);
}
