// ────────────────────────────────────────────────────────────────────────────
// Utils — Shared utilities for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { Choice } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Viewport scrolling
// ────────────────────────────────────────────────────────────────────────────

/**
 * Calculate the scroll offset to keep the cursor within the visible viewport.
 *
 * Used by select, multiselect, and filter prompts to manage scrolling
 * when the number of items exceeds the visible viewport.
 *
 * @param cursor - Current cursor position in the list
 * @param scrollOffset - Current scroll offset
 * @param totalItems - Total number of items in the list
 * @param maxVisible - Maximum number of visible items in the viewport
 * @returns The new scroll offset
 */
export function calculateScrollOffset(
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
// Normalized Choice
// ────────────────────────────────────────────────────────────────────────────

/**
 * A normalized choice item with explicit label, value, and optional hint.
 * This is the internal representation used by select, multiselect, and filter prompts.
 */
export interface NormalizedChoice<T> {
	readonly label: string;
	readonly value: T;
	readonly hint?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// normalizeChoices
// ────────────────────────────────────────────────────────────────────────────

/**
 * Normalize an array of choices into a consistent `{ label, value, hint? }` format.
 *
 * String choices are converted to `{ label: str, value: str }`.
 * Object choices are passed through as-is.
 *
 * @param choices - Array of string or object choices
 * @returns Array of normalized choice objects
 *
 * @example
 * ```ts
 * // String choices
 * normalizeChoices(["red", "green", "blue"]);
 * // => [{ label: "red", value: "red" }, { label: "green", value: "green" }, ...]
 *
 * // Object choices
 * normalizeChoices([{ label: "HTTP", value: 80 }]);
 * // => [{ label: "HTTP", value: 80 }]
 * ```
 */
export function normalizeChoices<T>(
	choices: readonly Choice<T>[],
): NormalizedChoice<T>[] {
	return choices.map((choice) => {
		if (typeof choice === "string") {
			return { label: choice, value: choice as T };
		}
		return choice;
	});
}
