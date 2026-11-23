const TEXT_JSON_SCHEMA: { type: string } = { type: "string" };

/**
 * `.output()` of the `completion` command, whose product is the script it prints and returns:
 * under `--json` that text prints once, as a JSON string, and nothing reaches stderr.
 */
export const textOutput = {
	"~standard": {
		version: 1,
		vendor: "crust",
		// SAFETY: only the action typed by this schema returns here, and TypeScript checks what it returns.
		validate: (value: unknown): { value: string | undefined } => ({
			value: value as string | undefined,
		}),
		jsonSchema: {
			input: (): { type: string } => TEXT_JSON_SCHEMA,
			output: (): { type: string } => TEXT_JSON_SCHEMA,
		},
	},
} as const;
