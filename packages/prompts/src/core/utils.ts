// ────────────────────────────────────────────────────────────────────────────
// Utils — Shared utilities for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import type { Choice } from "./types.ts";

/**
 * Format the submitted line for a prompt.
 *
 * Produces `"prefix message value"`, `"prefix value"`, `"prefix message"`,
 * or just `"prefix"` depending on which parts are present — ensuring clean
 * spacing with no trailing spaces or `"undefined"`.
 *
 * @param prefix - Themed prefix string (e.g., styled "✔")
 * @param message - Optional themed message string
 * @param value - Optional themed submitted value string
 * @returns Formatted submitted line
 */
export function formatSubmitted(prefix: string, message?: string, value?: string): string {
	const parts = [prefix];
	if (message) parts.push(message);
	if (value) parts.push(value);
	return parts.join(" ");
}

/**
 * Format the prompt header together with inline content.
 *
 * When a message is present, the content goes on an indented line below:
 * ```
 * prefix message
 *   content
 * ```
 *
 * When the message is absent, the content sits on the same line as the prefix:
 * ```
 * prefix content
 * ```
 *
 * An optional `suffix` (e.g., a default-value hint) is appended to the
 * header portion before the content line.
 *
 * @param prefix - Themed prefix string (e.g., styled "▸")
 * @param message - Optional themed message string
 * @param content - The inline content (input value, placeholder, toggles, etc.)
 * @param suffix - Optional text appended after the header (e.g., default hint)
 * @returns Formatted prompt line(s)
 */
export function formatPromptLine(
	prefix: string,
	message: string | undefined,
	content: string,
	suffix?: string,
): string {
	const header = message ? `${prefix} ${message}` : prefix;
	const extra = suffix ?? "";
	if (message) {
		return `${header}${extra}\n  ${content}`;
	}
	return `${header}${extra} ${content}`;
}

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

/** @internal Move a list cursor with wrapping and keep it visible. */
export function moveCursor(
	cursor: number,
	totalItems: number,
	delta: -1 | 1,
	scrollOffset: number,
	maxVisible: number,
): { cursor: number; scrollOffset: number } {
	const nextCursor =
		delta === -1
			? cursor <= 0
				? totalItems - 1
				: cursor - 1
			: cursor >= totalItems - 1
				? 0
				: cursor + 1;
	return {
		cursor: nextCursor,
		scrollOffset: calculateScrollOffset(nextCursor, scrollOffset, totalItems, maxVisible),
	};
}

/** @internal Validate required/min/max constraints shared by multi-selection prompts. */
export function validateSelection(
	selectedCount: number,
	required?: boolean,
	min?: number,
	max?: number,
): string | null {
	if (required && selectedCount === 0) return "At least one item must be selected";
	if (min !== undefined && selectedCount < min) {
		return `Select at least ${min} item${min === 1 ? "" : "s"}`;
	}
	if (max !== undefined && selectedCount > max) {
		return `Select at most ${max} item${max === 1 ? "" : "s"}`;
	}
	return null;
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
export function normalizeChoices<T>(choices: readonly Choice<T>[]): NormalizedChoice<T>[] {
	return choices.map((choice) => {
		if (typeof choice === "string") {
			return { label: choice, value: choice as T };
		}
		return choice;
	});
}
