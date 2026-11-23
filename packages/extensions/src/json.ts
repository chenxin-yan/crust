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
		description: "Print machine-readable JSON output",
	},
} as const;

/**
 * `CrustError` serializes through its own `toJSON()`; any other failure exposes only its message,
 * plus the details an error opts into with the `detailsKey` property (`jsonErrorDetails`).
 */
function errorData(error: unknown, detailsKey: symbol): unknown {
	if (error instanceof CrustError) return error.toJSON();
	if (!(error instanceof Error)) return { message: String(error) };
	const details: unknown = (error as Error & Record<symbol, unknown>)[detailsKey];
	return details === undefined ? { message: error.message } : { message: error.message, details };
}

/** Per invocation: writes the stdout text its renderer still holds to stderr. */
const flushHeld = /* @__PURE__ */ new WeakMap<ExtensionContext, () => void>();

/**
 * Adds a recursive `--json` flag. With it, the Command Action's result is
 * printed to stdout as one line of JSON (nothing for an `undefined` result),
 * what the action and Contexts write to `stderr` goes to stderr, and failures are
 * written to stderr as JSON. What they write to `stdout` goes to stderr too, live,
 * except in a command that declares `.output()`: it returns data, so its JSON
 * result replaces that text, and the text is written to stderr only when the
 * command returns nothing, fails, or is cancelled. An async generator action
 * streams NDJSON on stdout instead: one `{"type":"event","data":…}` line per
 * yield, then one `{"type":"result","data":…}` or `{"type":"error","error":…}`
 * line. A cancelled invocation (exit code 130, 143 after SIGTERM, or 141 after a
 * closed stdout), or a failure another Extension's `onError` hook claims, ends
 * the stream without that final line, so consumers should check the exit status. Cleanup that fails after a failure
 * was rendered, or while a cancellation unwinds, is written to stderr as one
 * `{"type":"cleanup","error":…}` line. A `PARSE` error that stops the invocation
 * before the flag is read is written to stderr as JSON too when `--json` was typed
 * before any `--`. Exit codes are unchanged. Adds a "JSON output" section to the root
 * command's documentation saying so.
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
			const { parseJsonValue, jsonErrorDetails } = await import("@crustjs/utils/json");
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
			// result is out, written to stderr otherwise. shortcut: held text stays in memory until the
			// invocation ends; add a size cap that flushes to stderr if anyone hits it.
			let held: (string | Uint8Array)[] | undefined = ctx.command.output ? [] : undefined;
			let dropped = false;
			const flush = () => {
				if (!held) return;
				const chunks = held;
				held = undefined;
				for (const chunk of chunks) ctx.stderr.write(chunk);
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
				text(chunk) {
					if (held) held.push(typeof chunk === "string" ? chunk : Buffer.from(chunk));
					else if (!dropped) ctx.stderr.write(chunk);
				},
				diag: ctx.stderr.write,
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
						ctx.stdout(
							JSON.stringify({ type: "error", error: errorData(error, jsonErrorDetails) }),
						);
					} else {
						ctx.stderr(JSON.stringify(errorData(error, jsonErrorDetails)));
					}
				},
				// Always stderr, even while streaming, so stdout keeps exactly one final line.
				cleanup: (error) =>
					ctx.stderr(
						JSON.stringify({ type: "cleanup", error: errorData(error, jsonErrorDetails) }),
					),
			};
		})
		.postRun((ctx) => flushHeld.get(ctx)?.())
		// Argv that fails to parse never selects the renderer, but the person still asked for JSON.
		.onError((error, ctx) => {
			if (flushHeld.has(ctx) || !(error instanceof CrustError) || !error.is("PARSE")) return;
			// shortcut: a `--json` meant for a passthrough argument also selects JSON here, since the hook cannot see where passthrough starts; upgrade if Core reports that boundary.
			const end = ctx.argv.indexOf("--");
			const words = end === -1 ? ctx.argv : ctx.argv.slice(0, end);
			if (!words.includes("--json")) return;
			ctx.stderr(JSON.stringify(error.toJSON()));
			return true;
		}),
);
