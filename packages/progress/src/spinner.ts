// ────────────────────────────────────────────────────────────────────────────
// Spinner — Animated progress spinner for @crustjs/progress
// ────────────────────────────────────────────────────────────────────────────

import { stringWidth } from "@crustjs/style";
import { isSignalIgnored } from "@crustjs/utils/signals";
import {
	getTerminalIO,
	getTerminalSignal,
	processStderr,
	registerLiveFrame,
	type TerminalOutput,
} from "@crustjs/utils/terminal";

import { defaultThemeFor } from "./theme.ts";
import type { PartialProgressTheme, ProgressTheme } from "./theme.ts";

const ESC = "\x1B[";
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const ERASE_LINE = `${ESC}2K`;
const CURSOR_TO_START = "\r";

interface SpinnerFrameSet {
	readonly frames: readonly string[];
	readonly interval: number;
}

const BUILTIN_SPINNERS = {
	dots: {
		frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
		interval: 80,
	},
	line: {
		frames: ["-", "\\", "|", "/"],
		interval: 130,
	},
	arc: {
		frames: ["◐", "◓", "◑", "◒"],
		interval: 100,
	},
	bounce: {
		frames: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"],
		interval: 120,
	},
} satisfies Record<"dots" | "line" | "arc" | "bounce", SpinnerFrameSet>;

const SUCCESS_SYMBOL = "✓";
const ERROR_SYMBOL = "✗";

export type SpinnerType =
	| "dots"
	| "line"
	| "arc"
	| "bounce"
	| { readonly frames: readonly string[]; readonly interval: number };

/** Final outcome of a spinner or progress indicator. */
export type SpinnerOutcome = "success" | "error";

/**
 * SIGINT policy for interactive spinners.
 *
 * - `"exit"` (default): install a `SIGINT` handler. When no other listener owns
 *   `SIGINT`, it restores the cursor and re-raises `SIGINT`, so the process
 *   terminates with normal signal semantics (shells observe exit status 130).
 *   When another listener owns it (Crust's `execute()` does), that owner ends
 *   the process and the spinner stops with `✗` on the next turn, unless a
 *   `stop()` in the signal's own turn renders its final line first.
 * - `false`: install no handler — the application owns SIGINT and should
 *   `stop()` the spinner (restoring the cursor) in its own cleanup.
 *
 * The handler is a real `process` signal listener even when output goes to
 * an injected sink, so prefer `false` under test harnesses. A `SIGINT` the
 * process inherited as ignored stays ignored.
 */
export type SpinnerSigintPolicy = "exit" | false;

export interface SpinnerHandleOptions {
	/** The message displayed alongside the spinner. */
	readonly message: string;
	/**
	 * Spinner animation style.
	 *
	 * @default "dots"
	 */
	readonly spinner?: SpinnerType;
	/** Per-spinner theme overrides. */
	readonly theme?: PartialProgressTheme;
	/**
	 * SIGINT policy.
	 *
	 * @default "exit"
	 */
	readonly sigint?: SpinnerSigintPolicy;
	/**
	 * Terminal sink receiving the rendered output. Resolution order:
	 * this option → ambient {@link withTerminalIO} output → standard error, written through
	 * the same writer as Core's default `stderr`.
	 */
	readonly sink?: TerminalOutput;
	/**
	 * Stops the spinner with `✗` and its current message when aborted while it runs, unless
	 * `stop()` is called in the same turn (a `finally` that cancellation reaches). Defaults to
	 * the ambient {@link withTerminalIO} signal, which inside a Crust command is the invocation's
	 * `signal`. A spinner started after the abort, to show cleanup, ignores it.
	 */
	readonly signal?: AbortSignal;
}

export interface SpinnerHandle {
	/** Begin rendering. No-op if already started. */
	start: () => void;
	/** Update the message displayed alongside the spinner. */
	updateMessage: (message: string) => void;
	/**
	 * Finish the spinner: render the final `✓`/`✗` line and restore the
	 * cursor. Idempotent — later calls are no-ops.
	 *
	 * @param outcome - Final symbol to render. @default "success"
	 * @param message - Final message. Defaults to the last message shown.
	 */
	stop: (outcome?: SpinnerOutcome, message?: string) => void;
}

export interface SpinnerOptions<T> extends SpinnerHandleOptions {
	/** The task to run while the spinner is displayed; it may return a value or a promise. */
	readonly task: (controller: Pick<SpinnerHandle, "updateMessage">) => T | Promise<T>;
}

