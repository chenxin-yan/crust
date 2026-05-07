// ────────────────────────────────────────────────────────────────────────────
// parseValue — Standard-Schema-first typed parsing helper
// ────────────────────────────────────────────────────────────────────────────
//
// Validates and returns the transformed schema output. On failure throws
// `CrustError("VALIDATION")` with all normalized issues attached as
// `details.issues`.

import { CrustError } from "@crustjs/core";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { InferOutput, StandardSchema } from "./types.ts";
import { isStandardSchema, validateStandard } from "./validate.ts";
import { throwValidationError } from "./validation.ts";

function assertStandardSchema(value: unknown, label: string): void {
	if (!isStandardSchema(value)) {
		throw new CrustError(
			"DEFINITION",
			`${label}: argument must be a Standard Schema v1 object (got ${typeof value})`,
		);
	}
}

/**
 * Validate `value` against `schema` and return the transformed output.
 *
 * Unlike `validateStandard`, which returns a discriminated result, this
 * helper throws on failure — matching the `parse()`/`assert()` ergonomic
 * common to schema libraries. The transformed output preserves coercions,
 * defaults, and refinements applied by the schema.
 *
 * On validation failure, throws `CrustError("VALIDATION")` with all
 * normalized issues in `details.issues`.
 *
 * @param schema - A Standard Schema v1-compatible schema
 * @param value - The raw value to validate and parse
 * @returns The transformed output value typed as `InferOutput<S>`
 * @throws {CrustError} With code `"VALIDATION"` if the value is invalid
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { parseValue } from "@crustjs/validate";
 *
 * const port = await parseValue(z.coerce.number().int().positive(), "8080");
 * // port is typed as `number` — coerced from the string input
 * ```
 *
 * @example Use with prompts
 * ```ts
 * import { input } from "@crustjs/prompts";
 * import { parseValue } from "@crustjs/validate";
 *
 * const raw = await input({ message: "Enter port" });
 * const port = await parseValue(z.coerce.number().int().positive(), raw);
 * ```
 */
export async function parseValue<S extends StandardSchema>(
	schema: S,
	value: StandardSchemaV1.InferInput<S>,
): Promise<InferOutput<S>> {
	assertStandardSchema(schema, "parseValue()");
	const result = await validateStandard(schema, value);

	if (result.ok) {
		return result.value;
	}

	return throwValidationError(result.issues, "Validation failed");
}
