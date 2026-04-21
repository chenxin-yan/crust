// ────────────────────────────────────────────────────────────────────────────
// Multifilter — Fuzzy-search multi selection for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { FuzzyFilterResult } from "../core/fuzzy.ts";
import { fuzzyFilter } from "../core/fuzzy.ts";
import type { KeypressEvent, SubmitResult } from "../core/renderer.ts";
import { isTTY, runPrompt, submit } from "../core/renderer.ts";
import {
	CHECKBOX_CHECKED,
	CHECKBOX_UNCHECKED,
	CURSOR_INDICATOR,
	PREFIX_SUBMITTED,
	PREFIX_SYMBOL,
	SCROLL_DOWN_INDICATOR,
	SCROLL_UP_INDICATOR,
} from "../core/symbols.ts";
import { CURSOR_CHAR, handleTextEdit } from "../core/textEdit.ts";
import { resolveTheme } from "../core/theme.ts";
import type { Choice, PartialPromptTheme, PromptTheme } from "../core/types.ts";
import type { NormalizedChoice } from "../core/utils.ts";
import {
	calculateScrollOffset,
	formatPromptLine,
	formatSubmitted,
	normalizeChoices,
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
	/** Whether at least one item must be selected (defaults to false) */
	readonly required?: boolean;
	/** Minimum number of selections required */
	readonly min?: number;
	/** Maximum number of selections allowed */
	readonly max?: number;
	/** Placeholder text shown when the query input is empty */
	readonly placeholder?: string;
	/** Maximum number of visible filtered results before scrolling (defaults to 10) */
	readonly maxVisible?: number;
	/** Per-prompt theme overrides */
	readonly theme?: PartialPromptTheme;
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_VISIBLE = 10;
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
	return choices.findIndex(
		(choice) => choice.label === item.label && choice.value === item.value,
	);
}

function validateSelection(
	selectedCount: number,
	required?: boolean,
	min?: number,
	max?: number,
): string | null {
	if (required && selectedCount === 0) {
		return "At least one item must be selected";
	}

	if (min !== undefined && selectedCount < min) {
		return `Select at least ${min} item${min === 1 ? "" : "s"}`;
	}

	if (max !== undefined && selectedCount > max) {
		return `Select at most ${max} item${max === 1 ? "" : "s"}`;
	}

	return null;
}

function refilter<T>(
	state: MultifilterState<T>,
	maxVisible: number,
): MultifilterState<T> {
	const results = fuzzyFilter(state.query, state.choices);
	const listCursor = 0;
	const scrollOffset = calculateScrollOffset(
		listCursor,
		0,
		results.length,
		maxVisible,
	);
	return { ...state, results, listCursor, scrollOffset, error: null };
}

