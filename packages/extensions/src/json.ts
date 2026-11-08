import {
	type ExtensionContext,
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

/** Per invocation: writes the `stdout()` lines its renderer still holds to stderr. */
const flushHeld = /* @__PURE__ */ new WeakMap<ExtensionContext, () => void>();

/**
 * Adds a recursive `--json` flag. With it, the Command Action's result is
 * printed to stdout as one line of JSON (nothing for an `undefined` result),
 * the action's and Contexts' `stderr()` lines go to stderr, and failures are
 * written to stderr as JSON. Their `stdout()` lines go to stderr too, live,
 * except in a command that declares `.output()`: it returns data, so its JSON
 * result replaces that text, and the text is written to stderr only when the
 * command returns nothing, fails, or is cancelled. An async generator action
 * streams NDJSON on stdout instead: one `{"type":"event","data":…}` line per
 * yield, then one `{"type":"result","data":…}` or `{"type":"error","error":…}`
 * line. A cancelled invocation (exit code 130), or a failure another
 * Extension's `onError` hook claims, ends the stream without that final line,
 * so consumers should check the exit status. Exit codes are unchanged. Adds a
 * "JSON output" section to the root command's documentation saying so.
 *
 * @see https://crustjs.com/docs/modules/extensions/json
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
				body: "--json prints the command's result as JSON on stdout (NDJSON for streaming commands). Other output goes to stderr; commands that declare an output schema print only the JSON.",
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
			/** One NDJSON line of a generator action's stream. */
			const line = (type: "event" | "result", data: string): string =>
				`{"type":"${type}","data":${data}}`;
			// Set by Core's `stream()` before a generator action's first event. Once the final
			// result line is out, a later failure goes to stderr so stdout keeps exactly one final line.
			let streaming = false;
			let ended = false;
			// A `.output()` command's result is its data, so its `stdout()` text is held: dropped once a
			// result is out, written to stderr otherwise. shortcut: held lines stay in memory until the
			// invocation ends; add a size cap that flushes to stderr if anyone hits it.
			let held: string[] | undefined = ctx.command.output ? [] : undefined;
			let dropped = false;
			const flush = () => {
				if (!held) return;
				const lines = held;
				held = undefined;
				for (const text of lines) ctx.stderr(text);
			};
			/** Write a serialized result line and drop held text. A serialization failure never gets here, so `error` flushes it. */
			const emit = (data: string) => {
				ctx.stdout(data);
				if (held) {
					held = undefined;
					dropped = true;
				}
			};
			// Cancellations, `run()` failures and claimed errors never reach `result` or `error`.
			flushHeld.set(ctx, flush);
			return {
				text(text) {
					if (held) held.push(text);
					else if (!dropped) ctx.stderr(text);
				},
				diag: ctx.stderr,
				stream() {
					streaming = true;
				},
				event: (value) => ctx.stdout(line("event", serialize(value, "an event"))),
				result(value) {
					if (value === undefined) {
						// The stream still ends with one result line; an `undefined` result has no `data`.
						if (streaming) ctx.stdout('{"type":"result"}');
						flush();
					} else {
						const data = serialize(value, "the command result");
						emit(streaming ? line("result", data) : data);
					}
					ended = streaming;
				},
				error(error) {
					flush();
					if (streaming && !ended) {
						ctx.stdout(JSON.stringify({ type: "error", error: errorData(error) }));
					} else {
						ctx.stderr(JSON.stringify(errorData(error)));
					}
				},
			};
		})
		.postRun((ctx) => flushHeld.get(ctx)?.()),
);
