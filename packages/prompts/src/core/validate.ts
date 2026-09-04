import type { StandardSchema } from "@crustjs/utils/schema";

import type { ValidateFn } from "./types.ts";

export async function validateSubmitValue<Output>(
	value: string,
	schema: StandardSchema<unknown, Output> | undefined,
	validate: ValidateFn<string> | undefined,
): Promise<{ ok: true; value: Output | string } | { ok: false; error: string }> {
	if (schema) {
		const result = await schema["~standard"].validate(value);
		const issue = result.issues?.[0];
		if (issue) return { ok: false, error: issue.message || "Validation failed" };
		if ("value" in result) return { ok: true, value: result.value };
		return { ok: false, error: "Validation failed" };
	}
	if (validate) {
		try {
			await validate(value);
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : "Validation failed" };
		}
	}
	return { ok: true, value };
}

/** @internal Parse an initial/default value through a Standard Schema. */
export async function parseShortCircuit<Output>(
	schema: StandardSchema<unknown, Output>,
	value: string,
	source: "initial" | "default",
): Promise<Output> {
	const result = await validateSubmitValue(value, schema, undefined);
	if (!result.ok) throw new Error(`${source} value rejected by schema: ${result.error}`);
	// SAFETY: a provided schema makes validateSubmitValue return only that schema's output.
	return result.value as Output;
}
