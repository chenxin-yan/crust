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
function errorData(error: unknown): unknown {
	return error instanceof CrustError
		? error.toJSON()
		: { message: error instanceof Error ? error.message : String(error) };
}

/**
 * Adds a recursive `--json` flag. With it, the Command Action's result is
 * printed to stdout as one line of JSON (nothing for an `undefined` result),
 * the action's and Contexts' `stdout()` and `stderr()` lines go to stderr, and
 * failures are written to stderr as JSON. An async generator action streams
 * NDJSON on stdout instead: one `{"type":"event","data":…}` line per yield,
 * then one `{"type":"result","data":…}` or `{"type":"error","error":…}` line.
 * Exit codes are unchanged. Adds a "JSON output" section to the root
 * command's documentation saying so.
 */
export const json: ExtensionFactory<[], {}, [], typeof jsonFlags> = /* @__PURE__ */ defineExtension(
	JSON_OUTPUT,
).factory((extension) =>
	extension
		.flags(jsonFlags)
		.sections(() => [
			{
				command: [],
				title: "JSON output",
				body: "--json prints the command's result as JSON on stdout and moves its other output to stderr.",
			},
		])
		.renderer(async (ctx) => {
			if (ctx.flags.json !== true) return undefined;
			// Loaded only under --json, keeping it out of every CLI's startup.
			const { parseJsonValue } = await import("@crustjs/utils/json");
			/** JSON text for `value`, or a clear failure naming `what` when JSON cannot represent it exactly. */
			const serialize = (value: unknown, what: string): string => {
				try {
					return JSON.stringify(parseJsonValue(value), (_key, item) => {
						if (Object.is(item, -0)) throw new TypeError("-0 does not survive JSON");
						return item;
					});
				} catch (cause) {
					const reason = cause instanceof Error ? ` (${cause.message})` : "";
					throw new Error(`--json: ${what} is not JSON data${reason}.`, { cause });
				}
			};
			/** One NDJSON line of a generator action's stream; `undefined` data is omitted. */
			const line = (type: "event" | "result", value: unknown, what: string): string =>
				value === undefined
					? `{"type":"${type}"}`
					: `{"type":"${type}","data":${serialize(value, what)}}`;
			// Set by Core's `stream()` before a generator action's first event. Once the final
			// result line is out, a later failure goes to stderr so stdout keeps exactly one final line.
			let streaming = false;
			let ended = false;
			return {
				text: ctx.stderr,
				diag: ctx.stderr,
				stream() {
					streaming = true;
				},
				event: (value) => ctx.stdout(line("event", value, "an event")),
				result(value) {
					if (streaming) {
						ctx.stdout(line("result", value, "the command result"));
						ended = true;
					} else if (value !== undefined) {
						ctx.stdout(serialize(value, "the command result"));
					}
				},
				error(error) {
					if (streaming && !ended) {
						ctx.stdout(JSON.stringify({ type: "error", error: errorData(error) }));
					} else {
						ctx.stderr(JSON.stringify(errorData(error)));
					}
				},
			};
		}),
);