function highlightMatches(
	label: string,
	indices: readonly number[],
	theme: PromptTheme,
): string {
	if (indices.length === 0) return label;

	const indexSet = new Set(indices);
	let result = "";
	let i = 0;

	while (i < label.length) {
		if (indexSet.has(i)) {
			let matchedChars = "";
			while (i < label.length && indexSet.has(i)) {
				matchedChars += label[i];
				i++;
			}
			result += theme.filterMatch(matchedChars);
		} else {
			result += label[i];
			i++;
		}
	}

	return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Keypress handler
// ────────────────────────────────────────────────────────────────────────────

function createHandleKey<T>(
	maxVisible: number,
	required?: boolean,
	min?: number,
	max?: number,
): (
	key: KeypressEvent,
	state: MultifilterState<T>,
) => MultifilterState<T> | SubmitResult<T[]> {
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

		if (key.name === "up") {
			if (state.results.length === 0) return state;
			const totalItems = state.results.length;
			const listCursor =
				state.listCursor <= 0 ? totalItems - 1 : state.listCursor - 1;
			const scrollOffset = calculateScrollOffset(
				listCursor,
				state.scrollOffset,
				totalItems,
				maxVisible,
			);
			return { ...state, listCursor, scrollOffset, error: null };
		}

		if (key.name === "down") {
			if (state.results.length === 0) return state;
			const totalItems = state.results.length;
			const listCursor =
				state.listCursor >= totalItems - 1 ? 0 : state.listCursor + 1;
			const scrollOffset = calculateScrollOffset(
				listCursor,
				state.scrollOffset,
				totalItems,
				maxVisible,
			);
			return { ...state, listCursor, scrollOffset, error: null };
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

	let queryLine: string;
	if (state.query === "") {
		if (placeholder) {
			queryLine = theme.placeholder(placeholder);
		} else {
			queryLine = theme.cursor(CURSOR_CHAR);
		}
	} else {
		const before = state.query.slice(0, state.cursorPos);
		const after = state.query.slice(state.cursorPos);
		queryLine = `${before}${theme.cursor(CURSOR_CHAR)}${after}`;
	}

	const lines: string[] = [
		formatPromptLine(prefix, msg, queryLine),
		theme.hint(HINT_LINE),
	];

	const totalResults = state.results.length;
	if (totalResults === 0 && state.query.length > 0) {
		lines.push(theme.hint("No matches"));
		if (state.error) {
			lines.push(theme.error(state.error));
		}
		return lines.join("\n");
	}

	const visibleCount = Math.min(totalResults, maxVisible);
	if (state.scrollOffset > 0) {
		lines.push(theme.hint(SCROLL_UP_INDICATOR));
	}

	for (let i = 0; i < visibleCount; i++) {
		const resultIndex = state.scrollOffset + i;
		const result = state.results[resultIndex];
		if (!result) break;

		const choiceIdx = choiceIndex(state.choices, result.item);
		const choice = choiceIdx === -1 ? undefined : state.choices[choiceIdx];
		const isActive = resultIndex === state.listCursor;
		const isChecked = choiceIdx !== -1 ? state.selected.has(choiceIdx) : false;
		const checkbox = isChecked
			? theme.success(CHECKBOX_CHECKED)
			: CHECKBOX_UNCHECKED;
		const label = highlightMatches(result.item.label, result.indices, theme);
		const hintText = choice?.hint ? ` ${theme.hint(choice.hint)}` : "";

		if (isActive) {
			lines.push(
				`${theme.cursor(CURSOR_INDICATOR)} ${checkbox} ${theme.selected(label)}${hintText}`,
			);
		} else {
			lines.push(`  ${checkbox} ${theme.unselected(label)}${hintText}`);
		}
	}

	if (state.scrollOffset + visibleCount < totalResults) {
		lines.push(theme.hint(SCROLL_DOWN_INDICATOR));
	}

	if (state.error) {
		lines.push(theme.error(state.error));
	}

	return lines.join("\n");
}

function renderSubmitted<T>(
	_state: MultifilterState<T>,
	_value: T[],
	theme: PromptTheme,
	message: string | undefined,
	choices: readonly NormalizedChoice<T>[],
	selected: ReadonlySet<number>,
): string {
	const prefix = theme.success(PREFIX_SUBMITTED);
	const msg = theme.message(message ?? "Search and select");
	const selectedLabels = choices
		.filter((_, i) => selected.has(i))
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
export async function multifilter<T>(
	options: MultifilterOptions<T>,
): Promise<T[]> {
	if (options.initial !== undefined) {
		return [...options.initial];
	}

	if (!isTTY() && options.default !== undefined) {
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
		const idx = results.findIndex(
			(result) => result.item.value === options.default?.[0],
		);
		if (idx !== -1) {
			listCursor = idx;
		}
	}

	const scrollOffset = calculateScrollOffset(
		listCursor,
		0,
		results.length,
		maxVisible,
	);

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

	return runPrompt<MultifilterState<T>, T[]>({
		initialState,
		theme,
		render: (state, resolvedTheme) =>
			renderMultifilter(
				state,
				resolvedTheme,
				options.message,
				options.placeholder,
				maxVisible,
			),
		handleKey: createHandleKey<T>(
			maxVisible,
			options.required,
			options.min,
			options.max,
		),
		renderSubmitted: (state, value, resolvedTheme) =>
			renderSubmitted(
				state,
				value,
				resolvedTheme,
				options.message,
				choices,
				state.selected,
			),
	});
}
