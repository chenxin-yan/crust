import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
	StandardSchema,
	ValidationFailure,
	ValidationIssue,
	ValidationResult,
	ValidationSuccess,
} from "./types.ts";
import { formatPath } from "./validation.ts";

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
	if (
		(typeof value !== "object" || value === null) &&
		typeof value !== "function"
	) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	const props = candidate["~standard"];
	if (typeof props !== "object" || props === null) return false;
	const p = props as Record<string, unknown>;
	return p.version === 1 && typeof p.validate === "function";
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

// ────────────────────────────────────────────────────────────────────────────
// Result constructors — convenience builders for ValidationResult
// ────────────────────────────────────────────────────────────────────────────

/** Create a successful validation result. */
export function success<T>(value: T): ValidationSuccess<T> {
	return { ok: true, value };
}

/** Create a failed validation result. */
export function failure(issues: readonly ValidationIssue[]): ValidationFailure {
	return { ok: false, issues };
}

// ────────────────────────────────────────────────────────────────────────────
// Schema execution — run a Standard Schema's validate and normalize result
// ────────────────────────────────────────────────────────────────────────────

/**
 * Execute a Standard Schema's `~standard.validate` against a value
 * and return a normalized `ValidationResult`.
 *
 * The Standard Schema spec allows `validate` to return either a plain
 * result or a `Promise`. This function always awaits the result for
 * uniform async handling.
 *
 * @param schema — A Standard Schema v1-compatible schema
 * @param value — The value to validate
 * @param prefix — Optional path prefix for issue paths (e.g. `["flags", "name"]`)
 * @returns Normalized validation result with success value or failure issues
 */
export async function validateStandard<S extends StandardSchema>(
	schema: S,
	value: unknown,
	prefix: readonly PropertyKey[] = [],
): Promise<ValidationResult<StandardSchemaV1.InferOutput<S>>> {
	const result = await schema["~standard"].validate(value);

	if (!result.issues) {
		return success(result.value as StandardSchemaV1.InferOutput<S>);
	}

	return failure(normalizeStandardIssues(result.issues, prefix));
}

/**
 * Execute a Standard Schema's `~standard.validate` synchronously.
 *
 * If the schema returns a `Promise`, this function throws a `TypeError`.
 * Use this only when you know the schema is synchronous (e.g., most
 * Zod schemas, simple Valibot schemas).
 *
 * @param schema — A Standard Schema v1-compatible schema
 * @param value — The value to validate
 * @param prefix — Optional path prefix for issue paths
 * @returns Normalized validation result
 * @throws {TypeError} If the schema returns a Promise
 */
export function validateStandardSync<S extends StandardSchema>(
	schema: S,
	value: unknown,
	prefix: readonly PropertyKey[] = [],
): ValidationResult<StandardSchemaV1.InferOutput<S>> {
	const result = schema["~standard"].validate(value);

	if (result instanceof Promise) {
		throw new TypeError(
			"Schema returned a Promise from validate(). Use validateStandard() for async schemas.",
		);
	}

	if (!result.issues) {
		return success(result.value as StandardSchemaV1.InferOutput<S>);
	}

	return failure(normalizeStandardIssues(result.issues, prefix));
}
