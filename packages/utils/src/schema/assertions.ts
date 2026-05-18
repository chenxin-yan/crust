import type { StandardSchema } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Type guard — detect Standard Schema v1 objects at runtime
// ────────────────────────────────────────────────────────────────────────────

/**
 * Check whether `value` conforms to the Standard Schema v1 interface.
 *
 * A valid Standard Schema object has a `"~standard"` property containing
 * at least `version: 1` and a `validate` function.
 */
export function isStandardSchema(value: unknown): value is StandardSchema {
	// Standard Schema v1 spec only requires the `~standard` shape; the host
	// value may be an object (Zod, Valibot) or a function (Effect's wrapper
	// extends a callable class). Accept both.
	if (
		(typeof value !== "object" || value === null) &&
		typeof value !== "function"
	) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	const props = candidate["~standard"];
	if (typeof props !== "object" || props === null) return false;
	const p = props as Record<string, unknown>;
	return p.version === 1 && typeof p.validate === "function";
}

/**
 * Throw `TypeError` if `value` is not a Standard Schema v1 object.
 */
export function assertStandardSchema(value: unknown, label: string): void {
	if (!isStandardSchema(value)) {
		throw new TypeError(
			`${label}: argument must be a Standard Schema v1 object (got ${typeof value})`,
		);
	}
}
