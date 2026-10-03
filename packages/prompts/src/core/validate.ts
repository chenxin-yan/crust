import type { StandardSchema } from "@crustjs/utils/schema";

import type { ValidateFn } from "./types.ts";

type ValidationResult<Output> = { ok: true; value: Output } | { ok: false; error: string };

/** @internal Validate a value through a Standard Schema, returning the schema's output. */
export async function validateWithSchema<Output>(
	schema: StandardSchema<unknown, Output>,
	value: string,
): Promise<ValidationResult<Output>> {
	const result = await schema["~standard"].validate(value);
	const issue = result.issues?.[0];
	if (issue) return { ok: false, error: issue.message || "Validation failed" };
	if ("value" in result) return { ok: true, value: result.value };
	return { ok: false, error: "Validation failed" };
}

export async function validateSubmitValue<Output>(
	value: string,
	schema: StandardSchema<unknown, Output> | undefined,
	validate: ValidateFn<string> | undefined,
): Promise<ValidationResult<Output | string>> {
	if (schema) return validateWithSchema(schema, value);
	if (validate) {
		try {
			await validate(value);
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : "Validation failed" };
		}
	}
	return { ok: true, value };
}
