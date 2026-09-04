// ────────────────────────────────────────────────────────────────────────────
// Multiselect — Checkbox-style multi selection from a list for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import { setupListPrompt } from "../core/list.ts";
import type { KeypressEvent, PromptIO, SubmitResult } from "../core/renderer.ts";
import { runPrompt, submit } from "../core/renderer.ts";
import {
	CHECKBOX_CHECKED,
	CHECKBOX_UNCHECKED,
	CURSOR_INDICATOR,
	PREFIX_SUBMITTED,
	PREFIX_SYMBOL,
} from "../core/symbols.ts";
import type { Choice, ChoiceValue, PartialPromptTheme, PromptTheme } from "../core/types.ts";
import type { NormalizedChoice } from "../core/utils.ts";
import { formatSubmitted, moveCursor, renderChoiceList, validateSelection } from "../core/utils.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for the {@link multiselect} prompt.
 *
 * @example
 * ```ts
 * const toppings = await multiselect({
 *   message: "Select toppings",
 *   choices: ["cheese", "pepperoni", "mushrooms", "olives"],
 * });
 * ```
 *
 * @example
 * ```ts
 * const features = await multiselect<string>({
 *   message: "Enable features",
 *   choices: [
 *     { label: "TypeScript", value: "ts", hint: "recommended" },
 *     { label: "ESLint", value: "eslint" },
 *     { label: "Prettier", value: "prettier" },
 *   ],
 *   default: ["ts"],
 *   required: true,
 * });
 * ```
 */
