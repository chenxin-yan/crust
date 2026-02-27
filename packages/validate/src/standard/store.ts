import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { StandardSchema } from "./types.ts";
import { validateStandard, validateStandardSync } from "./validate.ts";

// ────────────────────────────────────────────────────────────────────────────
// Store adapter — convert Standard Schema to StoreValidator<T>-compatible fn
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convert a Standard Schema into a store-compatible async validator function.
 *
 * The returned function matches the `StoreValidator<T>` contract from
 * `@crustjs/store`:
 * - Returns `{ ok: true, value }` when the config is valid (with possibly
 *   transformed value from schema coercion/defaults)
 * - Returns `{ ok: false, issues }` when the config is invalid, with
 *   normalized `{ message, path }` issue objects
 *
 * Uses `validateStandard()` from the Standard Schema core for schema
 * execution and issue normalization, ensuring consistent validation
 * semantics across command, prompt, and store targets.
 *
 * @param schema — A Standard Schema v1-compatible schema for the full config
 * @returns An async validator function compatible with `StoreValidator<T>`
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { storeValidator } from "@crustjs/validate/standard";
 * import { createStore, configDir } from "@crustjs/store";
 *
 * const store = createStore({
 *   dirPath: configDir("my-cli"),
 *   fields: {
 *     theme: { type: "string", default: "light" },
 *     verbose: { type: "boolean", default: false },
 *   },
 *   validator: storeValidator(
 *     z.object({
 *       theme: z.enum(["light", "dark"]),
 *       verbose: z.boolean(),
 *     }),
 *   ),
 * });
 * ```
 */
export function storeValidator<S extends StandardSchema>(
	schema: S,
): (
	value: unknown,
) => Promise<StoreValidatorResultLike<StandardSchemaV1.InferOutput<S>>> {
	return async (value: unknown) => {
		return validateStandard(schema, value);
	};
}

/**
 * Convert a Standard Schema into a store-compatible sync validator function.
 *
 * Like {@link storeValidator} but synchronous. Use this when you know the
 * schema is synchronous (e.g., most Zod schemas, simple validators).
 *
 * If the schema returns a Promise from `validate()`, a `TypeError` is thrown
 * at validation time.
 *
 * @param schema — A Standard Schema v1-compatible schema for the full config
 * @returns A sync validator function compatible with `StoreValidator<T>`
 * @throws {TypeError} If the schema returns a Promise during validation
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { storeValidatorSync } from "@crustjs/validate/standard";
 * import { createStore, configDir } from "@crustjs/store";
 *
 * const store = createStore({
 *   dirPath: configDir("my-cli"),
 *   fields: { theme: { type: "string", default: "light" } },
 *   validator: storeValidatorSync(
 *     z.object({ theme: z.enum(["light", "dark"]) }),
 *   ),
 * });
 * ```
 */
export function storeValidatorSync<S extends StandardSchema>(
	schema: S,
): (
	value: unknown,
) => StoreValidatorResultLike<StandardSchemaV1.InferOutput<S>> {
	return (value: unknown) => {
		return validateStandardSync(schema, value);
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Internal type — structural match for StoreValidatorResult from @crustjs/store
// ────────────────────────────────────────────────────────────────────────────

/**
 * Structural type that matches both `ValidationResult<T>` from the standard
 * core and `StoreValidatorResult<T>` from `@crustjs/store`.
 *
 * This avoids importing from `@crustjs/store` while ensuring the returned
 * functions are assignable to `StoreValidator<T>`.
 */
type StoreValidatorResultLike<T> =
	| { readonly ok: true; readonly value: T }
	| {
			readonly ok: false;
			readonly issues: ReadonlyArray<{
				readonly message: string;
				readonly path: string;
			}>;
	  };
