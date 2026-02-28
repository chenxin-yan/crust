import type { StandardSchemaV1 } from "@standard-schema/spec";

// ────────────────────────────────────────────────────────────────────────────
// Standard Schema type aliases — re-export narrowed types for internal use
// ────────────────────────────────────────────────────────────────────────────

/**
 * A Standard Schema-compatible schema object.
 *
 * Any schema library implementing the Standard Schema v1 spec
 * (Zod, Effect, Valibot, ArkType, etc.) produces objects matching this type.
 */
export type StandardSchema<Input = unknown, Output = Input> = StandardSchemaV1<
	Input,
	Output
>;

/** Infer the input type accepted by a Standard Schema. */
export type InferInput<S extends StandardSchema> =
	StandardSchemaV1.InferInput<S>;

/** Infer the output type produced by a Standard Schema on success. */
export type InferOutput<S extends StandardSchema> =
	StandardSchemaV1.InferOutput<S>;

// ────────────────────────────────────────────────────────────────────────────
// Validation result — provider-agnostic success/failure discriminated union
// ────────────────────────────────────────────────────────────────────────────

/**
 * Successful validation result — contains the transformed output value.
 */
export interface ValidationSuccess<T = unknown> {
	readonly ok: true;
	readonly value: T;
	readonly issues?: undefined;
}

/**
 * Failed validation result — contains normalized validation issues.
 */
export interface ValidationFailure {
	readonly ok: false;
	readonly value?: undefined;
	readonly issues: readonly import("../types.ts").ValidationIssue[];
}

/**
 * Provider-agnostic validation result.
 *
 * Discriminated on `ok`:
 * - `ok: true` → `ValidationSuccess<T>` with transformed `value`
 * - `ok: false` → `ValidationFailure` with normalized `issues`
 */
export type ValidationResult<T = unknown> =
	| ValidationSuccess<T>
	| ValidationFailure;