export interface MultiselectOptions<T> {
	/** The prompt message displayed to the user */
	readonly message?: string;
	/** List of choices — strings or `{ label, value, hint? }` objects */
	readonly choices: readonly Choice<T>[];
	/** Default selected values — matches choices using reference equality for object values. */
	readonly default?: readonly T[];
	/** Initial value — if provided, the prompt is skipped and this value is returned immediately */
	readonly initial?: readonly T[];
	/**
	 * Whether at least one item must be selected.
	 *
	 * @default false
	 */
	readonly required?: boolean;
	/** Minimum number of selections required */
	readonly min?: number;
	/** Maximum number of selections allowed */
	readonly max?: number;
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
// Constants
// ────────────────────────────────────────────────────────────────────────────

const HINT_LINE = "(Space to toggle, a to toggle all, i to invert, Enter to confirm)";

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────

interface MultiselectState<T> {
	readonly cursor: number;
	readonly choices: readonly NormalizedChoice<T>[];
	readonly selected: ReadonlySet<number>;
	readonly scrollOffset: number;
	readonly error: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Keypress handler
// ────────────────────────────────────────────────────────────────────────────

function createHandleKey<T>(
	maxVisible: number,
	required?: boolean,
	min?: number,
	max?: number,
): (key: KeypressEvent, state: MultiselectState<T>) => MultiselectState<T> | SubmitResult<T[]> {
	return (key, state) => {
		const totalItems = state.choices.length;

		// Enter — submit selected items (with validation)
		if (key.name === "return") {
			const error = validateSelection(state.selected.size, required, min, max);
			if (error) {
				return { ...state, error };
			}

			const selectedValues = state.choices
				.filter((_, i) => state.selected.has(i))
				.map((c) => c.value);
			return submit(selectedValues);
		}

		// Space — toggle selection on current item
		if (key.name === "space") {
			const newSelected = new Set(state.selected);
			if (newSelected.has(state.cursor)) {
				newSelected.delete(state.cursor);
			} else {
				if (max === undefined || newSelected.size < max) {
					newSelected.add(state.cursor);
				}
			}
			return { ...state, selected: newSelected, error: null };
		}

		// 'a' — toggle all (respects max constraint)
		if (key.name === "a" && !key.ctrl && !key.meta) {
			const allSelected = state.selected.size === totalItems;
			let newSelected: Set<number>;
			if (allSelected) {
				newSelected = new Set<number>();
			} else {
				newSelected = new Set<number>();
				for (let i = 0; i < totalItems; i++) {
					if (max !== undefined && newSelected.size >= max) break;
					newSelected.add(i);
				}
			}
			return { ...state, selected: newSelected, error: null };
		}

		// 'i' — invert selection (respects max constraint)
		if (key.name === "i" && !key.ctrl && !key.meta) {
			const newSelected = new Set<number>();
			for (let i = 0; i < totalItems; i++) {
				if (!state.selected.has(i)) {
					if (max !== undefined && newSelected.size >= max) break;
					newSelected.add(i);
				}
			}
			return { ...state, selected: newSelected, error: null };
		}

		// Arrow keys or vim bindings — move cursor with wrapping
		if (["up", "down", "k", "j"].includes(key.name)) {
			const delta = key.name === "up" || key.name === "k" ? -1 : 1;
			return {
				...state,
				...moveCursor(state.cursor, totalItems, delta, state.scrollOffset, maxVisible),
				error: null,
			};
		}

		return state;
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Render
// ────────────────────────────────────────────────────────────────────────────

function renderMultiselect<T>(
	state: MultiselectState<T>,
	theme: PromptTheme,
	message: string | undefined,
	maxVisible: number,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message ?? "Pick one or more");
	const lines: string[] = [`${prefix} ${msg}`, theme.hint(HINT_LINE)];
	lines.push(
		...renderChoiceList(
			state.choices,
			state.scrollOffset,
			maxVisible,
			(choice, choiceIndex) => {
				const checkbox = state.selected.has(choiceIndex)
					? theme.success(CHECKBOX_CHECKED)
					: CHECKBOX_UNCHECKED;
				const hintText = choice.hint ? ` ${theme.hint(choice.hint)}` : "";
				return choiceIndex === state.cursor
					? `${theme.cursor(CURSOR_INDICATOR)} ${checkbox} ${theme.selected(choice.label)}${hintText}`
					: `  ${checkbox} ${theme.unselected(choice.label)}${hintText}`;
			},
			theme.hint,
		),
	);

	// Show error message if validation failed
	if (state.error) {
		lines.push(theme.error(state.error));
	}

	return lines.join("\n");
}

function renderSubmitted<T>(
	state: MultiselectState<T>,
	_value: T[],
	theme: PromptTheme,
	message: string | undefined,
): string {
	const prefix = theme.success(PREFIX_SUBMITTED);
	const msg = theme.message(message ?? "Pick one or more");
	const selectedLabels = state.choices
		.filter((_, i) => state.selected.has(i))
		.map((c) => c.label)
		.join(", ");
	return formatSubmitted(prefix, msg, theme.success(selectedLabels));
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Display an interactive checkbox-style multi-selection prompt.
 *
 * Navigate with Up/Down arrows (or k/j vim keys), toggle selection with Space,
 * toggle all with 'a', invert selection with 'i', and confirm with Enter.
 * When the list exceeds `maxVisible` items, the viewport scrolls with
 * indicators showing more items above or below.
 *
 * If `initial` is provided, the prompt is skipped and the value is returned
 * immediately -- useful for prefilling from CLI flags.
 *
 * In non-interactive environments (no TTY), the `default` values are returned
 * automatically if provided.
 *
 * @param options - Multiselect prompt configuration
 * @returns Array of selected values
 * @throws {NonInteractiveError} when stdin is not a TTY and no `initial` or `default` is provided
 *
 * @example
 * ```ts
 * const toppings = await multiselect({
 *   message: "Select toppings",
 *   choices: ["cheese", "pepperoni", "mushrooms", "olives"],
 * });
 * ```
 *
 * @example
 * ```ts
 * const features = await multiselect<string>({
 *   message: "Enable features",
 *   choices: [
 *     { label: "TypeScript", value: "ts", hint: "recommended" },
 *     { label: "ESLint", value: "eslint" },
 *     { label: "Prettier", value: "prettier" },
 *   ],
 *   default: ["ts"],
 *   required: true,
 * });
 * ```
 *
 * @example
 * ```ts
 * // Skip prompt when flags are provided
 * const features = await multiselect({
 *   message: "Features?",
 *   choices: ["auth", "logging", "metrics"],
 *   initial: flags.features,
 * });
 * ```
 */
// Narrowing overloads — see `select` for the pattern rationale.
export function multiselect<const C extends readonly [Choice<unknown>, ...Choice<unknown>[]]>(
	options: MultiselectOptions<ChoiceValue<C>> & { readonly choices: C },
	io?: PromptIO,
): Promise<ChoiceValue<C>[]>;
export function multiselect(
	options: MultiselectOptions<string> & { readonly choices: readonly string[] },
	io?: PromptIO,
): Promise<string[]>;
export function multiselect<T>(options: MultiselectOptions<T>, io?: PromptIO): Promise<T[]>;
export async function multiselect<T>(options: MultiselectOptions<T>, io?: PromptIO): Promise<T[]> {
	const setup = await setupListPrompt<T, readonly T[]>(options, "multiple", io);
	if (setup.shortCircuited) return [...setup.value];

	const { choices, cursor, maxVisible, promptIO, scrollOffset, selected } = setup;

	const initialState: MultiselectState<T> = {
		cursor,
		choices,
		selected: new Set(selected),
		scrollOffset,
		error: null,
	};

	return runPrompt<MultiselectState<T>, T[]>(
		{
			initialState,
			theme: options.theme,
			render: (state, t) => renderMultiselect(state, t, options.message, maxVisible),
			handleKey: createHandleKey<T>(maxVisible, options.required, options.min, options.max),
			renderSubmitted: (state, value, t) => renderSubmitted(state, value, t, options.message),
		},
		promptIO,
	);
}
