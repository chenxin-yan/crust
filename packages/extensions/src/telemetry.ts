import {
	type ExtensionContext,
	type ExtensionFactory,
	type ExtensionId,
	type InvocationOutcome,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const TELEMETRY: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:telemetry");

/** One usage event. It never carries argument or flag values. */
export interface TelemetryEvent {
	/** Canonical names from the application root through the command that ran, e.g. `["acme", "deploy"]`. */
	readonly command: readonly string[];
	/** The invocation's outcome as this Extension's `postRun` saw it. */
	readonly outcome: InvocationOutcome["status"];
	/** Whole milliseconds from this Extension's `setup` to its `postRun`; `0` when its `setup` never ran. */
	readonly durationMs: number;
	/** Whether `CI` is set to something other than empty, `0`, or `false`. */
	readonly ci: boolean;
}

export interface TelemetryOptions {
	/**
	 * Environment variable through which the user turns telemetry on or off, such as
	 * `"ACME_TELEMETRY"`. `0` or `false` (any letter case) turns it off; under `"opt-in"`,
	 * any other non-empty value turns it on. `DO_NOT_TRACK` set to anything but empty or `0`
	 * turns it off in both modes.
	 */
	env: string;
	/** `"opt-in"` sends only when the user sets `env`; `"opt-out"` sends unless the user turns it off. */
	enabled: "opt-in" | "opt-out";
	/**
	 * Delivers one event. Waited for at most 1 second, when `signal` aborts with a `TimeoutError`;
	 * pass `signal` to the request so it ends too, or it keeps the process alive. Failures are ignored.
	 */
	send: (event: TelemetryEvent, options: { readonly signal: AbortSignal }) => Promise<void>;
}

const SEND_TIMEOUT_MS = 1_000;

/** Per invocation: `performance.now()` when this Extension's `setup` ran. */
const startedAt = /* @__PURE__ */ new WeakMap<ExtensionContext, number>();

/** Read at `postRun` from `process.env`: `execute({ env })` only feeds flags' `env` fallbacks. */
function isSending(options: TelemetryOptions): boolean {
	const doNotTrack = process.env.DO_NOT_TRACK;
	if (doNotTrack && doNotTrack !== "0") return false;
	const value = process.env[options.env];
	if (value === "0" || value?.toLowerCase() === "false") return false;
	return options.enabled === "opt-out" || !!value;
}

/**
 * Sends one usage event per invocation through the app's `send`, after the invocation settles.
 * Reports the outcome this Extension's `postRun` sees; an unknown command or flag fails before setup and sends nothing.
 *
 * @see https://crustjs.com/docs/modules/extensions/telemetry
 */
export const telemetry: ExtensionFactory<[options: TelemetryOptions]> =
	/* @__PURE__ */ defineExtension(TELEMETRY).factory((extension, options) =>
		extension
			.setup((ctx) => {
				startedAt.set(ctx, performance.now());
			})
			.postRun(async (ctx, outcome) => {
				if (!isSending(options)) return;
				const started = startedAt.get(ctx);
				const durationMs = started === undefined ? 0 : Math.round(performance.now() - started);
				// Loaded only when sending, keeping it out of every CLI's startup.
				const { isCI } = await import("@crustjs/utils/terminal");
				const event: TelemetryEvent = {
					command: ctx.commandPath,
					outcome: outcome.status,
					durationMs,
					ci: isCI(),
				};
				// Its own deadline, not `ctx.signal`: that is already aborted after Ctrl-C.
				const deadline = new AbortController();
				const timer = setTimeout(
					() => deadline.abort(new DOMException("Telemetry send timed out.", "TimeoutError")),
					SEND_TIMEOUT_MS,
				);
				try {
					// The race stops the wait even when `send` ignores the signal.
					await Promise.race([
						options.send(event, { signal: deadline.signal }),
						new Promise<void>((resolve) => {
							deadline.signal.addEventListener("abort", () => resolve(), { once: true });
						}),
					]);
				} catch {
					// Telemetry never changes the invocation's outcome.
				} finally {
					clearTimeout(timer);
				}
			}),
	);
