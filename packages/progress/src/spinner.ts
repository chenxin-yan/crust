// ────────────────────────────────────────────────────────────────────────────
// Spinner — Animated progress spinner for @crustjs/progress
// ────────────────────────────────────────────────────────────────────────────

import { stripVTControlCharacters } from "node:util";

import { stringWidth } from "@crustjs/style";
import {
	getTerminalIO,
	type TerminalIO as SharedTerminalIO,
	type TerminalOutput,
	withTerminalIO as withSharedTerminalIO,
} from "@crustjs/utils/terminal";

import { defaultThemeFor } from "./theme.ts";
import type { PartialProgressTheme, ProgressTheme } from "./theme.ts";

const ESC = "\x1B[";
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const ERASE_DOWN = `${ESC}J`;
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
	 * this option → ambient {@link withTerminalIO} output → `process.stderr`.
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

/** Physical rows `text` occupies once the terminal wraps it at `columns`. */
function rowCount(text: string, columns: number): number {
	graphemes ??= new Intl.Segmenter();
	let rows = 0;
	for (const line of stripVTControlCharacters(text).split("\n")) {
		rows++;
		let column = 0;
		// Walk graphemes: a wide character that does not fit wraps whole, leaving the row's last cell unused.
		for (const { segment } of graphemes.segment(line)) {
			// A carriage return rewinds to the start of the current row; the text after it overwrites.
			if (segment === "\r") {
				column = 0;
				continue;
			}
			const width = stringWidth(segment);
			if (column + width > columns) {
				rows++;
				column = 0;
			}
			column += width;
		}
	}
	return rows;
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

/** Terminal IO shared by prompts, spinners, and progress indicators. */
export type TerminalIO = SharedTerminalIO;

/** Writable-compatible output driven by spinners and progress indicators. */
export type ProgressSink = TerminalOutput;

export { withTerminalIO } from "@crustjs/utils/terminal";

/** Run a function with an ambient output sink for progress indicators. */
export function withProgressSink<T>(sink: ProgressSink, fn: () => T): T {
	return withSharedTerminalIO({ output: sink }, fn);
}

/** Internal handle constructor shared by both `spinner()` modes and `progress()`. */
export function createSpinnerHandle(options: SpinnerHandleOptions): SpinnerHandle {
	const sink = options.sink ?? getTerminalIO()?.output ?? process.stderr;
	const theme = { ...defaultThemeFor(sink), ...options.theme };
	const isInteractive = sink.isTTY ?? false;
	const { frames, interval } = resolveSpinner(options.spinner);
	const sigint = options.sigint ?? "exit";

	let currentMessage = options.message;
	let frameIndex = 0;
	let started = false;
	let finished = false;
	let previousFrame: string | undefined;
	let timerId: ReturnType<typeof setInterval> | undefined;
	let sigintHandler: (() => void) | undefined;
	let exitHandler: (() => void) | undefined;

	function eraseFrame(): string {
		const rewind =
			previousFrame === undefined ? "" : `${ESC}${rowCount(previousFrame, sink.columns || 80)}A`;
		return rewind + CURSOR_TO_START + ERASE_DOWN;
	}

	function drawFrame(): void {
		const line = `${theme.spinner(frameAt(frames, frameIndex))} ${theme.message(currentMessage)}`;
		// Keep the cursor on a separate logical line so the frame can reflow even
		// on terminals that do not reflow the cursor line. Recount it when erasing.
		sink.write(eraseFrame() + line + "\r\n");
		previousFrame = line;
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
	}

	return {
		start() {
			if (started || finished) return;
			started = true;
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
				const erase = started && isInteractive ? eraseFrame() : "";
				sink.write(renderFinal(currentMessage, theme, outcome, erase));
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
