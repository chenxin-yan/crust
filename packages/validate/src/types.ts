import type { CommandNode } from "@crustjs/core";
import type { StandardSchemaV1 } from "@standard-schema/spec";

// ────────────────────────────────────────────────────────────────────────────
// Normalized validation issue — internal canonical form
// ────────────────────────────────────────────────────────────────────────────

/**
 * A normalized validation issue used internally across both entrypoints.
 *
 * Provider issues may use path arrays. This type normalizes them to a
 * flat string-based dot-path for consistent rendering
 * and programmatic consumption.
 */
export interface ValidationIssue {
	/** Human-readable error message for this issue. */
	readonly message: string;
	/** Dot-path string describing the location of the issue (e.g. `"flags.verbose"`, `"args[0]"`). Empty string for root-level issues. */
	readonly path: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Validated context — shared across all providers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extended command context passed to validated handlers.
 *
 * After validation, `args` and `flags` contain the transformed schema output.
 * The original pre-validation parsed values are preserved in `input` for
 * advanced or debug use.
 */
export interface ValidatedContext<ArgsOut, FlagsOut> {
	/** Transformed positional arguments after schema validation */
	args: ArgsOut;
	/** Transformed flags after schema validation */
	flags: FlagsOut;
	/** Raw arguments that appeared after the `--` separator */
	rawArgs: string[];
	/** The resolved command being executed */
	command: CommandNode;
	/** Original pre-validation parsed values from the Crust parser */
	input: {
		/** Original parsed args before schema transformation */
		args: Record<string, unknown>;
		/** Original parsed flags before schema transformation */
		flags: Record<string, unknown>;
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Standard Schema type aliases
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
	readonly issues: readonly ValidationIssue[];
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
