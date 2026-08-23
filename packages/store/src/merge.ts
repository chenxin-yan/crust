// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Field-based defaults application
// ────────────────────────────────────────────────────────────────────────────

import type { JsonValue } from "@crustjs/utils/json";

import type { FieldsDef, StoreDocument } from "./types.ts";

function copyDefault(value: JsonValue | readonly JsonValue[]): JsonValue {
	return structuredClone(value);
}

/**
 * Applies field defaults to a persisted config object.
 *
 * For each field defined in `fields`:
 * - If the key exists in `persisted`, the persisted value is used.
 * - If the key is missing and the field has a `default`, the default is used.
 *   Defaults are deep-copied to prevent shared nested mutation.
 * - If the key is missing and no default exists, the field is omitted
 *   (typed as `T | undefined` in the output).
 *
 * When `pruneUnknown` is `true` (the default), keys in `persisted` that are
 * not defined in `fields` are dropped. Set to `false` to preserve them.
 *
 * @param persisted    - Parsed JSON from disk, or `undefined` if no file exists.
 * @param fields       - Store field definitions.
 * @param pruneUnknown - Whether to drop persisted keys not in `fields`. Defaults to `true`.
 * @returns A new object with field defaults applied.
 */
export function applyFieldDefaults<F extends FieldsDef>(
	persisted: Readonly<StoreDocument> | undefined,
	fields: F,
	pruneUnknown = true,
): StoreDocument {
	const result: StoreDocument = {};

	for (const [key, def] of Object.entries(fields)) {
		if (persisted && key in persisted) {
			result[key] = persisted[key];
		} else if ("default" in def && def.default !== undefined) {
			result[key] = copyDefault(def.default);
		}
		// else: no persisted value and no default → key not set (field is T | undefined)
	}

	// Preserve unknown persisted keys when pruning is disabled
	if (!pruneUnknown && persisted !== undefined) {
		for (const [key, value] of Object.entries(persisted)) {
			if (!(key in fields)) {
				result[key] = value;
			}
		}
	}

	return result;
}
