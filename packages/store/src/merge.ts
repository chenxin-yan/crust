// ────────────────────────────────────────────────────────────────────────────
// @crustjs/store — Field-based defaults application
// ────────────────────────────────────────────────────────────────────────────

import type { FieldsDef, StoreDocument } from "./types.ts";

/**
 * Sets an own enumerable data property. Plain assignment would invoke the
 * inherited `__proto__` setter instead of storing a `__proto__` field.
 */
export function setDocumentValue(
	document: StoreDocument,
	key: string,
	value: StoreDocument[string],
): void {
	Object.defineProperty(document, key, {
		value,
		writable: true,
		enumerable: true,
		configurable: true,
	});
}

/**
 * Applies field defaults to a persisted config object.
 *
 * For each field defined in `fields`:
 * - If `persisted` has the key as an own property, the persisted value is used.
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
export function applyFieldDefaults(
	persisted: Readonly<StoreDocument> | undefined,
	fields: FieldsDef,
	pruneUnknown = true,
): StoreDocument {
	const result: StoreDocument = {};

	for (const [key, def] of Object.entries(fields)) {
		if (persisted && Object.hasOwn(persisted, key)) {
			setDocumentValue(result, key, persisted[key]);
		} else if (def.default !== undefined) {
			setDocumentValue(result, key, structuredClone(def.default));
		}
		// else: no persisted value and no default → key not set (field is T | undefined)
	}

	// Preserve unknown persisted keys when pruning is disabled
	if (!pruneUnknown && persisted !== undefined) {
		for (const [key, value] of Object.entries(persisted)) {
			if (!Object.hasOwn(fields, key)) {
				setDocumentValue(result, key, value);
			}
		}
	}

	return result;
}
