/**
 * `.output()` of the `completion` command, whose product is the script it prints and may return:
 * under `--json` that text prints once, as a JSON string, and nothing reaches stderr.
 * It has no JSON Schema, so MCP does not require a string from `completion --output-dir`,
 * which returns nothing.
 */
export const textOutput = {
	"~standard": {
		version: 1,
		vendor: "crust",
		// SAFETY: only the action typed by this schema returns here, and TypeScript checks what it returns.
		validate: (value: unknown): { value: string | undefined } => ({
			value: value as string | undefined,
		}),
	},
} as const;
