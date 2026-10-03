// ────────────────────────────────────────────────────────────────────────────
// Filter — Fuzzy-search interactive filter prompt for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { FuzzyFilterResult } from "../core/fuzzy.ts";
import { fuzzyFilter, highlightMatches } from "../core/fuzzy.ts";
import { handleQueryListKey, setupListPrompt } from "../core/list.ts";
import type { KeypressEvent, PromptIO, SubmitResult } from "../core/renderer.ts";
import { runPrompt, submit } from "../core/renderer.ts";
import { CURSOR_INDICATOR, PREFIX_SUBMITTED, PREFIX_SYMBOL } from "../core/symbols.ts";
import { renderTextWithCursor } from "../core/text-edit.ts";
import type { Choice, ChoiceValue, PartialPromptTheme, PromptTheme } from "../core/types.ts";
import type { NormalizedChoice } from "../core/utils.ts";
import { formatPromptLine, formatSubmitted, renderChoiceList } from "../core/utils.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** Options for the {@link filter} prompt. */
export interface FilterOptions<T> {
	/** The prompt message displayed to the user */
	readonly message?: string;
	/** List of choices — strings or `{ label, value, hint? }` objects */
	readonly choices: readonly Choice<T>[];
	/** Initial value — if provided, the prompt is skipped and this value is returned immediately */
	readonly initial?: T;
	/** Default value — matches a choice using reference equality for object values. Returned automatically in non-interactive environments. */
	readonly default?: T;
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
// Keypress handler — single select
// ────────────────────────────────────────────────────────────────────────────

function createHandleKey<T>(
	maxVisible: number,
): (key: KeypressEvent, state: FilterState<T>) => FilterState<T> | SubmitResult<T> {
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

		return handleQueryListKey(key, state, maxVisible) ?? state;
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Render
// ────────────────────────────────────────────────────────────────────────────

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
	const queryLine = renderTextWithCursor(state.query, state.cursorPos, theme, placeholder);

	const lines: string[] = [formatPromptLine(prefix, msg, queryLine)];

	// Filtered results list
	const totalResults = state.results.length;

	if (totalResults === 0 && state.query.length > 0) {
		lines.push(theme.hint("No matches"));
		return lines.join("\n");
	}

	lines.push(
		...renderChoiceList(
			state.results,
			state.scrollOffset,
			maxVisible,
			(result, resultIndex) => {
				const hint = state.choices[state.choices.indexOf(result.item)]?.hint;
				const label = highlightMatches(result.item.label, result.indices, theme);
				const hintText = hint ? ` ${theme.hint(hint)}` : "";
				return resultIndex === state.listCursor
					? `${theme.cursor(CURSOR_INDICATOR)} ${theme.selected(label)}${hintText}`
					: `  ${theme.unselected(label)}${hintText}`;
			},
			theme.hint,
		),
	);

	return lines.join("\n");
}

function renderSubmitted<T>(
	state: FilterState<T>,
	theme: PromptTheme,
	message: string | undefined,
): string {
	const prefix = theme.success(PREFIX_SUBMITTED);
	const msg = theme.message(message ?? "Search and select");
	const selected = state.results[state.listCursor];
	const label = selected ? selected.item.label : "";
	return formatSubmitted(prefix, msg, theme.success(label));
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
 * In non-interactive environments (no TTY), the `default` value is returned
 * automatically if provided.
 *
 * @param options - Filter prompt configuration
 * @returns The value of the selected choice
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
 */
// Narrowing overloads — see `select` for the pattern rationale.
export function filter<const C extends readonly [Choice<unknown>, ...Choice<unknown>[]]>(
	options: FilterOptions<ChoiceValue<C>> & { readonly choices: C },
	io?: PromptIO,
): Promise<ChoiceValue<C>>;
export function filter(
	options: FilterOptions<string> & { readonly choices: readonly string[] },
	io?: PromptIO,
): Promise<string>;
export function filter<T>(options: FilterOptions<T>, io?: PromptIO): Promise<T>;
export async function filter<T>(options: FilterOptions<T>, io?: PromptIO): Promise<T> {
	const setup = await setupListPrompt<T, T>(
		options,
		options.default === undefined ? [] : [options.default],
		io,
	);
	if (setup.shortCircuited) return setup.value;

	const { choices, cursor, maxVisible, promptIO, scrollOffset } = setup;
	const initialState: FilterState<T> = {
		query: "",
		cursorPos: 0,
		choices,
		results: fuzzyFilter("", choices),
		listCursor: cursor,
		scrollOffset,
	};

	return runPrompt<FilterState<T>, T>(
		{
			initialState,
			theme: options.theme,
			render: (state, resolvedTheme) =>
				renderFilter(state, resolvedTheme, options.message, options.placeholder, maxVisible),
			handleKey: createHandleKey<T>(maxVisible),
			renderSubmitted: (state, _value, resolvedTheme) =>
				renderSubmitted(state, resolvedTheme, options.message),
		},
		promptIO,
	);
}
