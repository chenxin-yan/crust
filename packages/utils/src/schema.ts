// These structural types mirror @standard-schema/spec v1.1.0 per the
// specification's recommendation that implementers copy the protocol types.

/** The Standard Typed types interface. */
interface StandardSchemaTypes<Input = unknown, Output = Input> {
	/** The input type of the schema. */
	readonly input: Input;
	/** The output type of the schema. */
	readonly output: Output;
}

interface StandardSchemaOptions<LibraryOptions extends object = object> {
	/** Explicit support for additional vendor-specific parameters, if needed. */
	readonly libraryOptions?: LibraryOptions | undefined;
}

/** The result interface if validation succeeds. */
interface StandardSchemaSuccessResult<Output> {
	/** The typed output value. */
	readonly value: Output;
	/** A falsy value for `issues` indicates success. */
	readonly issues?: undefined;
}

/** The result interface if validation fails. */
interface StandardSchemaFailureResult {
	/** The issues of failed validation. */
	readonly issues: ReadonlyArray<StandardSchemaIssue>;
}

/** The result interface of the validate function. */
type StandardSchemaResult<Output> =
	| StandardSchemaSuccessResult<Output>
	| StandardSchemaFailureResult;

/** The issue interface of the failure output. */
interface StandardSchemaIssue {
	/** The error message of the issue. */
	readonly message: string;
	/** The path of the issue, if any. */
	readonly path?: ReadonlyArray<PropertyKey | StandardSchemaPathSegment> | undefined;
}

/** The path segment interface of the issue. */
interface StandardSchemaPathSegment {
	/** The key representing a path segment. */
	readonly key: PropertyKey;
}

/** The Standard Schema properties interface. */
interface StandardSchemaProps<Input = unknown, Output = Input> {
	/** The version number of the standard. */
	readonly version: 1;
	/** The vendor name of the schema library. */
	readonly vendor: string;
	/** Inferred types associated with the schema. */
	readonly types?: StandardSchemaTypes<Input, Output> | undefined;
	/** Validates unknown input values. */
	readonly validate: (
		value: StandardSchemaTypes["input"],
		options?: StandardSchemaOptions,
	) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
}

// ────────────────────────────────────────────────────────────────────────────
// @crustjs/utils/schema — low-level Standard Schema helpers
// ────────────────────────────────────────────────────────────────────────────
//
// Portable Standard Schema helpers shared internally by Crust packages. This
// module intentionally stays provider-agnostic: no vendor
// introspection, no metadata/default extraction, and no package-specific error
// wrappers.

// ────────────────────────────────────────────────────────────────────────────
// Standard Schema type aliases
// ────────────────────────────────────────────────────────────────────────────

/**
 * A Standard Schema-compatible schema object.
 *
 * Any schema library implementing the Standard Schema v1 spec
 * (Zod, Effect, Valibot, ArkType, etc.) produces objects matching this type.
 */
export type StandardSchema<Input = unknown, Output = Input> = {
	/** The Standard Schema properties. */
	readonly "~standard": StandardSchemaProps<Input, Output>;
};

/** Infer the output type produced by a Standard Schema on success. */
export type InferOutput<S extends StandardSchema> = NonNullable<S["~standard"]["types"]>["output"];

// ────────────────────────────────────────────────────────────────────────────
// Normalized validation issue
// ────────────────────────────────────────────────────────────────────────────

/**
 * A normalized validation issue used across schema-aware Crust packages.
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
// Path formatting — normalize issue paths to dot-path strings
// ────────────────────────────────────────────────────────────────────────────

/**
 * Format an issue path into a dot-path string.
 *
 * - Numeric keys (array indexes) are rendered with bracket notation: `items[0]`
 * - String/symbol keys are joined with dots: `flags.verbose`
 * - An empty path array produces an empty string (root-level issue)
 *
 * @example
 * ```ts
 * formatPath(["flags", "verbose"]);
 * // => "flags.verbose"
 *
 * formatPath(["args", 0]);
 * // => "args[0]"
 *
 * formatPath([]);
 * // => ""
 * ```
 */
function isNumericPathSegment(segment: PropertyKey): segment is number {
	return typeof segment === "number";
}

function formatPath(path: readonly PropertyKey[]): string {
	return path
		.map((segment, index) =>
			isNumericPathSegment(segment)
				? `[${segment}]`
				: index > 0
					? `.${String(segment)}`
					: String(segment),
		)
		.join("");
}

// ────────────────────────────────────────────────────────────────────────────
// Path normalization — Standard Schema issue paths → PropertyKey[]
// ────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a Standard Schema issue path to an array of `PropertyKey`.
 *
 * Standard Schema paths contain either bare `PropertyKey` values or
 * `{ key: PropertyKey }` segment objects; both forms are flattened to
 * plain `PropertyKey`. Returns an empty array for a root-level issue
 * (`undefined`).
 */
function isStandardPathSegment(
	segment: PropertyKey | StandardSchemaPathSegment,
): segment is StandardSchemaPathSegment {
	return typeof segment === "object" && segment !== null && "key" in segment;
}

function normalizeStandardPath(
	path: ReadonlyArray<PropertyKey | StandardSchemaPathSegment> | undefined,
): PropertyKey[] {
	if (!path) return [];
	return path.map((segment) => (isStandardPathSegment(segment) ? segment.key : segment));
}

// ────────────────────────────────────────────────────────────────────────────
// Issue normalization — Standard Schema issues → ValidationIssue[]
// ────────────────────────────────────────────────────────────────────────────

/**
 * Normalize Standard Schema issues into canonical `ValidationIssue` objects.
 *
 * Applies an optional prefix (e.g. `["flags", "verbose"]`) to each issue
 * path, then formats each path to its canonical dot-path string.
 *
 * @param issues — Raw Standard Schema issues from a failed validation
 * @param prefix — Optional path segments prepended to each issue path
 */
export function normalizeStandardIssues(
	issues: ReadonlyArray<StandardSchemaIssue>,
	prefix: readonly PropertyKey[] = [],
): ValidationIssue[] {
	return issues.map((issue) => {
		const resolvedPath = normalizeStandardPath(issue.path);
		const fullPath = [...prefix, ...resolvedPath];
		return {
			message: issue.message,
			path: formatPath(fullPath),
		};
	});
}
