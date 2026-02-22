// ────────────────────────────────────────────────────────────────────────────
// Renderer — Core terminal rendering engine for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import * as readline from "node:readline";
import type { PromptTheme } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

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
export const SUBMIT: unique symbol = Symbol("submit");

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
	/** Resolved theme for this prompt */
	readonly theme: PromptTheme;
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

/** Module-level flag to ensure emitKeypressEvents is only called once per stream */
let keypressEventsAttached = false;

const ESC = "\x1B[";
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const ERASE_LINE = `${ESC}2K`;

/**
 * Move cursor up `n` lines.
 */
function cursorUp(n: number): string {
	return n > 0 ? `${ESC}${n}A` : "";
}

// ────────────────────────────────────────────────────────────────────────────
// TTY detection
// ────────────────────────────────────────────────────────────────────────────

/**
 * Error thrown when a prompt requires an interactive TTY but none is available.
 */
export class NonInteractiveError extends Error {
	constructor(message?: string) {
		super(
			message ??
				"Prompts require an interactive terminal (TTY). Provide an `initial` value for non-interactive environments.",
		);
		this.name = "NonInteractiveError";
	}
}

/**
 * Error thrown when the user cancels a prompt with Ctrl+C.
 */
export class CancelledError extends Error {
	constructor(message?: string) {
		super(message ?? "Prompt was cancelled.");
		this.name = "CancelledError";
	}
}

/**
 * Check that stdin is an interactive TTY.
 * @throws {NonInteractiveError} when stdin is not a TTY
 */
export function assertTTY(): void {
	if (!process.stdin.isTTY) {
		throw new NonInteractiveError();
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Core prompt runner
// ────────────────────────────────────────────────────────────────────────────

/**
 * Check if a handleKey result is a submit action.
 */
function isSubmit<S, T>(
	result: HandleKeyResult<S, T>,
): result is SubmitResult<T> {
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
 *   theme: resolveTheme(),
 *   render: (state, theme) => `${theme.prefix("?")} Enter value: ${state.value}`,
 *   handleKey: (key, state) => {
 *     if (key.name === "return") return { submit: state.value };
 *     return { ...state, value: state.value + key.char };
 *   },
 * });
 * ```
 */
export function runPrompt<S, T>(config: PromptConfig<S, T>): Promise<T> {
	const { render, handleKey, initialState, theme, renderSubmitted } = config;

	return new Promise<T>((resolve, reject) => {
		// TTY check inside the promise so it rejects rather than throwing synchronously
		try {
			assertTTY();
		} catch (err) {
			reject(err);
			return;
		}

		let state = initialState;
		let prevLineCount = 0;
		let isCleanedUp = false;

		const stdin = process.stdin;
		const output = process.stderr;

		// ── Cleanup helper ──────────────────────────────────────────────
		function cleanup(): void {
			if (isCleanedUp) return;
			isCleanedUp = true;

			stdin.removeListener("keypress", onKeypress);

			if (stdin.isTTY && stdin.isRaw) {
				stdin.setRawMode(false);
			}

			stdin.pause();
			output.write(SHOW_CURSOR);
		}

		// ── Render helper ───────────────────────────────────────────────
		function renderFrame(content: string): void {
			// Erase previous frame
			if (prevLineCount > 0) {
				output.write(`${cursorUp(prevLineCount - 1)}\r`);
				for (let i = 0; i < prevLineCount; i++) {
					output.write(ERASE_LINE);
					if (i < prevLineCount - 1) {
						output.write(`${ESC}1B`); // cursor down
					}
				}
				// Move back to top
				if (prevLineCount > 1) {
					output.write(cursorUp(prevLineCount - 1));
				}
				output.write(`\r`);
			}

			output.write(content);

			// Track line count for next erase
			const lines = content.split("\n");
			prevLineCount = lines.length;
		}

		// ── Keypress handler ────────────────────────────────────────────
		async function onKeypress(
			ch: string | undefined,
			key?: {
				name?: string;
				ctrl?: boolean;
				meta?: boolean;
				shift?: boolean;
				sequence?: string;
			},
		): Promise<void> {
			// Ctrl+C → reject with CancelledError
			if (key?.ctrl && key.name === "c") {
				cleanup();
				reject(new CancelledError());
				return;
			}

			const event: KeypressEvent = {
				char: ch ?? "",
				name: key?.name ?? "",
				ctrl: key?.ctrl ?? false,
				meta: key?.meta ?? false,
				shift: key?.shift ?? false,
			};

			try {
				const result = await handleKey(event, state);

				if (isSubmit(result)) {
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
					renderFrame(render(state, theme));
				}
			} catch (err) {
				cleanup();
				reject(err);
			}
		}

		// ── Initialize ──────────────────────────────────────────────────
		try {
			if (!keypressEventsAttached) {
				readline.emitKeypressEvents(stdin);
				keypressEventsAttached = true;
			}
			stdin.setRawMode(true);
			stdin.resume();
			output.write(HIDE_CURSOR);

			// Initial render
			const initialContent = render(state, theme);
			output.write(initialContent);
			const lines = initialContent.split("\n");
			prevLineCount = lines.length;

			stdin.on("keypress", onKeypress);
		} catch (err) {
			cleanup();
			reject(err);
		}
	});
}
