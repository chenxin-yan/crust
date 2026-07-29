import type { StandardSchemaV1 } from "@standard-schema/spec";

// ────────────────────────────────────────────────────────────────────────────
// @crustjs/utils/schema — low-level Standard Schema helpers
// ────────────────────────────────────────────────────────────────────────────
//
// Public low-level subpath for portable Standard Schema helpers shared by Crust
// packages. This module intentionally stays provider-agnostic: no vendor
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
export type StandardSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>;

/** Infer the output type produced by a Standard Schema on success. */
export type InferOutput<S extends StandardSchema> = StandardSchemaV1.InferOutput<S>;

// ────────────────────────────────────────────────────────────────────────────
// Type guard — detect Standard Schema v1 objects at runtime
// ────────────────────────────────────────────────────────────────────────────

/**
 * Check whether `value` conforms to the Standard Schema v1 interface.
 *
 * A valid Standard Schema object has a `"~standard"` property containing
 * at least `version: 1` and a `validate` function.
 */
export function isStandardSchema(value: unknown): value is StandardSchema {
	// Standard Schema v1 spec only requires the `~standard` shape; the host
	// value may be an object (Zod, Valibot) or a function (Effect's wrapper
	// extends a callable class). Accept both.
	if ((typeof value !== "object" || value === null) && typeof value !== "function") {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	const props = candidate["~standard"];
	if (typeof props !== "object" || props === null) return false;
	const p = props as Record<string, unknown>;
	return p.version === 1 && typeof p.validate === "function";
}

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
function formatPath(path: readonly PropertyKey[]): string {
	let result = "";
	for (const segment of path) {
		if (typeof segment === "number") {
			result += `[${String(segment)}]`;
		} else {
			const str = String(segment);
			if (result.length > 0) {
				result += `.${str}`;
			} else {
				result = str;
			}
		}
	}
	return result;
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
function normalizeStandardPath(
	path: ReadonlyArray<PropertyKey | StandardSchemaV1.PathSegment> | undefined,
): PropertyKey[] {
	if (!path) return [];
	return path.map((segment) =>
		typeof segment === "object" && segment !== null && "key" in segment
			? segment.key
			: (segment as PropertyKey),
	);
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
	issues: ReadonlyArray<StandardSchemaV1.Issue>,
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
