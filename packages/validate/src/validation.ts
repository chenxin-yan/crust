import { CrustError } from "@crustjs/core";
import type {
	SchemaIssue,
	SchemaPathSegment,
	SchemaResult,
	ValidationIssue,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Path formatting — normalize Standard Schema paths to dot-path strings
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract the key from a Standard Schema path segment.
 *
 * Path entries are either plain `PropertyKey` values or `PathSegment` objects
 * with a `.key` property. This helper normalizes both forms to a string.
 */
function resolveSegmentKey(
	segment: PropertyKey | SchemaPathSegment,
): PropertyKey {
	if (typeof segment === "object" && segment !== null && "key" in segment) {
		return segment.key;
	}
	return segment;
}

/**
 * Format an array of Standard Schema path segments into a dot-path string.
 *
 * - Numeric keys (array indexes) are rendered with bracket notation: `items[0]`
 * - String/symbol keys are joined with dots: `flags.verbose`
 * - An empty path array produces an empty string (root-level issue)
 *
 * @example
 * ```ts
 * formatPath([{ key: "flags" }, { key: "verbose" }]);
 * // => "flags.verbose"
 *
 * formatPath(["args", 0]);
 * // => "args[0]"
 *
 * formatPath([]);
 * // => ""
 * ```
 */
export function formatPath(
	path: ReadonlyArray<PropertyKey | SchemaPathSegment>,
): string {
	let result = "";
	for (const segment of path) {
		const key = resolveSegmentKey(segment);
		if (typeof key === "number") {
			result += `[${String(key)}]`;
		} else {
			const str = String(key);
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
// Issue normalization — convert Standard Schema issues to canonical form
// ────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a Standard Schema issue into the internal canonical form.
 *
 * Converts heterogeneous path entries to a flat dot-path string.
 */
export function normalizeIssue(issue: SchemaIssue): ValidationIssue {
	return {
		message: issue.message,
		path: issue.path ? formatPath(issue.path) : "",
	};
}

/**
 * Normalize an array of Standard Schema issues into canonical form.
 */
export function normalizeIssues(
	issues: ReadonlyArray<SchemaIssue>,
): ValidationIssue[] {
	return issues.map(normalizeIssue);
}

// ────────────────────────────────────────────────────────────────────────────
// Message rendering — CLI-friendly bullet-list output
// ────────────────────────────────────────────────────────────────────────────

/**
 * Render a single normalized issue as a bullet-list line.
 *
 * - Issues with a path: `  - flags.verbose: must be a boolean`
 * - Issues without a path: `  - must be a string`
 */
function renderIssueLine(issue: ValidationIssue): string {
	if (issue.path) {
		return `  - ${issue.path}: ${issue.message}`;
	}
	return `  - ${issue.message}`;
}

/**
 * Render normalized validation issues into a human-readable bullet-list message
 * suitable for CLI output.
 *
 * @param prefix — A leading line printed before the bullet list (e.g. `"Validation failed"`)
 * @param issues — The normalized issues to render
 * @returns Multi-line string with prefix and indented bullet entries
 *
 * @example
 * ```ts
 * renderBulletList("Validation failed", [
 *   { path: "flags.verbose", message: "Expected boolean, received string" },
 *   { path: "args[0]", message: "Required" },
 * ]);
 * // => "Validation failed\n  - flags.verbose: Expected boolean, received string\n  - args[0]: Required"
 * ```
 */
export function renderBulletList(
	prefix: string,
	issues: readonly ValidationIssue[],
): string {
	if (issues.length === 0) return prefix;
	const lines = issues.map(renderIssueLine);
	return `${prefix}\n${lines.join("\n")}`;
}

// ────────────────────────────────────────────────────────────────────────────
// CrustError mapping — throw VALIDATION errors with structured cause
// ────────────────────────────────────────────────────────────────────────────

/**
 * Throw a `CrustError("VALIDATION")` with a formatted bullet-list message
 * and the raw normalized issues attached as `error.details.issues`.
 *
 * @param issues — Normalized validation issues
 * @param prefix — Optional leading message line (defaults to `"Validation failed"`)
 * @throws {CrustError} Always throws with code `"VALIDATION"`
 */
export function throwValidationError(
	issues: readonly ValidationIssue[],
	prefix = "Validation failed",
): never {
	const message = renderBulletList(prefix, issues);
	throw new CrustError("VALIDATION", message, { issues }).withCause(issues);
}

// ────────────────────────────────────────────────────────────────────────────
// Sync-only guard — reject async validation results in v1
// ────────────────────────────────────────────────────────────────────────────

/**
 * Assert that a Standard Schema `validate` result is synchronous.
 *
 * In v1, `@crustjs/validate` only supports synchronous validation pipelines.
 * If a schema returns a `Promise`, this guard throws a `CrustError("VALIDATION")`
 * with guidance to use a synchronous schema.
 *
 * @param result — The value returned by `schema["~standard"].validate(input)`
 * @returns The synchronous result
 * @throws {CrustError} If `result` is a Promise (async schema detected)
 */
export function assertSyncResult<Output>(
	result: SchemaResult<Output> | Promise<SchemaResult<Output>>,
): SchemaResult<Output> {
	if (result instanceof Promise) {
		throw new CrustError(
			"VALIDATION",
			"Async validation is not supported in @crustjs/validate v1. Use a synchronous schema.",
		);
	}
	return result;
}
