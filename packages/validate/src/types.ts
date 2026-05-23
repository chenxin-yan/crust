import type { CommandNode } from "@crustjs/core";

// ────────────────────────────────────────────────────────────────────────────
// Re-exports — Standard Schema type aliases + normalized validation issue
// ────────────────────────────────────────────────────────────────────────────
//
// `StandardSchema`, `InferInput`, `InferOutput`, and `ValidationIssue` are
// owned by `@crustjs/utils/schema`. Re-exported here so the locked
// root export surface of `@crustjs/validate` continues to publish them
// from a single import path.
export type {
	InferInput,
	InferOutput,
	StandardSchema,
	ValidationIssue,
} from "@crustjs/utils/schema";

import type { ValidationIssue } from "@crustjs/utils/schema";

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
