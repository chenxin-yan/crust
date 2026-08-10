// ────────────────────────────────────────────────────────────────────────────
// Multifilter — Fuzzy-search multi selection for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { FuzzyFilterResult } from "../core/fuzzy.ts";
import { fuzzyFilter, highlightMatches, refilter } from "../core/fuzzy.ts";
import type { KeypressEvent, PromptIO, SubmitResult } from "../core/renderer.ts";
import { isTTY, resolvePromptIO, runPrompt, submit } from "../core/renderer.ts";
import {
	CHECKBOX_CHECKED,
	CHECKBOX_UNCHECKED,
	CURSOR_INDICATOR,
	PREFIX_SUBMITTED,
	PREFIX_SYMBOL,
} from "../core/symbols.ts";
import { handleTextEdit, renderTextWithCursor } from "../core/textEdit.ts";
import { resolveTheme } from "../core/theme.ts";
import type { Choice, ChoiceValue, PartialPromptTheme, PromptTheme } from "../core/types.ts";
import type { NormalizedChoice } from "../core/utils.ts";
import {
	calculateScrollOffset,
	DEFAULT_MAX_VISIBLE,
	formatPromptLine,
	formatSubmitted,
	moveCursor,
	normalizeChoices,
	renderChoiceList,
	validateSelection,
} from "../core/utils.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for the {@link multifilter} prompt.
 */
