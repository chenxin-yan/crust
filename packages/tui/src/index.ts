import {
	createCliRenderer,
	type CliRenderer,
	type CliRendererConfig,
	type KeyEvent,
} from "@opentui/core";

export type { CliRenderer, CliRendererConfig };

/** Thrown when stdin/stdout is not a TTY. Match with `error.name === "NonInteractiveError"` (same convention as `@crustjs/prompts`). */
export class NonInteractiveError extends Error {
	override readonly name = "NonInteractiveError";

	constructor(message = "TUI requires an interactive terminal (TTY).") {
		super(message);
	}
}

/** OpenTUI's renderer config plus the signal that cancels the app. */
export interface RunTuiConfig extends CliRendererConfig {
	/**
	 * Destroys the renderer when aborted; `runTui()` then rejects with the signal's reason. Pass
	 * the action's `signal` so the app closes when the invocation is cancelled.
	 */
	signal?: AbortSignal | undefined;
}

/** Mounts an app onto the OpenTUI renderer; may be async. */
export type TuiMount = (renderer: CliRenderer) => void | Promise<void>;

// Mirrors OpenTUI's own exitOnCtrlC match (exact modifiers; `baseCode` only when the typed key is
// one non-ASCII character, as on non-Latin layouts, where it lowercases ASCII uppercase base codes,
// so 67 "C" matches too); its `matchesKeyBinding` helper is not exported.
// This copy drifted once already (OpenTUI 0.6 changed the rule), and signal exits still resolve
// instead of aborting. OpenTUI declined to report why a renderer was destroyed:
// https://github.com/anomalyco/opentui/issues/1693
function isCtrlC(event: KeyEvent): boolean {
	if (!event.ctrl || event.shift || event.meta || event.super) return false;
	if (event.name === "c") return true;
	return /^\P{ASCII}$/u.test(event.name) && (event.baseCode === 99 || event.baseCode === 67);
}

/**
 * Run a full-screen OpenTUI app and resolve once its renderer is destroyed and the terminal is restored.
 *
 * Throws {@link NonInteractiveError} unless stdin and stdout are TTYs. Defaults to the alternate
 * screen, a disabled console, and `exitOnCtrlC: true`; explicit `config` values win. A `mount`
 * error destroys the renderer and is rethrown; an output failure rejects with its error; Ctrl+C
 * cancellation rejects with an `AbortError`, and an aborted `signal` with its reason.
 */
export async function runTui(mount: TuiMount, options: RunTuiConfig = {}): Promise<void> {
	const { signal, ...config } = options;
	if (!(config.stdin ?? process.stdin).isTTY || !(config.stdout ?? process.stdout).isTTY) {
		throw new NonInteractiveError();
	}
	signal?.throwIfAborted();

	let aborted = false;
	const { promise: destroyed, resolve: settle } = Promise.withResolvers<void>();
	const exitOnCtrlC = config.exitOnCtrlC ?? true;
	const renderer = await createCliRenderer({
		screenMode: "alternate-screen",
		consoleMode: "disabled",
		...config,
		exitOnCtrlC,
		onDestroy: () => {
			try {
				config.onDestroy?.();
			} finally {
				settle();
			}
		},
	});

	// Handled up front: OpenTUI rejects `closed` on output failure, which can precede `destroyed`.
	const closed = renderer.closed.then(
		() => undefined,
		(error: unknown) => ({ error }),
	);

	const onKeypress = (event: KeyEvent) => {
		if (isCtrlC(event)) aborted = true;
	};
	if (exitOnCtrlC) renderer.keyInput.on("keypress", onKeypress);

	let cancelled: { reason: unknown } | undefined;
	const onAbort = () => {
		if (renderer.isDestroyed) return;
		cancelled = { reason: signal?.reason };
		renderer.destroy();
	};
	// The signal may have aborted while the renderer was being created.
	if (signal?.aborted) onAbort();
	else signal?.addEventListener("abort", onAbort, { once: true });

	// The app may destroy the renderer while `mount` is still pending (e.g. mount awaits the
	// app's lifetime), so settle on destroy rather than on mount completion.
	let mountFailure: { error: unknown } | undefined;
	// Not on a renderer the signal already destroyed.
	if (!cancelled) {
		void (async () => {
			try {
				await mount(renderer);
			} catch (error) {
				mountFailure = { error };
				if (!renderer.isDestroyed) renderer.destroy();
			}
		})();
	}

	try {
		await destroyed;
	} finally {
		renderer.keyInput.off("keypress", onKeypress);
		signal?.removeEventListener("abort", onAbort);
	}
	// destroy() restores the terminal asynchronously; settle once callers can write to it again.
	const closeFailure = await closed;
	if (mountFailure) throw mountFailure.error;
	if (closeFailure) throw closeFailure.error;
	if (cancelled) throw cancelled.reason;
	if (aborted) throw Object.assign(new Error("TUI cancelled"), { name: "AbortError" });
}
