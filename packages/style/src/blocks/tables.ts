// ────────────────────────────────────────────────────────────────────────────
// Tables — Column-aligned table rendering with visible width
// ────────────────────────────────────────────────────────────────────────────

import { center, padEnd, padStart } from "../text/pad.ts";
import { visibleWidth } from "../text/width.ts";

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

	/**
	 * Minimum column width (in visible characters). Columns are always at
	 * least as wide as their widest cell content regardless of this setting.
	 *
	 * @default 0
	 */
	minColumnWidth?: number;

	/**
	 * Padding (number of spaces) added to each side of every cell.
	 *
	 * @default 1
	 */
	cellPadding?: number;

	/**
	 * The character used for the horizontal separator line.
	 *
	 * @default "-"
	 */
	separatorChar?: string;

	/**
	 * The column separator character placed between cells.
	 *
	 * @default "|"
	 */
	borderChar?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute the maximum visible width for each column across headers and rows.
 */
function computeColumnWidths(
	headers: string[],
	rows: string[][],
	minWidth: number,
): number[] {
	const columnCount = headers.length;
	const widths: number[] = new Array(columnCount).fill(minWidth) as number[];

	for (let col = 0; col < columnCount; col++) {
		const header = headers[col];
		if (header !== undefined) {
			widths[col] = Math.max(widths[col] ?? 0, visibleWidth(header));
		}
	}

	for (const row of rows) {
		for (let col = 0; col < columnCount; col++) {
			const cell = row[col];
			if (cell !== undefined) {
				widths[col] = Math.max(widths[col] ?? 0, visibleWidth(cell));
			}
		}
	}

	return widths;
}

/**
 * Align a cell value within the given width using the specified alignment.
 */
function alignCell(
	value: string,
	width: number,
	alignment: ColumnAlignment,
): string {
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
function formatRow(
	cells: string[],
	columnWidths: number[],
	alignments: ColumnAlignment[],
	cellPadding: number,
	borderChar: string,
): string {
	const pad = " ".repeat(cellPadding);
	const formattedCells = columnWidths.map((width, col) => {
		const cell = cells[col] ?? "";
		const alignment = alignments[col] ?? "left";
		const aligned = alignCell(cell, width, alignment);
		return `${pad}${aligned}${pad}`;
	});

	return `${borderChar}${formattedCells.join(borderChar)}${borderChar}`;
}

/**
 * Generate a separator row using the given character.
 */
function formatSeparator(
	columnWidths: number[],
	cellPadding: number,
	separatorChar: string,
	borderChar: string,
): string {
	const segments = columnWidths.map((width) => {
		// Fill: column width + padding on both sides
		return separatorChar.repeat(width + cellPadding * 2);
	});

	return `${borderChar}${segments.join(borderChar)}${borderChar}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Table
// ────────────────────────────────────────────────────────────────────────────

/**
 * Format tabular data as an aligned, bordered table string.
 *
 * The table includes a header row, a separator row, and data rows.
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
export function table(
	headers: string[],
	rows: string[][],
	options?: TableOptions,
): string {
	const alignments = options?.align ?? [];
	const minColumnWidth = options?.minColumnWidth ?? 0;
	const cellPadding = options?.cellPadding ?? 1;
	const separatorChar = options?.separatorChar ?? "-";
	const borderChar = options?.borderChar ?? "|";

	const columnWidths = computeColumnWidths(headers, rows, minColumnWidth);

	const lines: string[] = [];

	// Header row
	lines.push(
		formatRow(headers, columnWidths, alignments, cellPadding, borderChar),
	);

	// Separator row
	lines.push(
		formatSeparator(columnWidths, cellPadding, separatorChar, borderChar),
	);

	// Data rows
	for (const row of rows) {
		lines.push(
			formatRow(row, columnWidths, alignments, cellPadding, borderChar),
		);
	}

	return lines.join("\n");
}
