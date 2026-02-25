// ────────────────────────────────────────────────────────────────────────────
// Multiselect — Checkbox-style multi selection from a list for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { KeypressEvent, SubmitResult } from "../core/renderer.ts";
import { runPrompt, submit } from "../core/renderer.ts";
import {
	CHECKBOX_CHECKED,
	CHECKBOX_UNCHECKED,
	CURSOR_INDICATOR,
	PREFIX_SUBMITTED,
	PREFIX_SYMBOL,
	SCROLL_DOWN_INDICATOR,
	SCROLL_UP_INDICATOR,
} from "../core/symbols.ts";
import { resolveTheme } from "../core/theme.ts";
import type { Choice, PartialPromptTheme, PromptTheme } from "../core/types.ts";
import type { NormalizedChoice } from "../core/utils.ts";
import {
	calculateScrollOffset,
	formatHeader,
	formatSubmitted,
	normalizeChoices,
} from "../core/utils.ts";

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
	/** Maximum number of visible choices before scrolling (defaults to 10) */
	readonly maxVisible?: number;
	/** Per-prompt theme overrides */
	readonly theme?: PartialPromptTheme;
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_VISIBLE = 10;
const HINT_LINE =
	"(Space to toggle, a to toggle all, i to invert, Enter to confirm)";

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
// Validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validate the current selection against required/min/max constraints.
 * Returns `null` if valid, or an error message string if invalid.
 */
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
// Keypress handler
// ────────────────────────────────────────────────────────────────────────────

function createHandleKey<T>(
	maxVisible: number,
	required?: boolean,
	min?: number,
	max?: number,
): (
	key: KeypressEvent,
	state: MultiselectState<T>,
) => MultiselectState<T> | SubmitResult<T[]> {
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

		// Up arrow or k — move cursor up with wrapping
		if (key.name === "up" || key.name === "k") {
			const newCursor = state.cursor <= 0 ? totalItems - 1 : state.cursor - 1;
			const newScrollOffset = calculateScrollOffset(
				newCursor,
				state.scrollOffset,
				totalItems,
				maxVisible,
			);
			return {
				...state,
				cursor: newCursor,
				scrollOffset: newScrollOffset,
				error: null,
			};
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
			return {
				...state,
				cursor: newCursor,
				scrollOffset: newScrollOffset,
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
	const totalItems = state.choices.length;
	const visibleCount = Math.min(totalItems, maxVisible);

	const lines: string[] = [formatHeader(prefix, msg)];

	// Show hint line with keybinding instructions
	lines.push(theme.hint(HINT_LINE));

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
		const isChecked = state.selected.has(choiceIndex);
		const checkbox = isChecked
			? theme.success(CHECKBOX_CHECKED)
			: CHECKBOX_UNCHECKED;
		const hintText = choice.hint ? ` ${theme.hint(choice.hint)}` : "";

		if (isActive) {
			lines.push(
				`${theme.cursor(CURSOR_INDICATOR)} ${checkbox} ${theme.selected(choice.label)}${hintText}`,
			);
		} else {
			lines.push(`  ${checkbox} ${theme.unselected(choice.label)}${hintText}`);
		}
	}

	// Show scroll-down indicator if items are hidden below
	const hasScrollDown = state.scrollOffset + visibleCount < totalItems;
	if (hasScrollDown) {
		lines.push(theme.hint(SCROLL_DOWN_INDICATOR));
	}

	// Show error message if validation failed
	if (state.error) {
		lines.push(theme.error(state.error));
	}

	return lines.join("\n");
}

function renderSubmitted<T>(
	_state: MultiselectState<T>,
	_value: T[],
	theme: PromptTheme,
	message: string | undefined,
	choices: readonly NormalizedChoice<T>[],
	selected: ReadonlySet<number>,
): string {
	const prefix = theme.success(PREFIX_SUBMITTED);
	const msg = theme.message(message ?? "Pick one or more");
	const selectedLabels = choices
		.filter((_, i) => selected.has(i))
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
 * @param options - Multiselect prompt configuration
 * @returns Array of selected values
 * @throws {NonInteractiveError} when stdin is not a TTY and no `initial` is provided
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
export async function multiselect<T>(
	options: MultiselectOptions<T>,
): Promise<T[]> {
	// Short-circuit: return initial value immediately without rendering
	if (options.initial !== undefined) {
		return [...options.initial];
	}

	const theme = resolveTheme(options.theme);
	const maxVisible = options.maxVisible ?? DEFAULT_MAX_VISIBLE;
	const choices = normalizeChoices(options.choices);

	// Pre-select items matching default values
	const initialSelected = new Set<number>();
	if (options.default) {
		for (const defaultValue of options.default) {
			const idx = choices.findIndex((c) => c.value === defaultValue);
			if (idx !== -1) {
				initialSelected.add(idx);
			}
		}
	}

	const initialState: MultiselectState<T> = {
		cursor: 0,
		choices,
		selected: initialSelected,
		scrollOffset: 0,
		error: null,
	};

	return runPrompt<MultiselectState<T>, T[]>({
		initialState,
		theme,
		render: (state, t) =>
			renderMultiselect(state, t, options.message, maxVisible),
		handleKey: createHandleKey<T>(
			maxVisible,
			options.required,
			options.min,
			options.max,
		),
		renderSubmitted: (state, value, t) =>
			renderSubmitted(
				state,
				value,
				t,
				options.message,
				choices,
				state.selected,
			),
	});
}