function resolveSpinner(spinnerType: SpinnerType | undefined): SpinnerFrameSet {
	if (spinnerType === undefined) {
		return BUILTIN_SPINNERS.dots;
	}
	if (typeof spinnerType === "string") {
		return BUILTIN_SPINNERS[spinnerType];
	}
	if (spinnerType.frames.length === 0)
		throw new Error("A custom spinner requires at least one frame");
	return spinnerType;
}

function frameAt(frames: readonly string[], index: number): string {
	const frame = frames[index];
	if (frame === undefined) throw new Error("Spinner frame index is out of bounds");
	return frame;
}

let graphemes: Intl.Segmenter | undefined;

// CSI (SGR styles) and OSC (hyperlinks) sequences. Anything else is measured as text, which
// can only overcount the row and cut early.
// oxlint-disable-next-line no-control-regex -- matching escape sequences
const ESCAPE = /\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;
// Controls that move the cursor down a row (terminals treat VT and FF as LF), alone or in a
// cluster such as "\r\n".
const LINE_BREAK = /[\n\v\f\x85]/;

/**
 * `text` if it fits one row of `width` columns; otherwise cut to fit, ending in "…". A cut keeps
 * every escape sequence, so styles the kept part opened are still closed.
 */
function fitRow(text: string, width: number): string {
	graphemes ??= new Intl.Segmenter();
	let column = 0;
	let cut = 0;
	let start = 0;
	for (const escape of [...text.matchAll(ESCAPE), undefined]) {
		const end = escape?.index ?? text.length;
		// Walk graphemes: a wide character that does not fit is cut whole.
		for (const { segment, index } of graphemes.segment(text.slice(start, end))) {
			// A carriage return rewinds to the start of the current row; the text after it overwrites.
			if (segment === "\r") column = 0;
			else if (LINE_BREAK.test(segment) || (column += stringWidth(segment)) > width) {
				const escapes = text.slice(cut).match(ESCAPE)?.join("") ?? "";
				return `${text.slice(0, cut)}${width > 0 ? "…" : ""}${escapes}`;
			}
			// Leave a column for the ellipsis.
			if (column < width) cut = start + index + segment.length;
		}
		if (escape) start = end + escape[0].length;
	}
	return text;
}

function renderFinal(
	message: string,
	theme: ProgressTheme,
	outcome: SpinnerOutcome,
	erase: string,
): string {
	const symbol = outcome === "success" ? SUCCESS_SYMBOL : ERROR_SYMBOL;
	const styleSymbol = outcome === "success" ? theme.success : theme.error;
	return `${erase}${styleSymbol(symbol)} ${theme.message(message)}\n`;
}

export type { TerminalIO, TerminalOutput } from "@crustjs/utils/terminal";
export { withTerminalIO } from "@crustjs/utils/terminal";

/**
 * Internal handle constructor shared by both `spinner()` modes and `progress()`.
 * `suffix` follows the message and is never cut when a frame is fitted to one row.
 */
