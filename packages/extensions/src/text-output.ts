import type { StandardJSONSchema, StandardSchema } from "@crustjs/utils/schema";

const TEXT_JSON_SCHEMA = { type: "string" };

/**
 * `.output()` of a command whose product is the text it prints, which it also returns:
 * under `--json` that text prints once, as a JSON string, and nothing reaches stderr.
 */
export const textOutput: StandardSchema<string | undefined> &
	StandardJSONSchema<string | undefined> = {
	"~standard": {
		version: 1,
		vendor: "crust",
		// SAFETY: only actions typed by this schema return here, and TypeScript checks what they return.
		validate: (value) => ({ value: value as string | undefined }),
		jsonSchema: { input: () => TEXT_JSON_SCHEMA, output: () => TEXT_JSON_SCHEMA },
	},
};
