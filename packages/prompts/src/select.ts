// ────────────────────────────────────────────────────────────────────────────
// Select — Single selection from a list of choices for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

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
	readonly message: string;
	/** List of choices — strings or `{ label, value, hint? }` objects */
	readonly choices: readonly Choice<T>[];
	/** Default value — sets the initial cursor position to the matching choice */
	readonly default?: T;
	/** Initial value — if provided, the prompt is skipped and this value is returned immediately */
	readonly initial?: T;
	/** Maximum number of visible choices before scrolling (defaults to 10) */
	readonly maxVisible?: number;
	/** Per-prompt theme overrides */
	readonly theme?: PartialPromptTheme;
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_VISIBLE = 10;
const PREFIX_SYMBOL = "?";
const CURSOR_INDICATOR = ">";
const SCROLL_UP_INDICATOR = "...";
const SCROLL_DOWN_INDICATOR = "...";

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────

interface SelectState<T> {
	readonly cursor: number;
	readonly choices: readonly NormalizedChoice<T>[];
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
// Keypress handler
// ────────────────────────────────────────────────────────────────────────────

function createHandleKey<T>(
	maxVisible: number,
): (
	key: KeypressEvent,
	state: SelectState<T>,
) => SelectState<T> | { readonly submit: T } {
	return (key, state) => {
		const totalItems = state.choices.length;

		// Enter — submit currently highlighted item
		if (key.name === "return") {
			const selected = state.choices[state.cursor];
			if (selected) {
				return { submit: selected.value };
			}
			return state;
		}

		// Up arrow or k — move cursor up with wrapping
		if (key.name === "up" || key.name === "k") {
			const newCursor = state.cursor <= 0 ? totalItems - 1 : state.cursor - 1;
			const newScrollOffset = calculateScrollOffset(
				newCursor,
				state.scrollOffset,
				totalItems,
				maxVisible,
			);
			return { ...state, cursor: newCursor, scrollOffset: newScrollOffset };
		}

		// Down arrow or j — move cursor down with wrapping
		if (key.name === "down" || key.name === "j") {
			const newCursor = state.cursor >= totalItems - 1 ? 0 : state.cursor + 1;
			const newScrollOffset = calculateScrollOffset(
				newCursor,
				state.scrollOffset,
				totalItems,
				maxVisible,
			);
			return { ...state, cursor: newCursor, scrollOffset: newScrollOffset };
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
	message: string,
	maxVisible: number,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message);
	const totalItems = state.choices.length;
	const visibleCount = Math.min(totalItems, maxVisible);

	const lines: string[] = [`${prefix} ${msg}`];

	// Show scroll-up indicator if items are hidden above
	const hasScrollUp = state.scrollOffset > 0;
	if (hasScrollUp) {
		lines.push(theme.hint(SCROLL_UP_INDICATOR));
	}

	// Render visible choices
	for (let i = 0; i < visibleCount; i++) {
		const choiceIndex = state.scrollOffset + i;
		const choice = state.choices[choiceIndex];
		if (!choice) break;

		const isActive = choiceIndex === state.cursor;
		const hintText = choice.hint ? ` ${theme.hint(choice.hint)}` : "";

		if (isActive) {
			lines.push(
				`${theme.cursor(CURSOR_INDICATOR)} ${theme.selected(choice.label)}${hintText}`,
			);
		} else {
			lines.push(`  ${theme.unselected(choice.label)}${hintText}`);
		}
	}

	// Show scroll-down indicator if items are hidden below
	const hasScrollDown = state.scrollOffset + visibleCount < totalItems;
	if (hasScrollDown) {
		lines.push(theme.hint(SCROLL_DOWN_INDICATOR));
	}

	return lines.join("\n");
}

function renderSubmitted<T>(
	_state: SelectState<T>,
	_value: T,
	theme: PromptTheme,
	message: string,
	choices: readonly NormalizedChoice<T>[],
	cursor: number,
): string {
	const prefix = theme.prefix(PREFIX_SYMBOL);
	const msg = theme.message(message);
	const selected = choices[cursor];
	const label = selected ? selected.label : "";
	return `${prefix} ${msg} ${theme.success(label)}`;
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
 * @param options - Select prompt configuration
 * @returns The value of the selected choice
 * @throws {NonInteractiveError} when stdin is not a TTY and no `initial` is provided
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
export async function select<T>(options: SelectOptions<T>): Promise<T> {
	// Short-circuit: return initial value immediately without rendering
	if (options.initial !== undefined) {
		return options.initial;
	}

	const theme = resolveTheme(undefined, options.theme);
	const maxVisible = options.maxVisible ?? DEFAULT_MAX_VISIBLE;
	const choices = normalizeChoices(options.choices);

	// Find initial cursor position from default value
	let initialCursor = 0;
	if (options.default !== undefined) {
		const idx = choices.findIndex((c) => c.value === options.default);
		if (idx !== -1) {
			initialCursor = idx;
		}
	}

	// Calculate initial scroll offset to keep cursor visible
	const initialScrollOffset = calculateScrollOffset(
		initialCursor,
		0,
		choices.length,
		maxVisible,
	);

	const initialState: SelectState<T> = {
		cursor: initialCursor,
		choices,
		scrollOffset: initialScrollOffset,
	};

	return runPrompt<SelectState<T>, T>({
		initialState,
		theme,
		render: (state, t) => renderSelect(state, t, options.message, maxVisible),
		handleKey: createHandleKey<T>(maxVisible),
		renderSubmitted: (state, value, t) =>
			renderSubmitted(state, value, t, options.message, choices, state.cursor),
	});
}
