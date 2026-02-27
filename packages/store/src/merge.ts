// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Deep merge with pruning for defaults + persisted JSON
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns `true` when `value` is a plain object (not an array, Date, RegExp,
 * null, etc.) — the only kind of value we recurse into during deep merge.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Deep-clones a value for safe detachment from shared defaults.
 *
 * - Plain objects are recursively cloned.
 * - Arrays are shallow-copied (elements are *not* deep-cloned — they are
 *   replaced wholesale per spec, so element identity is fine).
 * - Primitives pass through unchanged.
 */
function deepClone<V>(value: V): V {
	if (Array.isArray(value)) {
		return [...value] as V;
	}
	if (isPlainObject(value)) {
		const cloned: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			cloned[k] = deepClone(v);
		}
		return cloned as V;
	}
	return value;
}

/**
 * Recursively deep-merges `persisted` values over `defaults`.
 *
 * Merge semantics:
 * - For each key in `defaults`, if the key exists in `persisted`:
 *   - If both values are plain objects → recurse.
 *   - Otherwise → the persisted value wins (arrays replace wholesale).
 * - If the key is missing from `persisted` → the default value is used
 *   (deep-cloned to prevent shared-reference mutation).
 * - When `pruneUnknown` is `true` (the default), keys in `persisted` that
 *   are not present in `defaults` are dropped.
 * - When `pruneUnknown` is `false`, extra persisted keys are preserved
 *   (deep-cloned for safety).
 *
 * @param persisted    - Parsed JSON from disk, or `undefined` if no file exists.
 * @param defaults     - Default values object defining the expected shape.
 * @param pruneUnknown - Whether to drop persisted keys not in `defaults`.
 *                       Defaults to `true`.
 * @returns A new object with defaults applied for missing keys.
 */
export function applyDefaults<T extends Record<string, unknown>>(
	persisted: Record<string, unknown> | undefined,
	defaults: T,
	pruneUnknown = true,
): T {
	const result: Record<string, unknown> = {};

	// 1. Walk every key defined in defaults.
	for (const [key, defaultValue] of Object.entries(defaults)) {
		if (persisted !== undefined && key in persisted) {
			const persistedValue = persisted[key];

			// Both plain objects → recurse for deep merge.
			if (isPlainObject(defaultValue) && isPlainObject(persistedValue)) {
				result[key] = applyDefaults(
					persistedValue,
					defaultValue as Record<string, unknown>,
					pruneUnknown,
				);
			} else {
				// Persisted value wins (arrays, primitives, type mismatches).
				// Clone mutable values to detach from the parsed input.
				result[key] = deepClone(persistedValue);
			}
		} else {
			// Key missing from persisted — use deep-cloned default.
			result[key] = deepClone(defaultValue);
		}
	}

	// 2. Preserve unknown persisted keys when pruning is disabled.
	if (!pruneUnknown && persisted !== undefined) {
		for (const [key, value] of Object.entries(persisted)) {
			if (!(key in defaults)) {
				result[key] = deepClone(value);
			}
		}
	}

	return result as T;
}