export interface MultifilterOptions<T> {
	/** The prompt message displayed to the user */
	readonly message?: string;
	/** List of choices — strings or `{ label, value, hint? }` objects */
	readonly choices: readonly Choice<T>[];
	/** Default selected values — pre-selects matching choices */
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
	/** Placeholder text shown when the query input is empty */
	readonly placeholder?: string;
	/**
	 * Maximum number of visible filtered results before scrolling.
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

const HINT_LINE = "(Type to filter, Space to toggle, Enter to confirm)";

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────

interface MultifilterState<T> {
	/** Current query text */
	readonly query: string;
	/** Cursor position within the query text */
	readonly cursorPos: number;
	/** All normalized choices (unfiltered) */
	readonly choices: readonly NormalizedChoice<T>[];
	/** Filtered results matching the current query */
	readonly results: readonly FuzzyFilterResult<T>[];
	/** Cursor position in the filtered results list */
	readonly listCursor: number;
	/** Scroll offset for the filtered results viewport */
	readonly scrollOffset: number;
	/** Indices into `choices` for selected items */
	readonly selected: ReadonlySet<number>;
	/** Current validation error */
	readonly error: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function choiceIndex<T>(
	choices: readonly NormalizedChoice<T>[],
	item: { readonly label: string; readonly value: T },
): number {
	return choices.findIndex((choice) => choice.label === item.label && choice.value === item.value);
}

// ────────────────────────────────────────────────────────────────────────────
// Keypress handler
// ────────────────────────────────────────────────────────────────────────────

function createHandleKey<T>(
	maxVisible: number,
	required?: boolean,
	min?: number,
	max?: number,
): (key: KeypressEvent, state: MultifilterState<T>) => MultifilterState<T> | SubmitResult<T[]> {
	return (key, state) => {
		if (key.name === "return") {
			const error = validateSelection(state.selected.size, required, min, max);
			if (error) {
				return { ...state, error };
			}

			const selectedValues = state.choices
				.filter((_, i) => state.selected.has(i))
				.map((choice) => choice.value);
			return submit(selectedValues);
		}

		if (key.name === "space") {
			const result = state.results[state.listCursor];
			if (!result) return state;

			const selectedIndex = choiceIndex(state.choices, result.item);
			if (selectedIndex === -1) return state;

			const selected = new Set(state.selected);
			if (selected.has(selectedIndex)) {
				selected.delete(selectedIndex);
			} else if (max === undefined || selected.size < max) {
				selected.add(selectedIndex);
			}

			return { ...state, selected, error: null };
		}

		if (key.name === "up" || key.name === "down") {
			if (state.results.length === 0) return state;
			const delta = key.name === "up" ? -1 : 1;
			const moved = moveCursor(
				state.listCursor,
				state.results.length,
				delta,
				state.scrollOffset,
				maxVisible,
			);
			return { ...state, listCursor: moved.cursor, scrollOffset: moved.scrollOffset, error: null };
		}

		const edit = handleTextEdit(key, state.query, state.cursorPos);
		if (edit) {
			const queryChanged = edit.text !== state.query;
			const nextState: MultifilterState<T> = {
				...state,
				query: edit.text,
				cursorPos: edit.cursorPos,
			};
			return queryChanged ? refilter(nextState, maxVisible) : nextState;
		}

		return state;
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Render
// ────────────────────────────────────────────────────────────────────────────

function renderMultifilter<T>(
	state: MultifilterState<T>,
	theme: PromptTheme,
	message: string | undefined,
	placeholder: string | undefined,
	maxVisible: number,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message ?? "Search and select");

	const queryLine = renderTextWithCursor(state.query, state.cursorPos, theme, placeholder);

	const lines: string[] = [formatPromptLine(prefix, msg, queryLine), theme.hint(HINT_LINE)];

	const totalResults = state.results.length;
	if (totalResults === 0 && state.query.length > 0) {
		lines.push(theme.hint("No matches"));
		if (state.error) {
			lines.push(theme.error(state.error));
		}
		return lines.join("\n");
	}

	lines.push(
		...renderChoiceList(
			state.results,
			state.scrollOffset,
			maxVisible,
			(result, resultIndex) => {
				const choiceIdx = choiceIndex(state.choices, result.item);
				const choice = choiceIdx === -1 ? undefined : state.choices[choiceIdx];
				const checkbox =
					choiceIdx !== -1 && state.selected.has(choiceIdx)
						? theme.success(CHECKBOX_CHECKED)
						: CHECKBOX_UNCHECKED;
				const label = highlightMatches(result.item.label, result.indices, theme);
				const hintText = choice?.hint ? ` ${theme.hint(choice.hint)}` : "";
				return resultIndex === state.listCursor
					? `${theme.cursor(CURSOR_INDICATOR)} ${checkbox} ${theme.selected(label)}${hintText}`
					: `  ${checkbox} ${theme.unselected(label)}${hintText}`;
			},
			theme.hint,
		),
	);

	if (state.error) {
		lines.push(theme.error(state.error));
	}

	return lines.join("\n");
}

function renderSubmitted<T>(
	state: MultifilterState<T>,
	_value: T[],
	theme: PromptTheme,
	message: string | undefined,
): string {
	const prefix = theme.success(PREFIX_SUBMITTED);
	const msg = theme.message(message ?? "Search and select");
	const selectedLabels = state.choices
		.filter((_, i) => state.selected.has(i))
		.map((choice) => choice.label)
		.join(", ");

	return formatSubmitted(prefix, msg, theme.success(selectedLabels));
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Display an interactive fuzzy-filter prompt with checkbox-style multi-selection.
 *
 * Type to filter the list using fuzzy matching. Navigate filtered results with
 * Up/Down arrows, toggle the highlighted item with Space, and confirm with
 * Enter. Matched characters are highlighted in the results.
 *
 * If `initial` is provided, the prompt is skipped and the values are returned
 * immediately.
 *
 * In non-interactive environments (no TTY), the `default` values are returned
 * automatically if provided.
 */
// Narrowing overload — see `select` for the pattern rationale.
export function multifilter<const C extends readonly Choice<unknown>[]>(
	options: MultifilterOptions<ChoiceValue<C>> & { readonly choices: C },
	io?: PromptIO,
): Promise<ChoiceValue<C>[]>;
export function multifilter<T>(options: MultifilterOptions<T>, io?: PromptIO): Promise<T[]>;
export async function multifilter<T>(options: MultifilterOptions<T>, io?: PromptIO): Promise<T[]> {
	if (options.initial !== undefined) {
		return [...options.initial];
	}

	const promptIO = resolvePromptIO(io);

	if (!isTTY(promptIO.input) && options.default !== undefined) {
		return [...options.default];
	}

	const theme = resolveTheme(options.theme);
	const maxVisible = options.maxVisible ?? DEFAULT_MAX_VISIBLE;
	const choices = normalizeChoices(options.choices);
	const results = fuzzyFilter("", choices);

	const selected = new Set<number>();
	if (options.default) {
		for (const defaultValue of options.default) {
			const idx = choices.findIndex((choice) => choice.value === defaultValue);
			if (idx !== -1) {
				selected.add(idx);
			}
		}
	}

	let listCursor = 0;
	if (options.default && options.default.length > 0) {
		const idx = results.findIndex((result) => result.item.value === options.default?.[0]);
		if (idx !== -1) {
			listCursor = idx;
		}
	}

	const scrollOffset = calculateScrollOffset(listCursor, 0, results.length, maxVisible);

	const initialState: MultifilterState<T> = {
		query: "",
		cursorPos: 0,
		choices,
		results,
		listCursor,
		scrollOffset,
		selected,
		error: null,
	};

	return runPrompt<MultifilterState<T>, T[]>(
		{
			initialState,
			theme,
			render: (state, resolvedTheme) =>
				renderMultifilter(state, resolvedTheme, options.message, options.placeholder, maxVisible),
			handleKey: createHandleKey<T>(maxVisible, options.required, options.min, options.max),
			renderSubmitted: (state, value, resolvedTheme) =>
				renderSubmitted(state, value, resolvedTheme, options.message),
		},
		promptIO,
	);
}
