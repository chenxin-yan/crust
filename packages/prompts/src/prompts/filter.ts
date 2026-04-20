// ────────────────────────────────────────────────────────────────────────────
// Filter — Fuzzy-search interactive filter prompt for @crustjs/prompts
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

/** Shared options for {@link filter} (single- and multi-select). */
interface FilterBaseOptions<T> {
	/** The prompt message displayed to the user */
	readonly message?: string;
	/** List of choices — strings or `{ label, value, hint? }` objects */
	readonly choices: readonly Choice<T>[];
	/** Placeholder text shown when the query input is empty */
	readonly placeholder?: string;
	/** Maximum number of visible filtered results before scrolling (defaults to 10) */
	readonly maxVisible?: number;
	/** Per-prompt theme overrides */
	readonly theme?: PartialPromptTheme;
}

/**
 * Options for the {@link filter} prompt (single selection).
 *
 * @example
 * ```ts
 * const lang = await filter({
 *   message: "Search for a language",
 *   choices: ["TypeScript", "JavaScript", "Rust", "Python", "Go"],
 * });
 * ```
 *
 * @example
 * ```ts
 * const pkg = await filter<{ name: string; version: string }>({
 *   message: "Find a package",
 *   choices: [
 *     { label: "react", value: { name: "react", version: "18.2" } },
 *     { label: "vue", value: { name: "vue", version: "3.3" } },
 *   ],
 *   placeholder: "Type to filter...",
 * });
 * ```
 */
export interface FilterOptions<T> extends FilterBaseOptions<T> {
	/** Initial value — if provided, the prompt is skipped and this value is returned immediately */
	readonly initial?: T;
	/** Default value — sets the initial cursor position to the matching choice. In non-interactive environments, this value is returned automatically */
	readonly default?: T;
}

/**
 * Options for {@link filter} when `multiple: true` — fuzzy search with checkbox-style multi-selection.
 */
export interface FilterMultipleOptions<T> extends FilterBaseOptions<T> {
	readonly multiple: true;
	/** Initial values — if provided, the prompt is skipped and these values are returned immediately (order preserved) */
	readonly initial?: readonly T[];
	/** Default selected values — pre-selects matching choices. In non-interactive environments, these values are returned automatically */
	readonly default?: readonly T[];
	/** Whether at least one item must be selected (defaults to false) */
	readonly required?: boolean;
	/** Minimum number of selections required */
	readonly min?: number;
	/** Maximum number of selections allowed */
	readonly max?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_VISIBLE = 10;
const HINT_LINE_MULTIPLE = "(Space to toggle, Enter to confirm)";

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────

interface FilterState<T> {
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
}

interface FilterMultiState<T> extends FilterState<T> {
	/** Indices into `choices` for selected items */
	readonly selected: ReadonlySet<number>;
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
		(c) => c.label === item.label && c.value === item.value,
	);
}

/**
 * Re-run the fuzzy filter on the current query and update results + cursor.
 */
function refilter<T>(
	state: FilterState<T>,
	maxVisible: number,
): FilterState<T> {
	const results = fuzzyFilter(state.query, state.choices);
	// Reset list cursor to 0 when results change (query was edited)
	const listCursor = 0;
	const scrollOffset = calculateScrollOffset(
		listCursor,
		0,
		results.length,
		maxVisible,
	);
	return { ...state, results, listCursor, scrollOffset };
}

