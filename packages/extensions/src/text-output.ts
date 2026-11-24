import type { StandardJSONSchema, StandardSchema } from "@crustjs/utils/schema";

/**
 * `.output()` of a command whose product is what it prints, which it also returns: under
 * `--json` the result prints once, as JSON, and nothing reaches stderr.
 */
export function printedOutput<T>(
	jsonSchema: Record<string, unknown>,
): StandardSchema<T> & StandardJSONSchema<T> {
	return {
		"~standard": {
			version: 1,
			vendor: "crust",
			// SAFETY: only actions typed by this schema return here, and TypeScript checks what they return.
			validate: (value) => ({ value: value as T }),
			jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
		},
	};
}

/** {@link printedOutput} of a command that prints text. */
export const textOutput: StandardSchema<string | undefined> &
	StandardJSONSchema<string | undefined> = /* @__PURE__ */ printedOutput({ type: "string" });
