// ────────────────────────────────────────────────────────────────────────────
// Renderer — Core terminal rendering engine for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import { AsyncLocalStorage } from "node:async_hooks";
import * as readline from "node:readline";
import type { Readable } from "node:stream";
import { Writable } from "node:stream";

import { stringWidth } from "@crustjs/style";
import { getAmbientTerminalIO } from "@crustjs/utils/terminal";

import { resolveTheme } from "./theme.ts";
import type { PartialPromptTheme, PromptTheme } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** A readable stream that can drive an interactive terminal prompt. */
export type PromptInput = Readable & {
	readonly isTTY?: boolean;
	readonly isRaw?: boolean;
	setRawMode?: (mode: boolean) => void;
};

export type PromptOutput = Writable & {
	readonly columns?: number;
};

/** Streams used to render and receive input for a prompt. */
export interface PromptIO {
	readonly input?: PromptInput;
	readonly output?: PromptOutput;
}

const promptIOStorage = new AsyncLocalStorage<PromptIO>();

/** Run a function with prompt streams available to prompts created in its async scope. */
export function withPromptIO<T>(io: PromptIO, fn: () => T): T {
	return promptIOStorage.run(io, fn);
}

function ambientTerminalWritable(): PromptOutput | undefined {
	const io = getAmbientTerminalIO();
	if (!io) return undefined;

	let pending = "";
	return new Writable({
		decodeStrings: false,
		write(chunk, _encoding, callback) {
			pending += chunk.toString();
			let newline = pending.indexOf("\n");
			while (newline !== -1) {
				io.stderr(pending.slice(0, newline));
				pending = pending.slice(newline + 1);
				newline = pending.indexOf("\n");
			}
			callback();
		},
	});
}

/** Resolve explicit, prompt-scoped, invocation, then process-global streams. */
export function resolvePromptIO(io?: PromptIO): Required<PromptIO> {
	const ambient = promptIOStorage.getStore();
	return {
		input: io?.input ?? ambient?.input ?? process.stdin,
		output: io?.output ?? ambient?.output ?? ambientTerminalWritable() ?? process.stderr,
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
	/** Optional partial theme; merged onto `defaultTheme`. */
	readonly theme?: PartialPromptTheme;
	/**
	 * Optional: render the final submitted state.
	 * Called after submit with the final state and submitted value.
	 * If not provided, the last render output is left on screen.
	 */
	readonly renderSubmitted?: (state: S, value: T, theme: PromptTheme) => string;
}

// ────────────────────────────────────────────────────────────────────────────
// ANSI escape sequences
// ────────────────────────────────────────────────────────────────────────────

/** Tracks active prompts so a stream can only drive one prompt at a time. */
const activeInputs = new WeakSet<PromptInput>();
/** Tracks active outputs — concurrent frames on one stream would erase each other. */
const activeOutputs = new WeakSet<PromptOutput>();

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
 * Check whether stdin is an interactive TTY.
 * @returns `true` if stdin is a TTY, `false` otherwise
 */
export function isTTY(input: Pick<PromptInput, "isTTY"> = process.stdin): boolean {
	return !!input.isTTY;
}

/**
 * Check that stdin is an interactive TTY.
 * @throws {NonInteractiveError} when stdin is not a TTY
 */
export function assertTTY(input: Pick<PromptInput, "isTTY"> = process.stdin): void {
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
 * 1. Asserts stdin is a TTY
 * 2. Enables raw mode and hides cursor
 * 3. Renders initial state
 * 4. Listens for keypress events, delegating to `handleKey`
 * 5. Re-renders on state changes
 * 6. On submit, renders final state, cleans up, and resolves
 *
 * Output is written to `process.stderr` so prompt UI doesn't pollute
 * piped stdout.
 *
 * @param config - Prompt configuration (render, handleKey, initialState, theme)
 * @returns Promise resolving to the user's submitted value
 * @throws {NonInteractiveError} when stdin is not a TTY
 *
 * @example
 * ```ts
 * const value = await runPrompt({
 *   initialState: { value: "", submitted: false },
 *   render: (state, theme) => `${theme.prefix("?")} Enter value: ${state.value}`,
 *   handleKey: (key, state) => {
 *     if (key.name === "return") return { submit: state.value };
 *     return { ...state, value: state.value + key.char };
 *   },
 * });
 * ```
 */
export function runPrompt<S, T>(config: PromptConfig<S, T>, io?: PromptIO): Promise<T> {
	const { render, handleKey, initialState, renderSubmitted } = config;
	const theme = resolveTheme(config.theme);
	const { input: stdin, output } = resolvePromptIO(io);

	return new Promise<T>((resolve, reject) => {
		// Guard against concurrent prompts sharing an input stream.
		if (activeInputs.has(stdin) || activeOutputs.has(output)) {
			reject(
				new Error(
					"Cannot run multiple prompts concurrently on the same input or output stream. Await each prompt before starting the next.",
				),
			);
			return;
		}

		assertTTY(stdin);
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
				readline.cursorTo(output, 0);
				readline.moveCursor(output, 0, -(prevLineCount - 1));
				readline.clearScreenDown(output);
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
				if (!isCleanedUp) {
					renderFrame(render(state, theme));
				}
			}, 0);
		}

		function flushRender(): void {
			if (renderPending !== null) {
				clearTimeout(renderPending);
				renderPending = null;
			}
		}

		function onKeypress(
			ch: string | undefined,
			key?: {
				name?: string;
				ctrl?: boolean;
				meta?: boolean;
				shift?: boolean;
				sequence?: string;
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
				name: key?.name ?? "",
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

			// Initial render
			const initialContent = render(state, theme);
			output.write(initialContent);
			const columns = output.columns || 80;
			prevLineCount = physicalLineCount(initialContent, columns);

			stdin.on("keypress", onKeypress);
		} catch (err) {
			cleanup();
			reject(err);
		}
	});
}
