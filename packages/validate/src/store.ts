import { CrustError } from "@crustjs/core";
import type { StandardSchema } from "./types.ts";
import { isStandardSchema, normalizeStandardIssues } from "./validate.ts";

function assertStandardSchema(value: unknown, label: string): void {
	if (!isStandardSchema(value)) {
		throw new CrustError(
			"DEFINITION",
			`${label}: argument must be a Standard Schema v1 object (got ${typeof value})`,
		);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Field validator adapter — convert Standard Schema to per-field validate fn
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convert a Standard Schema into a per-field async validator function.
 *
 * The returned function matches the field `validate` contract from
 * `@crustjs/store`:
 * - Returns `void` (resolves) when the value is valid.
 * - Throws an `Error` when the value is invalid, with a message
 *   built from the schema's normalized issues.
 *
 * Uses the Standard Schema `~standard.validate` method and normalizes
 * issues into `{ message, path }` objects before formatting the error
 * message.
 *
 * @param schema — A Standard Schema v1-compatible schema for a single field value.
 * @returns An async validator function compatible with the field `validate` signature.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { field } from "@crustjs/validate";
 * import { createStore, configDir } from "@crustjs/store";
 *
 * const store = createStore({
 *   dirPath: configDir("my-cli"),
 *   fields: {
 *     theme: {
 *       type: "string",
 *       default: "light",
 *       validate: field(z.enum(["light", "dark"])),
 *     },
 *     verbose: {
 *       type: "boolean",
 *       default: false,
 *     },
 *   },
 * });
 * ```
 */
export function field<S extends StandardSchema>(
	schema: S,
): (value: unknown) => Promise<void> {
	assertStandardSchema(schema, "field()");
	return async (value: unknown) => {
		const result = await schema["~standard"].validate(value);

		if (result.issues) {
			const normalized = normalizeStandardIssues(result.issues);
			const messages = normalized.map((i) =>
				i.path ? `${i.path}: ${i.message}` : i.message,
			);
			throw new Error(messages.join("; "));
		}
	};
}

/**
 * Convert a Standard Schema into a per-field sync validator function.
 *
 * Like {@link field} but synchronous. Use this when you know the
 * schema is synchronous (e.g., most Zod schemas, simple validators).
 *
 * If the schema returns a Promise from `validate()`, a `TypeError` is thrown
 * at validation time.
 *
 * @param schema — A Standard Schema v1-compatible schema for a single field value.
 * @returns A sync validator function compatible with the field `validate` signature.
 * @throws {TypeError} If the schema returns a Promise during validation.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { fieldSync } from "@crustjs/validate";
 * import { createStore, configDir } from "@crustjs/store";
 *
 * const store = createStore({
 *   dirPath: configDir("my-cli"),
 *   fields: {
 *     theme: {
 *       type: "string",
 *       default: "light",
 *       validate: fieldSync(z.enum(["light", "dark"])),
 *     },
 *   },
 * });
 * ```
 */
export function fieldSync<S extends StandardSchema>(
	schema: S,
): (value: unknown) => void {
	assertStandardSchema(schema, "fieldSync()");
	return (value: unknown) => {
		const result = schema["~standard"].validate(value);

		if (result instanceof Promise) {
			throw new TypeError(
				"Schema returned a Promise from validate(). Use field() for async schemas.",
			);
		}

		if (result.issues) {
			const normalized = normalizeStandardIssues(result.issues);
			const messages = normalized.map((i) =>
				i.path ? `${i.path}: ${i.message}` : i.message,
			);
			throw new Error(messages.join("; "));
		}
	};
}
