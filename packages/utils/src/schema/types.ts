import type { StandardSchemaV1 } from "@standard-schema/spec";

// ────────────────────────────────────────────────────────────────────────────
// Standard Schema type aliases
// ────────────────────────────────────────────────────────────────────────────

/**
 * A Standard Schema-compatible schema object.
 *
 * Any schema library implementing the Standard Schema v1 spec
 * (Zod, Effect, Valibot, ArkType, etc.) produces objects matching this type.
 */
export type StandardSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>;

/** Infer the input type accepted by a Standard Schema. */
export type InferInput<S extends StandardSchema> = StandardSchemaV1.InferInput<S>;

/** Infer the output type produced by a Standard Schema on success. */
export type InferOutput<S extends StandardSchema> = StandardSchemaV1.InferOutput<S>;
