import type { StandardSchemaV1 } from "@standard-schema/spec";
import { renderBulletList, throwValidationError } from "../validation.ts";
import type { InferOutput, StandardSchema } from "./types.ts";
import { validateStandard, validateStandardSync } from "./validate.ts";

// ────────────────────────────────────────────────────────────────────────────
// Prompt error rendering strategies
// ────────────────────────────────────────────────────────────────────────────

/**
 * Controls how validation failures are rendered as prompt error messages.
 *
 * - `"first"` — Returns only the first issue's message (default).
 *   Best for single-field prompt inputs where one error at a time is clearest.
 *
 * - `"all"` — Renders all issues as a multi-line bullet list.
 *   Useful for complex schemas where users benefit from seeing every problem at once.
 */
export type PromptErrorStrategy = "first" | "all";

// ────────────────────────────────────────────────────────────────────────────
// Prompt adapter options
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for configuring prompt validation behavior.
 */
export interface PromptValidatorOptions {
	/**
	 * How to render validation failures into prompt error messages.
	 *
	 * @default "first"
	 */
	readonly errorStrategy?: PromptErrorStrategy;
}

// ────────────────────────────────────────────────────────────────────────────
// Prompt adapter — convert Standard Schema to prompt-compatible ValidateFn
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convert a Standard Schema into a prompt-compatible validation function.
 *
 * The returned function matches the `ValidateFn<T>` contract from
 * `@crustjs/prompts`:
 * - Returns `true` when the value is valid
 * - Returns a `string` error message when the value is invalid
 * - Supports both sync and async schemas transparently
 *
 * @param schema — A Standard Schema v1-compatible schema
 * @param options — Optional configuration for error rendering
 * @returns A function compatible with `@crustjs/prompts` `ValidateFn<T>`
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { promptValidator } from "@crustjs/validate/standard";
 * import { input } from "@crustjs/prompts";
 *
 * const name = await input({
 *   message: "Enter your name",
 *   validate: promptValidator(z.string().min(1, "Name is required")),
 * });
 * ```
 *
 * @example
 * ```ts
 * // Show all validation issues at once
 * const port = await input({
 *   message: "Enter port",
 *   validate: promptValidator(portSchema, { errorStrategy: "all" }),
 * });
 * ```
 */
export function promptValidator<S extends StandardSchema>(
	schema: S,
	options?: PromptValidatorOptions,
): (value: StandardSchemaV1.InferInput<S>) => Promise<true | string> {
	const errorStrategy = options?.errorStrategy ?? "first";

	return async (value: StandardSchemaV1.InferInput<S>) => {
		const result = await validateStandard(schema, value);

		if (result.ok) {
			return true;
		}

		return renderPromptError(result.issues, errorStrategy);
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Typed prompt parsing helpers — validate + return transformed output
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse a prompt answer through a Standard Schema and return the typed
 * output value.
 *
 * Unlike {@link promptValidator}, which only validates and returns
 * `true | string` for prompt integration, this function returns the
 * transformed schema output — preserving coercions, defaults, and type
 * refinements applied by the schema.
 *
 * On validation failure, throws a `CrustError("VALIDATION")` with
 * normalized issues.
 *
 * @param schema — A Standard Schema v1-compatible schema
 * @param value — The raw prompt answer to validate and parse
 * @returns The transformed output value typed as `InferOutput<S>`
 * @throws {CrustError} With code `"VALIDATION"` if the value is invalid
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { parsePromptValue } from "@crustjs/validate/standard";
 * import { input } from "@crustjs/prompts";
 *
 * const raw = await input({ message: "Enter port" });
 * const port = await parsePromptValue(z.coerce.number().int().positive(), raw);
 * // port is typed as `number` — coerced from the string input
 * ```
 */
export async function parsePromptValue<S extends StandardSchema>(
	schema: S,
	value: StandardSchemaV1.InferInput<S>,
): Promise<InferOutput<S>> {
	const result = await validateStandard(schema, value);

	if (result.ok) {
		return result.value;
	}

	return throwValidationError(result.issues, "Prompt validation failed");
}

/**
 * Synchronously parse a prompt answer through a Standard Schema and return
 * the typed output value.
 *
 * Use this when you know the schema is synchronous (e.g., most Zod schemas,
 * simple validators). If the schema returns a Promise, a `TypeError` is
 * thrown.
 *
 * On validation failure, throws a `CrustError("VALIDATION")` with
 * normalized issues.
 *
 * @param schema — A Standard Schema v1-compatible schema
 * @param value — The raw prompt answer to validate and parse
 * @returns The transformed output value typed as `InferOutput<S>`
 * @throws {CrustError} With code `"VALIDATION"` if the value is invalid
 * @throws {TypeError} If the schema returns a Promise
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { parsePromptValueSync } from "@crustjs/validate/standard";
 *
 * const port = parsePromptValueSync(z.coerce.number().int().positive(), "8080");
 * // port is typed as `number`
 * ```
 */
export function parsePromptValueSync<S extends StandardSchema>(
	schema: S,
	value: StandardSchemaV1.InferInput<S>,
): InferOutput<S> {
	const result = validateStandardSync(schema, value);

	if (result.ok) {
		return result.value;
	}

	return throwValidationError(result.issues, "Prompt validation failed");
}

// ────────────────────────────────────────────────────────────────────────────
// Error rendering helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Render validation issues into a prompt error string based on the
 * configured error strategy.
 */
function renderPromptError(
	issues: readonly { readonly message: string; readonly path: string }[],
	strategy: PromptErrorStrategy,
): string {
	if (issues.length === 0) {
		return "Validation failed";
	}

	if (strategy === "first") {
		const issue = issues[0] as (typeof issues)[number];
		// For prompt contexts, include path context when available
		if (issue.path) {
			return `${issue.path}: ${issue.message}`;
		}
		return issue.message;
	}

	// "all" strategy — render as bullet list
	return renderBulletList("Validation failed", issues);
}
