import type { AnyCommand } from "@crustjs/core";

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
	command: AnyCommand;
	/** Original pre-validation parsed values from the Crust parser */
	input: {
		/** Original parsed args before schema transformation */
		args: Record<string, unknown>;
		/** Original parsed flags before schema transformation */
		flags: Record<string, unknown>;
	};
}
