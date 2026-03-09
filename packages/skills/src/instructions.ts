/**
 * Normalizes instruction list input by trimming items and dropping empties.
 *
 * Arrays preserve caller order. Strings are treated as single list items.
 */
export function normalizeInstructionList(
	input: string | string[] | undefined,
): string[] {
	if (input === undefined) {
		return [];
	}

	const values = Array.isArray(input) ? input : [input];

	return values
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

/**
 * Normalizes a raw markdown block while preserving internal structure.
 */
export function normalizeMarkdownBlock(input: string | undefined): string[] {
	const content = input?.trim();

	if (!content) {
		return [];
	}

	return content.split(/\r?\n/);
}

/**
 * Returns true when normalized instruction content has at least one line.
 */
export function hasNormalizedInstructions(lines: string[]): boolean {
	return lines.length > 0;
}
