import {
	type ExtensionFactory,
	type ExtensionId,
	CrustError,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const JSON_OUTPUT: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:json");

const jsonFlags = {
	json: {
		type: "boolean",
		noNegate: true,
		description: "Print machine-readable JSON output",
	},
} as const;

/** `CrustError` serializes through its own `toJSON()`; any other failure exposes only its message. */
function errorJson(error: unknown): string {
	return JSON.stringify(
		error instanceof CrustError
			? error.toJSON()
			: { message: error instanceof Error ? error.message : String(error) },
	);
}

/**
 * Adds a recursive `--json` flag. With it, the Command Action's result is
 * printed to stdout as one line of JSON (nothing for an `undefined` result),
 * the action's and Contexts' `stdout()` and `stderr()` lines go to stderr, and
 * failures are written to stderr as JSON. Exit codes are unchanged.
 */
export const json: ExtensionFactory<[], {}, [], typeof jsonFlags> = /* @__PURE__ */ defineExtension(
	JSON_OUTPUT,
).factory((extension) =>
	extension.flags(jsonFlags).renderer(async (ctx) => {
		if (ctx.flags.json !== true) return undefined;
		// Loaded only under --json, keeping it out of every CLI's startup.
		const { parseJsonValue } = await import("@crustjs/utils/json");
		return {
			text: ctx.stderr,
			diag: ctx.stderr,
			result(value) {
				if (value === undefined) return;
				let text: string;
				try {
					text = JSON.stringify(parseJsonValue(value), (_key, item) => {
						if (Object.is(item, -0)) throw new TypeError("-0 does not survive JSON");
						return item;
					});
				} catch (cause) {
					const reason = cause instanceof Error ? ` (${cause.message})` : "";
					throw new Error(`--json: the command result is not JSON data${reason}.`, { cause });
				}
				ctx.stdout(text);
			},
			error: (error) => ctx.stderr(errorJson(error)),
		};
	}),
);
