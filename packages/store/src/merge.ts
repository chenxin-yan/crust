// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Deep-merge defaults helper
// ────────────────────────────────────────────────────────────────────────────

/**
 * Deep-merges a persisted config with default values.
 *
 * Behavior:
 * - Missing keys in `persisted` are filled from `defaults`.
 * - Nested plain objects are merged recursively.
 * - Arrays and non-plain-object values in `persisted` **replace** the default
 *   (no element-level array merging).
 * - `null` in `persisted` is treated as an explicit value and replaces the default.
 *
 * This function is used at read time to produce the effective config without
 * auto-persisting the merged result back to disk.
 *
 * @param defaults - Base default config values.
 * @param persisted - Persisted config values (may be partial).
 * @returns A new object with defaults filled in for missing persisted fields.
 */
export function deepMerge<T>(defaults: T, persisted: unknown): T {
	// If persisted is not a plain object, it replaces defaults entirely
	if (!isPlainObject(persisted)) {
		return persisted as T;
	}

	// If defaults is not a plain object, persisted replaces it entirely
	if (!isPlainObject(defaults)) {
		return persisted as T;
	}

	const result: Record<string, unknown> = {};

	// Start with all default keys
	for (const key of Object.keys(defaults as Record<string, unknown>)) {
		const defaultValue = (defaults as Record<string, unknown>)[key];
		const persistedValue = (persisted as Record<string, unknown>)[key];

		if (!(key in (persisted as Record<string, unknown>))) {
			// Key missing from persisted — use default
			result[key] = defaultValue;
		} else if (isPlainObject(defaultValue) && isPlainObject(persistedValue)) {
			// Both sides are plain objects — recurse
			result[key] = deepMerge(defaultValue, persistedValue);
		} else {
			// Persisted value replaces default (arrays, primitives, null)
			result[key] = persistedValue;
		}
	}

	// Include persisted keys not present in defaults
	for (const key of Object.keys(persisted as Record<string, unknown>)) {
		if (!(key in (defaults as Record<string, unknown>))) {
			result[key] = (persisted as Record<string, unknown>)[key];
		}
	}

	return result as T;
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether a value is a plain object (not an array, null, Date, etc.).
 *
 * Only objects created by `{}`, `Object.create(null)`, or `new Object()` are
 * considered plain. Arrays, class instances, and `null` are excluded.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}

	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
