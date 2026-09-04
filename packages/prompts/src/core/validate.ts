import type { StandardSchema } from "@crustjs/utils/schema";

import type { ValidateFn } from "./types.ts";

type PromptInitialOptions<Output> = {
	readonly schema?: StandardSchema<unknown, Output>;
	readonly validate?: ValidateFn<string>;
	readonly initial?: string;
};

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

/** @internal Validate shared text-prompt options and resolve an initial value. */
export async function resolvePromptInitial<Output>(
	promptName: "input" | "password",
	options: PromptInitialOptions<Output>,
): Promise<
	| { readonly shortCircuited: false }
	| { readonly shortCircuited: true; readonly value: Output | string }
> {
	if (options.schema !== undefined && options.validate !== undefined) {
		throw new Error(`${promptName}() cannot combine "schema" with "validate"`);
	}
	if (options.initial === undefined) return { shortCircuited: false };
	return {
		shortCircuited: true,
		value: options.schema
			? await parseShortCircuit(options.schema, options.initial, "initial")
			: options.initial,
	};
}
