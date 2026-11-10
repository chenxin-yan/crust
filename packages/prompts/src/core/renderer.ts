// ────────────────────────────────────────────────────────────────────────────
// Renderer — Core terminal rendering engine for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import * as readline from "node:readline";

import { stringWidth } from "@crustjs/style";
import {
	getTerminalIO,
	getTerminalSignal,
	type TerminalIO,
	type TerminalInput,
	type TerminalOutput,
} from "@crustjs/utils/terminal";

import { defaultThemeFor } from "./theme.ts";
import type { PartialPromptTheme, PromptTheme } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type { TerminalInput, TerminalIO, TerminalOutput } from "@crustjs/utils/terminal";
export { withTerminalIO } from "@crustjs/utils/terminal";

/** Streams a prompt draws on, and the signal that cancels it. */
export type PromptIO = Required<Pick<TerminalIO, "input" | "output">> & Pick<TerminalIO, "signal">;

/**
 * Resolve explicit, ambient, then process-global streams; the signal resolves from explicit IO,
 * then the ambient scope or running Crust invocation.
 */
export function resolvePromptIO(io?: TerminalIO): PromptIO {
	const ambient = getTerminalIO();
	return {
		input: io?.input ?? ambient?.input ?? process.stdin,
		output: io?.output ?? ambient?.output ?? process.stderr,
		signal: io?.signal ?? getTerminalSignal(),
	};
}

/**
 * Structured keypress event parsed from raw terminal input.
 */
export interface KeypressEvent {
	/** The character string for printable keys, or empty string for special keys */
	readonly char: string;
	/** Key name (e.g., "return", "backspace", "up", "down", "left", "right", "tab") */
	readonly name: string;
	/** Whether Ctrl was held */
	readonly ctrl: boolean;
	/** Whether Meta/Alt was held */
	readonly meta: boolean;
	/** Whether Shift was held */
	readonly shift: boolean;
}

/**
 * Symbol used internally to discriminate submit results from state updates.
 * Using a symbol prevents collisions with user-defined state types.
 */
const SUBMIT: unique symbol = Symbol("submit");

/**
 * A submit action wrapping the final value.
 */
export interface SubmitResult<T> {
	readonly [SUBMIT]: T;
}

/**
 * Create a submit result to resolve the prompt with the given value.
 *
 * @param value - The value to resolve the prompt with
 * @returns A submit action object
 *
 * @example
 * ```ts
 * handleKey: (key, state) => {
 *   if (key.name === "return") return submit(state.value);
 *   return { ...state, value: state.value + key.char };
 * }
 * ```
 */
export function submit<T>(value: T): SubmitResult<T> {
	return { [SUBMIT]: value };
}

/**
 * Result of a keypress handler.
 * - Return updated state to continue the prompt
 * - Return `submit(value)` to resolve the prompt with a value
 */
export type HandleKeyResult<S, T> = S | SubmitResult<T>;

/**
 * Configuration for `runPrompt` — each prompt provides these functions
 * to define its behavior.
 */
export interface PromptConfig<S, T> {
	/** Render the current state to a string (may contain newlines) */
	readonly render: (state: S, theme: PromptTheme) => string;
	/** Handle a keypress event — return new state or `submit(value)` to resolve */
	readonly handleKey: (
		key: KeypressEvent,
		state: S,
	) => HandleKeyResult<S, T> | Promise<HandleKeyResult<S, T>>;
	/** Initial state for the prompt */
	readonly initialState: S;
	/** Optional partial theme; merged onto `defaultTheme` styles detected from the output stream. */
	readonly theme?: PartialPromptTheme;
	/**
	 * Optional: render the final submitted state.
	 * Called after submit with the final state and submitted value.
	 * If not provided, the last render output is left on screen.
	 */
	readonly renderSubmitted?: (state: S, value: T, theme: PromptTheme) => string;
}

// ────────────────────────────────────────────────────────────────────────────
// Stream guards
// ────────────────────────────────────────────────────────────────────────────

/** Tracks active prompts so a stream can only drive one prompt at a time. */
const activeInputs = new WeakSet<TerminalInput>();
/** Tracks active outputs — concurrent frames on one stream would erase each other. */
const activeOutputs = new WeakSet<TerminalOutput>();

// ────────────────────────────────────────────────────────────────────────────
// ANSI escape sequences
// ────────────────────────────────────────────────────────────────────────────

const ESC = "\x1B[";
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;

