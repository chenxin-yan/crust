import type { StandardSchemaV1 } from "@standard-schema/spec";
import { renderBulletList } from "../validation.ts";
import type { StandardSchema } from "./types.ts";
import { validateStandard } from "./validate.ts";

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
