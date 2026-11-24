import type { StandardJSONSchema, StandardSchema } from "@crustjs/utils/schema";

const TEXT_JSON_SCHEMA = { type: "string" };

/**
 * `.output()` of a command whose product is the text it prints, which it may also return:
 * under `--json` that text prints once, as a JSON string, and nothing reaches stderr.
 * It has no JSON Schema, so MCP does not require a string from a command that returns
 * nothing on another path (`completion --output-dir`).
 */
export const optionalTextOutput: StandardSchema<string | undefined> = {
	"~standard": {
		version: 1,
		vendor: "crust",
		// SAFETY: only actions typed by this schema return here, and TypeScript checks what they return.
		validate: (value) => ({ value: value as string | undefined }),
	},
};

/** {@link optionalTextOutput} for a command that always returns its text, advertised as a JSON string. */
export const textOutput: StandardSchema<string | undefined> &
	StandardJSONSchema<string | undefined> = {
	"~standard": {
		...optionalTextOutput["~standard"],
		jsonSchema: { input: () => TEXT_JSON_SCHEMA, output: () => TEXT_JSON_SCHEMA },
	},
};