/**
 * Count the number of physical terminal lines a string occupies,
 * accounting for line wrapping based on terminal column width.
 *
 * Each logical line (split by `\n`) may wrap across multiple physical
 * lines when its visible width exceeds the terminal columns.
 *
 * @param content - The rendered string (may contain ANSI escapes and newlines)
 * @param columns - Terminal width in columns
 * @returns Number of physical lines the content occupies
 */
function physicalLineCount(content: string, columns: number): number {
	const lines = content.split("\n");
	let count = 0;
	for (const line of lines) {
		const width = stringWidth(line);
		// An empty line still occupies one physical row
		count += width === 0 ? 1 : Math.ceil(width / columns);
	}
	return count;
}

// ────────────────────────────────────────────────────────────────────────────
// TTY detection
// ────────────────────────────────────────────────────────────────────────────

/**
 * Error thrown when a prompt requires an interactive TTY but none is available.
 */
export class NonInteractiveError extends Error {
	constructor(message?: string) {
		super(message ?? "Prompts require an interactive terminal (TTY).");
		this.name = "NonInteractiveError";
	}
}

/**
 * Check whether the resolved prompt input is an interactive TTY.
 * @returns `true` if the input is a TTY, `false` otherwise
 */
export function isTTY(input: Pick<TerminalInput, "isTTY"> = resolvePromptIO().input): boolean {
	return !!input.isTTY;
}

/**
 * Check that the resolved prompt input is an interactive TTY.
 * @throws {NonInteractiveError} when the input is not a TTY
 */
