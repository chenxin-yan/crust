import type { StandardSchemaV1 } from "@standard-schema/spec";

// ────────────────────────────────────────────────────────────────────────────
// Standard Schema re-exports — type-only aliases for internal use
// ────────────────────────────────────────────────────────────────────────────

/** A Standard Schema-compatible validator. */
export type AnySchema<Input = unknown, Output = Input> = StandardSchemaV1<
	Input,
	Output
>;

/** The validation result returned by a Standard Schema `validate` call. */
export type SchemaResult<Output = unknown> = StandardSchemaV1.Result<Output>;

/** A single issue from a Standard Schema failure result. */
export type SchemaIssue = StandardSchemaV1.Issue;

/** A path segment within a Standard Schema issue. */
export type SchemaPathSegment = StandardSchemaV1.PathSegment;

// ────────────────────────────────────────────────────────────────────────────
// Normalized validation issue — internal canonical form
// ────────────────────────────────────────────────────────────────────────────

/**
 * A normalized validation issue used internally across both entrypoints.
 *
 * Standard Schema issues have heterogeneous path entries (`PropertyKey | PathSegment`).
 * This type normalizes them to a flat string-based dot-path for consistent rendering
 * and programmatic consumption.
 */
export interface ValidationIssue {
	/** Human-readable error message for this issue. */
	readonly message: string;
	/** Dot-path string describing the location of the issue (e.g. `"flags.verbose"`, `"args.0"`). Empty string for root-level issues. */
	readonly path: string;
}
