/**
 * Normalizes instruction list input by trimming items and dropping empties.
 *
 * Each element (or the single string) is split on newlines, so a value like
 * `"Line1\nLine2"` produces two separate items. Arrays preserve caller order.
 */
export function normalizeInstructionList(input: string | string[] | undefined): string[] {
	if (input === undefined) {
		return [];
	}

	const values = Array.isArray(input) ? input : [input];

	return values
		.flatMap((value) => value.split(/\r?\n/))
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}
