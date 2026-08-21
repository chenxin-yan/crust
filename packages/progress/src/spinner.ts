// ────────────────────────────────────────────────────────────────────────────
// Spinner — Animated progress spinner for @crustjs/progress
// ────────────────────────────────────────────────────────────────────────────

import { AsyncLocalStorage } from "node:async_hooks";

import { getAmbientTerminalIO } from "@crustjs/utils/terminal";

import { resolveTheme } from "./theme.ts";
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

const BUILTIN_SPINNERS: Record<"dots" | "line" | "arc" | "bounce", SpinnerFrameSet> = {
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
};

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
 * - `"exit"` (default): install a `SIGINT` handler that restores the cursor
 *   and re-raises `SIGINT`, so the process terminates with normal signal
 *   semantics (shells observe exit status 130).
 * - `false`: install no handler — the application owns SIGINT and should
 *   `stop()` the spinner (restoring the cursor) in its own cleanup.
 *
 * The handler is a real `process` signal listener even when output goes to
 * an injected sink, so prefer `false` under test harnesses.
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
	 * this option → ambient {@link withProgressSink} sink → ambient invocation
	 * IO → `process.stderr`.
	 */
	readonly sink?: ProgressSink;
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
	/** The async task to run while the spinner is displayed. */
	readonly task: (controller: Pick<SpinnerHandle, "updateMessage">) => Promise<T>;
}

function resolveSpinner(spinnerType: SpinnerType | undefined): SpinnerFrameSet {
	if (spinnerType === undefined) {
		return BUILTIN_SPINNERS.dots;
	}
	if (typeof spinnerType === "string") {
		return BUILTIN_SPINNERS[spinnerType];
	}
	return spinnerType;
}

function renderFrame(frame: string, message: string, theme: ProgressTheme): string {
	return `${ERASE_LINE}${CURSOR_TO_START}${theme.spinner(frame)} ${theme.message(message)}`;
}

function renderFinal(
	message: string,
	theme: ProgressTheme,
	outcome: SpinnerOutcome,
	erase: boolean,
): string {
	const symbol = outcome === "success" ? SUCCESS_SYMBOL : ERROR_SYMBOL;
	const styleSymbol = outcome === "success" ? theme.success : theme.error;
	const line = `${styleSymbol(symbol)} ${theme.message(message)}\n`;
	return erase ? ERASE_LINE + CURSOR_TO_START + line : line;
}

/** Terminal operations driven by spinners and progress indicators. */
export interface ProgressSink {
	readonly isTTY: boolean;
	write: (text: string) => void;
}

const sinkStorage = new AsyncLocalStorage<ProgressSink>();

/**
 * Run a function with a sink ambiently available to every spinner or
 * progress indicator created in its async scope (unless a per-call
 * `sink` option overrides it). Mirrors `withPromptIO` in
 * `@crustjs/prompts` — test harnesses and embedders redirect indicator
 * output without touching process globals.
 */
export function withProgressSink<T>(sink: ProgressSink, fn: () => T): T {
	return sinkStorage.run(sink, fn);
}

const processSink: ProgressSink = {
	get isTTY() {
		return process.stderr.isTTY ?? false;
	},
	write(text) {
		process.stderr.write(text);
	},
};

function ambientTerminalSink(): ProgressSink | undefined {
	const io = getAmbientTerminalIO();
	if (!io) return undefined;
	return {
		isTTY: false,
		write: (text) => io.stderr(text.endsWith("\n") ? text.slice(0, -1) : text),
	};
}

/** Internal handle constructor shared by both `spinner()` modes and `progress()`. */
export function createSpinnerHandle(options: SpinnerHandleOptions): SpinnerHandle {
	const sink = options.sink ?? sinkStorage.getStore() ?? ambientTerminalSink() ?? processSink;
	const theme = resolveTheme(options.theme);
	const isInteractive = sink.isTTY;
	const { frames, interval } = resolveSpinner(options.spinner);
	const sigint = options.sigint ?? "exit";

	let currentMessage = options.message;
	let frameIndex = 0;
	let started = false;
	let finished = false;
	let timerId: ReturnType<typeof setInterval> | undefined;
	let sigintHandler: (() => void) | undefined;

	function cleanup(): void {
		if (timerId !== undefined) {
			clearInterval(timerId);
			timerId = undefined;
		}
		if (sigintHandler) {
			// TODO: drop cast once https://github.com/oven-sh/bun/issues/40003 is fixed.
			// bun-types 1.4.0's Process override (memoryPressure) shadows the generic
			// EventEmitter removeListener overload, so cast back to the base type.
			(process as NodeJS.EventEmitter).removeListener("SIGINT", sigintHandler);
			sigintHandler = undefined;
		}
	}

	return {
		start() {
			if (started || finished) return;
			started = true;
			if (!isInteractive) return;

			sink.write(HIDE_CURSOR);
			sink.write(renderFrame(frames[0] as string, currentMessage, theme));

			timerId = setInterval(() => {
				frameIndex = (frameIndex + 1) % frames.length;
				sink.write(renderFrame(frames[frameIndex] as string, currentMessage, theme));
			}, interval);

			if (sigint === "exit") {
				sigintHandler = () => {
					cleanup();
					finished = true;
					sink.write(SHOW_CURSOR);
					// `once` already removed this listener. With no listeners left the
					// re-raise hits the default disposition and terminates with real
					// signal semantics — shells observe exit status 130. A host that
					// kept its own persistent listener already ran it for this signal;
					// re-raising would invoke it twice, so leave termination to it.
					if (process.listenerCount("SIGINT") === 0) {
						process.kill(process.pid, "SIGINT");
					}
				};
				process.once("SIGINT", sigintHandler);
			}
		},

		updateMessage(message: string) {
			if (finished) return;
			currentMessage = message;
			if (started && isInteractive) {
				sink.write(renderFrame(frames[frameIndex] as string, currentMessage, theme));
			}
		},

		stop(outcome: SpinnerOutcome = "success", message?: string) {
			if (!started || finished) return;
			finished = true;
			if (message !== undefined) currentMessage = message;
			cleanup();
			sink.write(renderFinal(currentMessage, theme, outcome, isInteractive));
			if (isInteractive) {
				sink.write(SHOW_CURSOR);
			}
		},
	};
}

/**
 * Display a spinner while running an async task. The final line renders `✓`
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
export function spinner(options: SpinnerHandleOptions): SpinnerHandle;
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
