// ────────────────────────────────────────────────────────────────────────────
// Filter — Fuzzy-search interactive filter prompt for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { FuzzyFilterResult } from "./fuzzy.ts";
import { fuzzyFilter } from "./fuzzy.ts";
import type { KeypressEvent } from "./renderer.ts";
import { runPrompt } from "./renderer.ts";
import { resolveTheme } from "./theme.ts";
import type { Choice, PartialPromptTheme, PromptTheme } from "./types.ts";
import type { NormalizedChoice } from "./utils.ts";
import { normalizeChoices } from "./utils.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for the {@link filter} prompt.
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
export interface FilterOptions<T> {
	/** The prompt message displayed to the user */
	readonly message: string;
	/** List of choices — strings or `{ label, value, hint? }` objects */
	readonly choices: readonly Choice<T>[];
	/** Initial value — if provided, the prompt is skipped and this value is returned immediately */
	readonly initial?: T;
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
const PREFIX_SYMBOL = "?";
const CURSOR_CHAR = "\u2502"; // │ — thin vertical bar as cursor indicator
const LIST_CURSOR_INDICATOR = ">";
const SCROLL_UP_INDICATOR = "...";
const SCROLL_DOWN_INDICATOR = "...";

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

// ────────────────────────────────────────────────────────────────────────────
// Viewport scrolling
// ────────────────────────────────────────────────────────────────────────────

/**
 * Calculate the scroll offset to keep the cursor within the visible viewport.
 */
function calculateScrollOffset(
	cursor: number,
	scrollOffset: number,
	totalItems: number,
	maxVisible: number,
): number {
	const visibleCount = Math.min(totalItems, maxVisible);

	// Cursor moved above the viewport — scroll up
	if (cursor < scrollOffset) {
		return cursor;
	}

	// Cursor moved below the viewport — scroll down
	if (cursor >= scrollOffset + visibleCount) {
		return cursor - visibleCount + 1;
	}

	return scrollOffset;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Keypress handler
// ────────────────────────────────────────────────────────────────────────────

function createHandleKey<T>(
	maxVisible: number,
): (
	key: KeypressEvent,
	state: FilterState<T>,
) => FilterState<T> | { readonly submit: T } {
	return (key, state) => {
		// Enter — submit the currently highlighted item
		if (key.name === "return") {
			const result = state.results[state.listCursor];
			if (result) {
				return { submit: result.item.value };
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

		// Backspace — delete character before cursor in query
		if (key.name === "backspace") {
			if (state.cursorPos === 0) return state;
			const before = state.query.slice(0, state.cursorPos - 1);
			const after = state.query.slice(state.cursorPos);
			const newState: FilterState<T> = {
				...state,
				query: before + after,
				cursorPos: state.cursorPos - 1,
			};
			return refilter(newState, maxVisible);
		}

		// Delete — delete character at cursor in query
		if (key.name === "delete") {
			if (state.cursorPos >= state.query.length) return state;
			const before = state.query.slice(0, state.cursorPos);
			const after = state.query.slice(state.cursorPos + 1);
			const newState: FilterState<T> = {
				...state,
				query: before + after,
			};
			return refilter(newState, maxVisible);
		}

		// Left arrow — move query cursor left
		if (key.name === "left") {
			if (state.cursorPos === 0) return state;
			return { ...state, cursorPos: state.cursorPos - 1 };
		}

		// Right arrow — move query cursor right
		if (key.name === "right") {
			if (state.cursorPos >= state.query.length) return state;
			return { ...state, cursorPos: state.cursorPos + 1 };
		}

		// Home — jump to start of query
		if (key.name === "home") {
			return { ...state, cursorPos: 0 };
		}

		// End — jump to end of query
		if (key.name === "end") {
			return { ...state, cursorPos: state.query.length };
		}

		// Printable character — insert at cursor position in query
		if (key.char.length === 1 && !key.ctrl && !key.meta) {
			const before = state.query.slice(0, state.cursorPos);
			const after = state.query.slice(state.cursorPos);
			const newState: FilterState<T> = {
				...state,
				query: before + key.char + after,
				cursorPos: state.cursorPos + 1,
			};
			return refilter(newState, maxVisible);
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
	message: string,
	placeholder: string | undefined,
	maxVisible: number,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message);

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

	const lines: string[] = [`${prefix} ${msg}`, queryLine];

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
			lines.push(
				`${theme.cursor(LIST_CURSOR_INDICATOR)} ${theme.selected(label)}`,
			);
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

function renderSubmitted<T>(
	_state: FilterState<T>,
	_value: T,
	theme: PromptTheme,
	message: string,
	results: readonly FuzzyFilterResult<T>[],
	listCursor: number,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message);
	const selected = results[listCursor];
	const label = selected ? selected.item.label : "";
	return `${prefix} ${msg} ${theme.success(label)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Display an interactive fuzzy-filter prompt over a list of choices.
 *
 * Type to filter the list using fuzzy matching. Navigate filtered results
 * with Up/Down arrows, confirm with Enter. Matched characters are
 * highlighted in the results.
 *
 * If `initial` is provided, the prompt is skipped and the value is returned
 * immediately — useful for prefilling from CLI flags.
 *
 * @param options - Filter prompt configuration
 * @returns The value of the selected choice
 * @throws {NonInteractiveError} when stdin is not a TTY and no `initial` is provided
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
 */
export async function filter<T>(options: FilterOptions<T>): Promise<T> {
	// Short-circuit: return initial value immediately without rendering
	if (options.initial !== undefined) {
		return options.initial;
	}

	const theme = resolveTheme(undefined, options.theme);
	const maxVisible = options.maxVisible ?? DEFAULT_MAX_VISIBLE;
	const choices = normalizeChoices(options.choices);

	// Initial results: all items (empty query matches everything)
	const initialResults = fuzzyFilter("", choices);

	const initialState: FilterState<T> = {
		query: "",
		cursorPos: 0,
		choices,
		results: initialResults,
		listCursor: 0,
		scrollOffset: 0,
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
