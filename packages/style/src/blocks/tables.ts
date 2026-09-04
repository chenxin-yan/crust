// ────────────────────────────────────────────────────────────────────────────
// Tables — Column-aligned table rendering with visible width
// ────────────────────────────────────────────────────────────────────────────

import { stringWidth } from "../stringWidth.ts";
import { center, padEnd, padStart } from "../text/pad.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Horizontal alignment for a table column.
 */
export type ColumnAlignment = "left" | "right" | "center";

/**
 * Options for {@link table}.
 */
export interface TableOptions {
	/**
	 * Per-column alignment. If fewer alignments than columns are provided,
	 * remaining columns default to `"left"`. If omitted, all columns are
	 * left-aligned.
	 */
	align?: ColumnAlignment[];
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute the maximum visible width for each column across headers and rows.
 */
function computeColumnWidths(headers: string[], rows: string[][]): number[] {
	const columnCount = headers.length;
	const widths = Array<number>(columnCount).fill(0);

	for (const row of [headers, ...rows]) {
		for (let col = 0; col < columnCount; col++) {
			const cell = row[col];
			if (cell !== undefined) widths[col] = Math.max(widths[col]!, stringWidth(cell));
		}
	}

	return widths;
}

/**
 * Align a cell value within the given width using the specified alignment.
 */
function alignCell(value: string, width: number, alignment: ColumnAlignment): string {
	switch (alignment) {
		case "right":
			return padStart(value, width);
		case "center":
			return center(value, width);
		default:
			return padEnd(value, width);
	}
}

/**
 * Format a single row of cells into a bordered row string.
 */
function formatRow(cells: string[], columnWidths: number[], alignments: ColumnAlignment[]): string {
	const formattedCells = columnWidths.map((width, col) => {
		const cell = cells[col] ?? "";
		const alignment = alignments[col] ?? "left";
		return ` ${alignCell(cell, width, alignment)} `;
	});

	return `|${formattedCells.join("|")}|`;
}

/**
 * Generate a separator row using the given character.
 */
function formatSeparator(columnWidths: number[]): string {
	const segments = columnWidths.map((width) => "-".repeat(width + 2));
	return `|${segments.join("|")}|`;
}

// ────────────────────────────────────────────────────────────────────────────
// Table
// ────────────────────────────────────────────────────────────────────────────

/**
 * Format tabular data as an aligned, bordered table string.
 *
 * The table includes a header row, a separator row, and data rows.
 * Headers define the column count; row cells beyond the last header are dropped.
 * Column widths are computed from the visible width of all cell content
 * (ANSI escape sequences are excluded from width calculations), so styled
 * cell values align correctly.
 *
 * @param headers - The header row cells.
 * @param rows - The data rows (each row is an array of cell strings).
 * @param options - Formatting options.
 * @returns The formatted table as a single string.
 *
 * @example
 * ```ts
 * table(
 *   ["Name", "Age"],
 *   [
 *     ["Alice", "30"],
 *     ["Bob", "25"],
 *   ],
 * );
 * // "| Name  | Age |"
 * // "|-------|-----|"
 * // "| Alice | 30  |"
 * // "| Bob   | 25  |"
 * ```
 */
export function table(headers: string[], rows: string[][], options?: TableOptions): string {
	const alignments = options?.align ?? [];
	const columnWidths = computeColumnWidths(headers, rows);

	const lines: string[] = [];

	// Header row
	lines.push(formatRow(headers, columnWidths, alignments));

	// Separator row
	lines.push(formatSeparator(columnWidths));

	// Data rows
	for (const row of rows) {
		lines.push(formatRow(row, columnWidths, alignments));
	}

	return lines.join("\n");
}