export function assertTTY(input: Pick<TerminalInput, "isTTY"> = resolvePromptIO().input): void {
	if (!isTTY(input)) {
		throw new NonInteractiveError();
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Core prompt runner
// ────────────────────────────────────────────────────────────────────────────

/**
 * Check if a handleKey result is a submit action.
 */
function isSubmit<S, T>(result: HandleKeyResult<S, T>): result is SubmitResult<T> {
	return typeof result === "object" && result !== null && SUBMIT in result;
}

/**
 * Run an interactive prompt with the given configuration.
 *
 * Manages the full terminal lifecycle:
 * 1. Asserts the resolved input and output are TTYs
 * 2. Enables raw mode and hides cursor
 * 3. Renders initial state
 * 4. Listens for keypress events, delegating to `handleKey`
 * 5. Re-renders on state changes
 * 6. On submit, renders final state, cleans up, and resolves
 *
 * Input and output resolve from explicit IO, the ambient terminal scope,
 * then `process.stdin` / `process.stderr`, keeping stdout clean by default.
 * The `signal` resolves from explicit IO, then the ambient scope, which inside a
 * Crust command is the invocation's signal. When it aborts, the prompt restores
 * the terminal and rejects with `signal.reason`.
 *
 * @param config - Prompt configuration (render, handleKey, initialState, theme)
 * @param io - Optional input/output streams and cancellation signal, resolved per field.
 * @returns Promise resolving to the user's submitted value
 * @throws {NonInteractiveError} when the resolved input or output is not a TTY
 * @throws `signal.reason` when the signal is or becomes aborted
 *
 * @example
 * ```ts
 * const value = await runPrompt({
 *   initialState: { value: "" },
 *   render: (state, theme) => `${theme.prefix("?")} Enter value: ${state.value}`,
 *   handleKey: (key, state) => {
 *     if (key.name === "return") return submit(state.value);
 *     return { ...state, value: state.value + key.char };
 *   },
 * });
 * ```
 */
export function runPrompt<S, T>(config: PromptConfig<S, T>, io?: TerminalIO): Promise<T> {
	const { render, handleKey, initialState, renderSubmitted } = config;
	const { input: stdin, output, signal } = resolvePromptIO(io);
	const theme = { ...defaultThemeFor(output), ...config.theme };
	// SAFETY: readline's cursor helpers only call write(), which TerminalOutput provides.
	const readlineOutput = output as NodeJS.WritableStream;

	return new Promise<T>((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		// Guard against concurrent prompts sharing an input or output stream.
		if (activeInputs.has(stdin) || activeOutputs.has(output)) {
			reject(
				new Error(
					"Cannot run multiple prompts concurrently on the same input or output stream. Await each prompt before starting the next.",
				),
			);
			return;
		}

		assertTTY(stdin);
		assertTTY(output);
		activeInputs.add(stdin);
		activeOutputs.add(output);

		let state = initialState;
		let prevLineCount = 0;
		let isCleanedUp = false;
		let rawModeEnabled = false;

		// ── Cleanup helper ──────────────────────────────────────────────
		function cleanup(): void {
			if (isCleanedUp) return;
			isCleanedUp = true;
			process.removeListener("exit", cleanup);
			signal?.removeEventListener("abort", onAbort);
			activeInputs.delete(stdin);
			activeOutputs.delete(output);

			stdin.removeListener("keypress", onKeypress);

			if (rawModeEnabled) {
				stdin.setRawMode?.(false);
			}

			stdin.pause();
			output.write(SHOW_CURSOR);
		}

		// ── Render helper ───────────────────────────────────────────────
		function renderFrame(content: string): void {
			const columns = output.columns || 80;

			// Erase previous frame
			if (prevLineCount > 0) {
				readline.cursorTo(readlineOutput, 0);
				readline.moveCursor(readlineOutput, 0, -(prevLineCount - 1));
				readline.clearScreenDown(readlineOutput);
			}

			output.write(content);

			// Track physical line count (accounting for wrapping) for next erase
			prevLineCount = physicalLineCount(content, columns);
		}

		// ── Keypress handler ────────────────────────────────────────────
		// Serialize keypress processing to prevent race conditions when
		// multiple events arrive rapidly (e.g., pasting text).
		let processing: Promise<void> = Promise.resolve();

		// Debounce rendering: when multiple keypresses arrive in the same
		// event-loop tick (e.g., pasting text), we defer rendering with
		// setTimeout(0) so only a single render fires after all state
		// updates are applied.  Normal single keystrokes are unaffected —
		// they still produce one render with no perceptible delay.
		let renderPending: ReturnType<typeof setTimeout> | null = null;

		function scheduleRender(): void {
			if (renderPending !== null) return;
			renderPending = setTimeout(() => {
				renderPending = null;
				if (isCleanedUp) return;
				// The keypress handler's try/catch has already returned by the time
				// this timer fires, so a throwing render must be caught here or it
				// escapes as an uncaught exception with the prompt still pending.
				try {
					renderFrame(render(state, theme));
				} catch (err) {
					cleanup();
					reject(err);
				}
			}, 0);
		}

		function flushRender(): void {
			if (renderPending !== null) {
				clearTimeout(renderPending);
				renderPending = null;
			}
		}

		// The process may end by the signal right after, skipping "exit" listeners.
		function onAbort(): void {
			flushRender();
			output.write("\n");
			cleanup();
			reject(signal?.reason);
		}

		function onKeypress(
			ch: string | undefined,
			key?: {
				name?: string;
				ctrl?: boolean;
				meta?: boolean;
				shift?: boolean;
			},
		): void {
			// Ctrl+C → reject with a standard AbortError (handle immediately)
			if (key?.ctrl && key.name === "c") {
				flushRender();
				output.write("\n");
				cleanup();
				reject(new DOMException("Prompt was cancelled.", "AbortError"));
				return;
			}

			const event: KeypressEvent = {
				char: ch ?? "",
				// Ctrl+J (LF) arrives as "enter"; treat it as Return so it submits instead of inserting a newline.
				name: key?.name === "enter" ? "return" : (key?.name ?? ""),
				ctrl: key?.ctrl ?? false,
				meta: key?.meta ?? false,
				shift: key?.shift ?? false,
			};

			// Chain onto the processing queue so each keypress waits for
			// the previous one to finish before reading state
			processing = processing.then(async () => {
				if (isCleanedUp) return;

				try {
					const result = await handleKey(event, state);
					// A render failure or cancellation may have released these streams while awaiting.
					if (isCleanedUp) return;

					if (isSubmit(result)) {
						// Submit must render immediately — cancel any pending render
						flushRender();
						const value = result[SUBMIT];
						// Render final submitted state
						if (renderSubmitted) {
							renderFrame(renderSubmitted(state, value, theme));
						}
						// Write newline to move past the prompt
						output.write("\n");
						cleanup();
						resolve(value);
					} else {
						state = result;
						scheduleRender();
					}
				} catch (err) {
					flushRender();
					cleanup();
					reject(err);
				}
			});
		}

		// ── Initialize ──────────────────────────────────────────────────
		try {
			readline.emitKeypressEvents(stdin);
			if (stdin.setRawMode) {
				stdin.setRawMode(true);
				rawModeEnabled = true;
			}
			stdin.resume();
			output.write(HIDE_CURSOR);
			// `process.exit()` skips submit/cancel; "exit" listeners run synchronously, so restore here.
			process.once("exit", cleanup);

			renderFrame(render(state, theme));

			stdin.on("keypress", onKeypress);
			signal?.addEventListener("abort", onAbort, { once: true });
		} catch (err) {
			cleanup();
			reject(err);
		}
	});
}