export function createSpinnerHandle(
	options: SpinnerHandleOptions,
	suffix: () => string = () => "",
): SpinnerHandle {
	const sink = options.sink ?? getTerminalIO()?.output ?? processStderr;
	const theme = { ...defaultThemeFor(sink), ...options.theme };
	const isInteractive = sink.isTTY ?? false;
	const { frames, interval } = resolveSpinner(options.spinner);
	const sigint = options.sigint ?? "exit";
	const signal = options.signal ?? getTerminalSignal();

	let currentMessage = options.message;
	let frameIndex = 0;
	let started = false;
	let finished = false;
	let timerId: ReturnType<typeof setInterval> | undefined;
	let sigintHandler: (() => void) | undefined;
	let exitHandler: (() => void) | undefined;
	let releaseFrame: (() => void) | undefined;
	// Deferred a turn so a `stop()` with its own message, run by the cancellation itself, wins.
	const onAbort = () => setImmediate(() => handle.stop("error"));

	function drawFrame(): void {
		const width = (sink.columns || 80) - 1;
		const symbol = `${theme.spinner(frameAt(frames, frameIndex))} `;
		const tail = suffix();
		// Cut the message first, so the count survives; text the theme adds counts against it.
		const room = width - stringWidth(symbol + theme.message(tail));
		const frame = symbol + theme.message(fitRow(currentMessage, room) + tail);
		// The frame fits one row, short of the last column, and the cursor stays at its end, so a
		// redraw only erases the cursor's row. The terminal does not report where the cursor is:
		// rewinding over wrapped rows would erase lines the task printed between frames. When the
		// symbol and count alone overflow the row, the whole frame is cut, count included.
		sink.write(ERASE_LINE + CURSOR_TO_START + fitRow(frame, width));
	}

	function cleanup(): void {
		if (timerId !== undefined) {
			clearInterval(timerId);
			timerId = undefined;
		}
		if (sigintHandler) {
			process.removeListener("SIGINT", sigintHandler);
			sigintHandler = undefined;
		}
		if (exitHandler) {
			process.removeListener("exit", exitHandler);
			exitHandler = undefined;
		}
		releaseFrame?.();
		releaseFrame = undefined;
		signal?.removeEventListener("abort", onAbort);
	}

	const handle: SpinnerHandle = {
		start() {
			if (started || finished) return;
			started = true;
			if (signal && !signal.aborted) signal.addEventListener("abort", onAbort, { once: true });
			if (!isInteractive) return;

			sink.write(HIDE_CURSOR);
			// `process.exit()` skips stop(); "exit" listeners run synchronously, so restore here.
			exitHandler = () => sink.write(SHOW_CURSOR);
			process.once("exit", exitHandler);
			try {
				drawFrame();
			} catch (error) {
				// A throwing theme or sink must not leak the exit listener or leave the cursor hidden.
				cleanup();
				try {
					sink.write(SHOW_CURSOR);
				} catch {
					// The draw failure wins.
				}
				throw error;
			}

			timerId = setInterval(() => {
				frameIndex = (frameIndex + 1) % frames.length;
				drawFrame();
			}, interval);
			releaseFrame = registerLiveFrame({
				clear: () => sink.write(ERASE_LINE + CURSOR_TO_START),
				redraw: drawFrame,
			});

			// An inherited ignore (background job) stays: listening would make SIGINT fatal again.
			if (sigint === "exit" && !isSignalIgnored("SIGINT")) {
				const handler = () => {
					// `once` already removed this listener for an emitted signal.
					process.removeListener("SIGINT", handler);
					sigintHandler = undefined;
					// A host that kept its own persistent listener (Crust's `execute()`) already ran it
					// for this signal and owns ending the process; re-raising would invoke it twice. Stop
					// like an abort, so a host whose cancellation never reaches the spinner (its own
					// listener, an unrelated `signal`) is not kept alive by the animation timer.
					if (process.listenerCount("SIGINT") > 0) {
						onAbort();
						return;
					}
					cleanup();
					finished = true;
					sink.write(SHOW_CURSOR);
					// With no listeners left the re-raise hits the default disposition and terminates
					// with real signal semantics — shells observe exit status 130.
					process.kill(process.pid, "SIGINT");
				};
				sigintHandler = handler;
				process.once("SIGINT", handler);
			}
		},

		updateMessage(message: string) {
			if (finished) return;
			currentMessage = message;
			if (started && isInteractive) {
				drawFrame();
			}
		},

		stop(outcome: SpinnerOutcome = "success", message?: string) {
			if (finished) return;
			finished = true;
			if (message !== undefined) currentMessage = message;
			cleanup();
			// `finished` blocks retries, so a throwing theme or sink must not skip cursor
			// restore. The first failure wins; boxed because any value (even undefined) can be thrown.
			let renderFailure: { error: unknown } | undefined;
			try {
				const erase = started && isInteractive ? ERASE_LINE + CURSOR_TO_START : "";
				sink.write(renderFinal(currentMessage + suffix(), theme, outcome, erase));
			} catch (error) {
				renderFailure = { error };
			}
			if (started && isInteractive) {
				try {
					sink.write(SHOW_CURSOR);
				} catch (error) {
					if (!renderFailure) throw error;
				}
			}
			if (renderFailure) throw renderFailure.error;
		},
	};
	return handle;
}

/**
 * Display a spinner while running a task. The final line renders `✓`
 * when the task resolves and `✗` when it throws (the error is re-thrown).
 */
export function spinner<T>(options: SpinnerOptions<T>): Promise<T>;
/**
 * Create an imperative spinner whose `start` and `stop` can live in
 * different call frames (workflow engines, logger adapters).
 *
 * Non-interactive stderr renders no animation frames — only the final
 * `✓`/`✗` line on `stop()`.
 */
export function spinner(
	options: SpinnerHandleOptions & { readonly task?: undefined },
): SpinnerHandle;
export function spinner<T>(
	options: SpinnerHandleOptions & { task?: SpinnerOptions<T>["task"] },
): Promise<T> | SpinnerHandle {
	const handle = createSpinnerHandle(options);
	const { task } = options;
	if (!task) return handle;

	handle.start();
	// Route sync throws from `task` into the rejection path so the interval,
	// cursor, and SIGINT listener are still cleaned up.
	return Promise.resolve()
		.then(() => task(handle))
		.then(
			(result) => {
				handle.stop("success");
				return result;
			},
			(error) => {
				handle.stop("error");
				throw error;
			},
		);
}
