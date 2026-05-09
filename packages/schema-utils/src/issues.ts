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
export function formatPath(path: readonly PropertyKey[]): string {
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
 * Resolve a single Standard Schema path segment to a `PropertyKey`.
 *
 * Standard Schema paths contain either bare `PropertyKey` values or
 * `{ key: PropertyKey }` segment objects. This function normalizes both
 * forms to plain `PropertyKey`.
 */
function resolvePathSegment(
	segment: PropertyKey | StandardSchemaV1.PathSegment,
): PropertyKey {
	if (typeof segment === "object" && segment !== null && "key" in segment) {
		return segment.key;
	}
	return segment as PropertyKey;
}

/**
 * Normalize a Standard Schema issue path to an array of `PropertyKey`.
 *
 * Handles:
 * - `undefined` → empty array (root-level issue)
 * - Bare `PropertyKey` segments
 * - `{ key: PropertyKey }` segment objects
 */
export function normalizeStandardPath(
	path: ReadonlyArray<PropertyKey | StandardSchemaV1.PathSegment> | undefined,
): PropertyKey[] {
	if (!path) return [];
	return path.map(resolvePathSegment);
}

// ────────────────────────────────────────────────────────────────────────────
// Issue normalization — Standard Schema issues → ValidationIssue[]
// ────────────────────────────────────────────────────────────────────────────

/**
 * Normalize Standard Schema issues into canonical `ValidationIssue` objects.
 *
 * Applies an optional prefix (e.g. `["flags", "verbose"]`) to each issue
 * path, then formats to the dot-path string used by `@crustjs/validate`.
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
