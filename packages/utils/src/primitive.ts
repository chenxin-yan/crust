// ────────────────────────────────────────────────────────────────────────────
// Public — primitive type vocabulary
// ────────────────────────────────────────────────────────────────────────────

/** Supported primitive type literals shared by Crust packages. */
export type BaseValueType = "string" | "number" | "boolean";

/**
 * Resolves a primitive type literal to its corresponding TypeScript type.
 *
 * @example
 * ```ts
 * type Port = ResolvePrimitive<"number">;
 * //   ^? number
 * ```
 */
export type ResolvePrimitive<T extends BaseValueType> = T extends "string"
	? string
	: T extends "number"
		? number
		: T extends "boolean"
			? boolean
			: never;

// ────────────────────────────────────────────────────────────────────────────
// Public — tryCoerceNumber
// ────────────────────────────────────────────────────────────────────────────

/**
 * Attempts to coerce a string to a number, returning `undefined` only when the
 * result is `NaN`. Callers decide whether `undefined` means throw or fallback.
 *
 * @example
 * ```ts
 * tryCoerceNumber("42"); // 42
 * tryCoerceNumber("abc"); // undefined
 * tryCoerceNumber(""); // 0
 * ```
 */
export function tryCoerceNumber(raw: string): number | undefined {
	const num = Number(raw);
	return Number.isNaN(num) ? undefined : num;
}

// ────────────────────────────────────────────────────────────────────────────
// Public — coerceBooleanString
// ────────────────────────────────────────────────────────────────────────────

/**
 * Coerces Crust boolean strings using the existing strict truthy spellings.
 *
 * @example
 * ```ts
 * coerceBooleanString("true"); // true
 * coerceBooleanString("1"); // true
 * coerceBooleanString("false"); // false
 * ```
 */
export function coerceBooleanString(raw: string): boolean {
	return raw === "true" || raw === "1";
}
