import { CrustError } from "@crustjs/core";
import type { ValidationIssue } from "./types.ts";

interface IssueInput {
	readonly message: string;
	readonly path?: readonly PropertyKey[];
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
// Issue normalization — convert provider issues to canonical form
// ────────────────────────────────────────────────────────────────────────────

/**
 * Normalize an issue into the internal canonical form.
 */
export function normalizeIssue(issue: IssueInput): ValidationIssue {
	return {
		message: issue.message,
		path: issue.path ? formatPath(issue.path) : "",
	};
}

/**
 * Normalize an array of provider issues into canonical form.
 */
export function normalizeIssues(
	issues: readonly IssueInput[],
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
