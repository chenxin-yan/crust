import { normalizeStandardIssues as normalizeStandardIssuesImpl } from "@crustjs/schema-utils";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
	StandardSchema,
	ValidationFailure,
	ValidationIssue,
	ValidationResult,
	ValidationSuccess,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Re-exports — assertions and issue normalization helpers
// ────────────────────────────────────────────────────────────────────────────
//
// These helpers physically live in `@crustjs/schema-utils` (TP-017). They
// are re-exported here so internal validate-package callers (`store.ts`,
// `parse.ts`, `middleware.ts`, `schema.ts`) keep their existing imports
// pointing at `./validate.ts` without churn.
export {
	assertStandardSchema,
	isStandardSchema,
	normalizeStandardIssues,
	normalizeStandardPath,
} from "@crustjs/schema-utils";

// ────────────────────────────────────────────────────────────────────────────
// Result constructors — convenience builders for ValidationResult
// ────────────────────────────────────────────────────────────────────────────

/** Create a successful validation result. */
export function success<T>(value: T): ValidationSuccess<T> {
	return { ok: true, value };
}

/** Create a failed validation result. */
export function failure(issues: readonly ValidationIssue[]): ValidationFailure {
	return { ok: false, issues };
}

// ────────────────────────────────────────────────────────────────────────────
// Schema execution — run a Standard Schema's validate and normalize result
// ────────────────────────────────────────────────────────────────────────────

/**
 * Execute a Standard Schema's `~standard.validate` against a value
 * and return a normalized `ValidationResult`.
 *
 * The Standard Schema spec allows `validate` to return either a plain
 * result or a `Promise`. This function always awaits the result for
 * uniform async handling.
 *
 * @param schema — A Standard Schema v1-compatible schema
 * @param value — The value to validate
 * @param prefix — Optional path prefix for issue paths (e.g. `["flags", "name"]`)
 * @returns Normalized validation result with success value or failure issues
 */
export async function validateStandard<S extends StandardSchema>(
	schema: S,
	value: unknown,
	prefix: readonly PropertyKey[] = [],
): Promise<ValidationResult<StandardSchemaV1.InferOutput<S>>> {
	const result = await schema["~standard"].validate(value);

	if (!result.issues) {
		return success(result.value as StandardSchemaV1.InferOutput<S>);
	}

	return failure(normalizeStandardIssuesImpl(result.issues, prefix));
}

/**
 * Execute a Standard Schema's `~standard.validate` synchronously.
 *
 * If the schema returns a `Promise`, this function throws a `TypeError`.
 * Use this only when you know the schema is synchronous (e.g., most
 * Zod schemas, simple Valibot schemas).
 *
 * @param schema — A Standard Schema v1-compatible schema
 * @param value — The value to validate
 * @param prefix — Optional path prefix for issue paths
 * @returns Normalized validation result
 * @throws {TypeError} If the schema returns a Promise
 */
export function validateStandardSync<S extends StandardSchema>(
	schema: S,
	value: unknown,
	prefix: readonly PropertyKey[] = [],
): ValidationResult<StandardSchemaV1.InferOutput<S>> {
	const result = schema["~standard"].validate(value);

	if (result instanceof Promise) {
		throw new TypeError(
			"Schema returned a Promise from validate(). Use validateStandard() for async schemas.",
		);
	}

	if (!result.issues) {
		return success(result.value as StandardSchemaV1.InferOutput<S>);
	}

	return failure(normalizeStandardIssuesImpl(result.issues, prefix));
}
