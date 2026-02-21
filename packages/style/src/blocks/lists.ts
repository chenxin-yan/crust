// ────────────────────────────────────────────────────────────────────────────
// Lists — Unordered, ordered, and task-list block helpers
// ────────────────────────────────────────────────────────────────────────────

import { visibleWidth } from "../text/width.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for {@link unorderedList}.
 */
export interface UnorderedListOptions {
	/**
	 * The bullet marker character.
	 *
	 * @default "•"
	 */
	marker?: string;

	/**
	 * Number of spaces between the marker and item content.
	 *
	 * @default 1
	 */
	markerGap?: number;

	/**
	 * Base indentation (number of leading spaces) for the entire list.
	 *
	 * @default 0
	 */
	indent?: number;
}

/**
 * Options for {@link orderedList}.
 */
export interface OrderedListOptions {
	/**
	 * The starting index for numbering.
	 *
	 * @default 1
	 */
	start?: number;

	/**
	 * Number of spaces between the marker (e.g. `1.`) and item content.
	 *
	 * @default 1
	 */
	markerGap?: number;

	/**
	 * Base indentation (number of leading spaces) for the entire list.
	 *
	 * @default 0
	 */
	indent?: number;
}

/**
 * A single task-list item with a checked/unchecked state.
 */
export interface TaskListItem {
	/** The text content of the item. */
	text: string;
	/** Whether the item is checked (complete). */
	checked: boolean;
}

/**
 * Options for {@link taskList}.
 */
export interface TaskListOptions {
	/**
	 * The marker shown for checked items.
	 *
	 * @default "[x]"
	 */
	checkedMarker?: string;

	/**
	 * The marker shown for unchecked items.
	 *
	 * @default "[ ]"
	 */
	uncheckedMarker?: string;

	/**
	 * Number of spaces between the marker and item content.
	 *
	 * @default 1
	 */
	markerGap?: number;

	/**
	 * Base indentation (number of leading spaces) for the entire list.
	 *
	 * @default 0
	 */
	indent?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Indent continuation lines of a multiline item so content aligns
 * under the first line's content (after the marker).
 *
 * @param text - The item text (may contain `\n`).
 * @param contentIndent - Number of columns for continuation-line leading spaces.
 * @returns The text with continuation lines indented.
 */
function indentMultiline(text: string, contentIndent: number): string {
	const lines = text.split("\n");
	if (lines.length <= 1) {
		return text;
	}

	const padding = " ".repeat(contentIndent);
	return lines
		.map((line, idx) => (idx === 0 ? line : padding + line))
		.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Unordered List
// ────────────────────────────────────────────────────────────────────────────

/**
 * Format an array of strings as an unordered (bullet) list.
 *
 * Multiline items have continuation lines indented to align under the
 * first line's content (after the marker). The marker's visible width
 * is used for alignment so ANSI-styled markers work correctly.
 *
 * @param items - The list items (may contain `\n` for multiline content).
 * @param options - Formatting options.
 * @returns The formatted list as a single string.
 *
 * @example
 * ```ts
 * unorderedList(["alpha", "beta", "gamma"]);
 * // "• alpha\n• beta\n• gamma"
 *
 * unorderedList(["first\nsecond line"], { marker: "-" });
 * // "- first\n  second line"
 * ```
 */
export function unorderedList(
	items: string[],
	options?: UnorderedListOptions,
): string {
	const marker = options?.marker ?? "\u2022";
	const markerGap = options?.markerGap ?? 1;
	const indent = options?.indent ?? 0;

	const prefix = " ".repeat(indent);
	const gap = " ".repeat(markerGap);
	const markerWidth = visibleWidth(marker);
	const contentIndent = indent + markerWidth + markerGap;

	return items
		.map((item) => {
			const adjusted = indentMultiline(item, contentIndent);
			return `${prefix}${marker}${gap}${adjusted}`;
		})
		.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Ordered List
// ────────────────────────────────────────────────────────────────────────────

/**
 * Format an array of strings as an ordered (numbered) list.
 *
 * Marker width is computed from the widest index in the sequence so that
 * items align correctly for sequences including 1 through 100+. For example,
 * a 3-item list starting at 1 uses markers `1.`, `2.`, `3.` (all width 2),
 * while a 10-item list right-pads `1.` through `9.` to match `10.` width.
 *
 * Multiline items have continuation lines indented to align under the
 * first line's content (after the marker).
 *
 * @param items - The list items (may contain `\n` for multiline content).
 * @param options - Formatting options.
 * @returns The formatted list as a single string.
 *
 * @example
 * ```ts
 * orderedList(["alpha", "beta", "gamma"]);
 * // "1. alpha\n2. beta\n3. gamma"
 *
 * orderedList(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
 * // " 1. a\n 2. b\n ... \n10. j"
 * ```
 */
export function orderedList(
	items: string[],
	options?: OrderedListOptions,
): string {
	const start = options?.start ?? 1;
	const markerGap = options?.markerGap ?? 1;
	const indent = options?.indent ?? 0;

	if (items.length === 0) {
		return "";
	}

	const prefix = " ".repeat(indent);
	const gap = " ".repeat(markerGap);

	// Compute the widest marker text to ensure alignment.
	// The widest is always the last index: `<lastIndex>.`
	const lastIndex = start + items.length - 1;
	const maxMarkerWidth = `${lastIndex}.`.length;

	return items
		.map((item, idx) => {
			const index = start + idx;
			const markerText = `${index}.`;
			// Right-pad the marker so narrower numbers align with wider ones
			const paddedMarker = markerText.padStart(maxMarkerWidth, " ");
			const contentIndent = indent + maxMarkerWidth + markerGap;
			const adjusted = indentMultiline(item, contentIndent);
			return `${prefix}${paddedMarker}${gap}${adjusted}`;
		})
		.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Task List
// ────────────────────────────────────────────────────────────────────────────

/**
 * Format an array of task items as a checkbox-style task list.
 *
 * Each item is prefixed with a checked or unchecked marker. Multiline
 * items have continuation lines indented to align under the first line's
 * content (after the marker).
 *
 * @param items - The task list items with `text` and `checked` fields.
 * @param options - Formatting options.
 * @returns The formatted task list as a single string.
 *
 * @example
 * ```ts
 * taskList([
 *   { text: "Buy milk", checked: true },
 *   { text: "Write tests", checked: false },
 * ]);
 * // "[x] Buy milk\n[ ] Write tests"
 * ```
 */
export function taskList(
	items: TaskListItem[],
	options?: TaskListOptions,
): string {
	const checkedMarker = options?.checkedMarker ?? "[x]";
	const uncheckedMarker = options?.uncheckedMarker ?? "[ ]";
	const markerGap = options?.markerGap ?? 1;
	const indent = options?.indent ?? 0;

	const prefix = " ".repeat(indent);
	const gap = " ".repeat(markerGap);

	// Use the wider marker width for consistent alignment
	const markerWidth = Math.max(
		visibleWidth(checkedMarker),
		visibleWidth(uncheckedMarker),
	);
	const contentIndent = indent + markerWidth + markerGap;

	return items
		.map((item) => {
			const marker = item.checked ? checkedMarker : uncheckedMarker;
			const adjusted = indentMultiline(item.text, contentIndent);
			return `${prefix}${marker}${gap}${adjusted}`;
		})
		.join("\n");
}
