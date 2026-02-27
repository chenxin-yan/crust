// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Object-based defaults application
// ────────────────────────────────────────────────────────────────────────────

/**
 * Applies defaults to a persisted object.
 *
 * For each key defined in `defaults`:
 * - If the key exists in `persisted`, the persisted value is used.
 * - If the key is missing, the default value is used.
 *   Array and object defaults are shallow-copied to prevent shared mutation.
 *
 * Keys in `persisted` that are not defined in `defaults` are dropped
 * (pruned by default).
 *
 * This is a shallow merge — deep merge behavior will be added in a
 * subsequent task.
 *
 * @param persisted - Parsed JSON from disk, or `undefined` if no file exists.
 * @param defaults - Default values object defining the expected shape.
 * @returns A new object with defaults applied for missing keys.
 */
export function applyDefaults<T extends Record<string, unknown>>(
	persisted: Record<string, unknown> | undefined,
	defaults: T,
): T {
	const result: Record<string, unknown> = {};

	for (const [key, defaultValue] of Object.entries(defaults)) {
		if (persisted && key in persisted) {
			result[key] = persisted[key];
		} else if (defaultValue !== undefined) {
			// Shallow-copy arrays and objects to prevent shared mutation
			if (Array.isArray(defaultValue)) {
				result[key] = [...defaultValue];
			} else if (defaultValue !== null && typeof defaultValue === "object") {
				result[key] = { ...defaultValue };
			} else {
				result[key] = defaultValue;
			}
		}
	}

	return result as T;
}