function refilterMulti<T>(
	state: FilterMultiState<T>,
	maxVisible: number,
): FilterMultiState<T> {
	const next = refilter(state, maxVisible) as FilterMultiState<T>;
	return { ...next, selected: state.selected, error: null };
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

// ────────────────────────────────────────────────────────────────────────────
// Keypress handler — single select
// ────────────────────────────────────────────────────────────────────────────

function createHandleKey<T>(
	maxVisible: number,
): (
	key: KeypressEvent,
	state: FilterState<T>,
) => FilterState<T> | SubmitResult<T> {
	return (key, state) => {
		// Enter — submit the currently highlighted item
		if (key.name === "return") {
			const result = state.results[state.listCursor];
			if (result) {
				return submit(result.item.value);
			}
			// No results to select — ignore
			return state;
		}

		// Up arrow — move list cursor up with wrapping
		if (key.name === "up") {
			if (state.results.length === 0) return state;
			const totalItems = state.results.length;
			const newCursor =
				state.listCursor <= 0 ? totalItems - 1 : state.listCursor - 1;
			const newScrollOffset = calculateScrollOffset(
				newCursor,
				state.scrollOffset,
				totalItems,
				maxVisible,
			);
			return {
				...state,
				listCursor: newCursor,
				scrollOffset: newScrollOffset,
			};
		}

		// Down arrow — move list cursor down with wrapping
		if (key.name === "down") {
			if (state.results.length === 0) return state;
			const totalItems = state.results.length;
			const newCursor =
				state.listCursor >= totalItems - 1 ? 0 : state.listCursor + 1;
			const newScrollOffset = calculateScrollOffset(
				newCursor,
				state.scrollOffset,
				totalItems,
				maxVisible,
			);
			return {
				...state,
				listCursor: newCursor,
				scrollOffset: newScrollOffset,
			};
		}

		// Delegate text-editing keys to shared handler
		const edit = handleTextEdit(key, state.query, state.cursorPos);
		if (edit) {
			const queryChanged = edit.text !== state.query;
			const newState: FilterState<T> = {
				...state,
				query: edit.text,
				cursorPos: edit.cursorPos,
			};
			// Re-filter only when the query text actually changed
			return queryChanged ? refilter(newState, maxVisible) : newState;
		}

		return state;
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Keypress handler — multi select
// ────────────────────────────────────────────────────────────────────────────

function createHandleKeyMulti<T>(
	maxVisible: number,
	required?: boolean,
	min?: number,
	max?: number,
): (
	key: KeypressEvent,
	state: FilterMultiState<T>,
) => FilterMultiState<T> | SubmitResult<T[]> {
	return (key, state) => {
		// Enter — submit selected values in choice order
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

		// Space — toggle selection on highlighted filtered result
		if (key.name === "space") {
			const result = state.results[state.listCursor];
			if (!result) return state;
			const idx = choiceIndex(state.choices, result.item);
			if (idx === -1) return state;
			const newSelected = new Set(state.selected);
			if (newSelected.has(idx)) {
				newSelected.delete(idx);
			} else if (max === undefined || newSelected.size < max) {
				newSelected.add(idx);
			}
			return { ...state, selected: newSelected, error: null };
		}

		// Up arrow — move list cursor up with wrapping
		if (key.name === "up") {
			if (state.results.length === 0) return state;
			const totalItems = state.results.length;
			const newCursor =
				state.listCursor <= 0 ? totalItems - 1 : state.listCursor - 1;
			const newScrollOffset = calculateScrollOffset(
				newCursor,
				state.scrollOffset,
				totalItems,
				maxVisible,
			);
			return {
				...state,
				listCursor: newCursor,
				scrollOffset: newScrollOffset,
				error: null,
			};
		}

		// Down arrow — move list cursor down with wrapping
		if (key.name === "down") {
			if (state.results.length === 0) return state;
			const totalItems = state.results.length;
			const newCursor =
				state.listCursor >= totalItems - 1 ? 0 : state.listCursor + 1;
			const newScrollOffset = calculateScrollOffset(
				newCursor,
				state.scrollOffset,
				totalItems,
				maxVisible,
			);
			return {
				...state,
				listCursor: newCursor,
				scrollOffset: newScrollOffset,
				error: null,
			};
		}

		const edit = handleTextEdit(key, state.query, state.cursorPos);
		if (edit) {
			const queryChanged = edit.text !== state.query;
			const newState: FilterMultiState<T> = {
				...state,
				query: edit.text,
				cursorPos: edit.cursorPos,
			};
			return queryChanged ? refilterMulti(newState, maxVisible) : newState;
		}

		return state;
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Render
// ────────────────────────────────────────────────────────────────────────────

/**
 * Highlight matched characters in a label using the theme's filterMatch style.
 */
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
			// Collect consecutive matched characters for batch styling
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

function renderFilter<T>(
	state: FilterState<T>,
	theme: PromptTheme,
	message: string | undefined,
	placeholder: string | undefined,
	maxVisible: number,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message ?? "Search and select");

	// Query input line
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

	const lines: string[] = [formatPromptLine(prefix, msg, queryLine)];

	// Filtered results list
	const totalResults = state.results.length;

	if (totalResults === 0 && state.query.length > 0) {
		lines.push(theme.hint("No matches"));
		return lines.join("\n");
	}

	const visibleCount = Math.min(totalResults, maxVisible);

	// Scroll-up indicator
	const hasScrollUp = state.scrollOffset > 0;
	if (hasScrollUp) {
		lines.push(theme.hint(SCROLL_UP_INDICATOR));
	}

	// Render visible results
	for (let i = 0; i < visibleCount; i++) {
		const resultIndex = state.scrollOffset + i;
		const result = state.results[resultIndex];
		if (!result) break;

		const isActive = resultIndex === state.listCursor;
		const label = highlightMatches(result.item.label, result.indices, theme);

		if (isActive) {
			lines.push(`${theme.cursor(CURSOR_INDICATOR)} ${theme.selected(label)}`);
		} else {
			lines.push(`  ${theme.unselected(label)}`);
		}
	}

	// Scroll-down indicator
	const hasScrollDown = state.scrollOffset + visibleCount < totalResults;
	if (hasScrollDown) {
		lines.push(theme.hint(SCROLL_DOWN_INDICATOR));
	}

	return lines.join("\n");
}

function renderFilterMulti<T>(
	state: FilterMultiState<T>,
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
		theme.hint(HINT_LINE_MULTIPLE),
	];

	const totalResults = state.results.length;

	if (totalResults === 0 && state.query.length > 0) {
		lines.push(theme.hint("No matches"));
		if (state.error) lines.push(theme.error(state.error));
		return lines.join("\n");
	}

	const visibleCount = Math.min(totalResults, maxVisible);

	const hasScrollUp = state.scrollOffset > 0;
	if (hasScrollUp) {
		lines.push(theme.hint(SCROLL_UP_INDICATOR));
	}

	for (let i = 0; i < visibleCount; i++) {
		const resultIndex = state.scrollOffset + i;
		const result = state.results[resultIndex];
		if (!result) break;

		const isActive = resultIndex === state.listCursor;
		const label = highlightMatches(result.item.label, result.indices, theme);
		const ci = choiceIndex(state.choices, result.item);
		const isChecked = ci !== -1 ? state.selected.has(ci) : false;
		const checkbox = isChecked
			? theme.success(CHECKBOX_CHECKED)
			: CHECKBOX_UNCHECKED;

		if (isActive) {
			lines.push(
				`${theme.cursor(CURSOR_INDICATOR)} ${checkbox} ${theme.selected(label)}`,
			);
		} else {
			lines.push(`  ${checkbox} ${theme.unselected(label)}`);
		}
	}

	const hasScrollDown = state.scrollOffset + visibleCount < totalResults;
	if (hasScrollDown) {
		lines.push(theme.hint(SCROLL_DOWN_INDICATOR));
	}

	if (state.error) {
		lines.push(theme.error(state.error));
	}

	return lines.join("\n");
}

function renderSubmitted<T>(
	_state: FilterState<T>,
	_value: T,
	theme: PromptTheme,
	message: string | undefined,
	results: readonly FuzzyFilterResult<T>[],
	listCursor: number,
): string {
	const prefix = theme.success(PREFIX_SUBMITTED);
	const msg = theme.message(message ?? "Search and select");
	const selected = results[listCursor];
	const label = selected ? selected.item.label : "";
	return formatSubmitted(prefix, msg, theme.success(label));
}

function renderSubmittedMulti<T>(
	_state: FilterMultiState<T>,
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
		.map((c) => c.label)
		.join(", ");
	return formatSubmitted(prefix, msg, theme.success(selectedLabels));
}

// ────────────────────────────────────────────────────────────────────────────
// Internal implementations
// ────────────────────────────────────────────────────────────────────────────

async function filterSingle<T>(options: FilterOptions<T>): Promise<T> {
	// Short-circuit: return initial value immediately without rendering
	if (options.initial !== undefined) {
		return options.initial;
	}

	// Non-interactive fallback: return default value when stdin is not a TTY
	if (!isTTY() && options.default !== undefined) {
		return options.default;
	}

	const theme = resolveTheme(options.theme);
	const maxVisible = options.maxVisible ?? DEFAULT_MAX_VISIBLE;
	const choices = normalizeChoices(options.choices);

	// Initial results: all items (empty query matches everything)
	const initialResults = fuzzyFilter("", choices);

	// Find initial cursor position from default value
	let initialListCursor = 0;
	if (options.default !== undefined) {
		const idx = initialResults.findIndex(
			(r) => r.item.value === options.default,
		);
		if (idx !== -1) {
			initialListCursor = idx;
		}
	}

	// Calculate initial scroll offset to keep cursor visible
	const initialScrollOffset = calculateScrollOffset(
		initialListCursor,
		0,
		initialResults.length,
		maxVisible,
	);

	const initialState: FilterState<T> = {
		query: "",
		cursorPos: 0,
		choices,
		results: initialResults,
		listCursor: initialListCursor,
		scrollOffset: initialScrollOffset,
	};

	return runPrompt<FilterState<T>, T>({
		initialState,
		theme,
		render: (state, t) =>
			renderFilter(state, t, options.message, options.placeholder, maxVisible),
		handleKey: createHandleKey<T>(maxVisible),
		renderSubmitted: (state, value, t) =>
			renderSubmitted(
				state,
				value,
				t,
				options.message,
				state.results,
				state.listCursor,
			),
	});
}

async function filterMultiple<T>(
	options: FilterMultipleOptions<T>,
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

	const initialResults = fuzzyFilter("", choices);

	const initialSelected = new Set<number>();
	if (options.default) {
		for (const defaultValue of options.default) {
			const idx = choices.findIndex((c) => c.value === defaultValue);
			if (idx !== -1) {
				initialSelected.add(idx);
			}
		}
	}

	let initialListCursor = 0;
	if (options.default !== undefined && options.default.length > 0) {
		const first = options.default[0];
		const idx = initialResults.findIndex((r) => r.item.value === first);
		if (idx !== -1) {
			initialListCursor = idx;
		}
	}

	const initialScrollOffset = calculateScrollOffset(
		initialListCursor,
		0,
		initialResults.length,
		maxVisible,
	);

	const initialState: FilterMultiState<T> = {
		query: "",
		cursorPos: 0,
		choices,
		results: initialResults,
		listCursor: initialListCursor,
		scrollOffset: initialScrollOffset,
		selected: initialSelected,
		error: null,
	};

	return runPrompt<FilterMultiState<T>, T[]>({
		initialState,
		theme,
		render: (state, t) =>
			renderFilterMulti(
				state,
				t,
				options.message,
				options.placeholder,
				maxVisible,
			),
		handleKey: createHandleKeyMulti<T>(
			maxVisible,
			options.required,
			options.min,
			options.max,
		),
		renderSubmitted: (state, value, t) =>
			renderSubmittedMulti(
				state,
				value,
				t,
				options.message,
				choices,
				state.selected,
			),
	});
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

function isFilterMultiple<T>(
	options: FilterOptions<T> | FilterMultipleOptions<T>,
): options is FilterMultipleOptions<T> {
	return "multiple" in options && options.multiple === true;
}

/**
 * Display an interactive fuzzy-filter prompt over a list of choices.
 *
 * Type to filter the list using fuzzy matching. Navigate filtered results
 * with Up/Down arrows, confirm with Enter. Matched characters are
 * highlighted in the results.
 *
 * With `{ multiple: true }`, use Space to toggle items and Enter to confirm
 * the selection (values are returned in original choice order).
 *
 * If `initial` is provided, the prompt is skipped and the value is returned
 * immediately — useful for prefilling from CLI flags.
 *
 * In non-interactive environments (no TTY), the `default` value is returned
 * automatically if provided.
 *
 * @param options - Filter prompt configuration
 * @returns The value of the selected choice, or an array when `multiple: true`
 * @throws {NonInteractiveError} when stdin is not a TTY and no `initial` or `default` is provided
 *
 * @example
 * ```ts
 * const lang = await filter({
 *   message: "Search for a language",
 *   choices: ["TypeScript", "JavaScript", "Rust", "Python", "Go"],
 * });
 * ```
 *
 * @example
 * ```ts
 * const pkg = await filter<{ name: string; version: string }>({
 *   message: "Find a package",
 *   choices: [
 *     { label: "react", value: { name: "react", version: "18.2" } },
 *     { label: "vue", value: { name: "vue", version: "3.3" } },
 *   ],
 *   placeholder: "Type to filter...",
 * });
 * ```
 *
 * @example
 * ```ts
 * // Skip prompt when flag is provided
 * const tool = await filter({
 *   message: "Pick a tool",
 *   choices: ["prettier", "eslint", "biome"],
 *   initial: flags.tool,
 * });
 * ```
 *
 * @example
 * ```ts
 * const langs = await filter({
 *   message: "Pick languages",
 *   multiple: true,
 *   choices: ["TypeScript", "JavaScript", "Rust"],
 * });
 * ```
 */
export async function filter<T>(options: FilterOptions<T>): Promise<T>;
export async function filter<T>(
	options: FilterMultipleOptions<T>,
): Promise<T[]>;
export async function filter<T>(
	options: FilterOptions<T> | FilterMultipleOptions<T>,
): Promise<T | T[]> {
	if (isFilterMultiple(options)) {
		return filterMultiple(options);
	}
	return filterSingle(options);
}
