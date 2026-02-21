// ────────────────────────────────────────────────────────────────────────────
// Spinner — Display a spinner while running an async task for @crustjs/prompts
// ────────────────────────────────────────────────────────────────────────────

import { resolveTheme } from "./theme.ts";
import type { PartialPromptTheme, PromptTheme } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// ANSI escape codes
// ────────────────────────────────────────────────────────────────────────────

const ESC = "\x1B[";
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const ERASE_LINE = `${ESC}2K`;
const CURSOR_TO_START = "\r";

// ────────────────────────────────────────────────────────────────────────────
// Built-in spinner frame sets
// ────────────────────────────────────────────────────────────────────────────

interface SpinnerFrameSet {
	readonly frames: readonly string[];
	readonly interval: number;
}

const BUILTIN_SPINNERS: Record<string, SpinnerFrameSet> = {
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

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Built-in spinner animation names or a custom frame configuration.
 *
 * Built-in spinners:
 * - `"dots"` — Braille dot pattern (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏)
 * - `"line"` — Line rotation (-\\|/)
 * - `"arc"` — Quarter circle rotation (◐◓◑◒)
 * - `"bounce"` — Bouncing braille dot (⠁⠂⠄⡀⢀⠠⠐⠈)
 *
 * Or provide a custom `{ frames: string[]; interval: number }` object.
 */
export type SpinnerType =
	| "dots"
	| "line"
	| "arc"
	| "bounce"
	| { readonly frames: readonly string[]; readonly interval: number };

/**
 * Options for the {@link spinner} prompt.
 *
 * @example
 * ```ts
 * const data = await spinner({
 *   message: "Fetching data...",
 *   task: async () => {
 *     const res = await fetch("https://api.example.com/data");
 *     return res.json();
 *   },
 * });
 * ```
 */
export interface SpinnerOptions<T> {
	/** The message displayed alongside the spinner */
	readonly message: string;
	/** The async task to run while the spinner is displayed */
	readonly task: () => Promise<T>;
	/** Spinner animation style (defaults to `"dots"`) */
	readonly spinner?: SpinnerType;
	/** Per-prompt theme overrides */
	readonly theme?: PartialPromptTheme;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a SpinnerType to a concrete frame set.
 */
function resolveSpinner(spinnerType: SpinnerType | undefined): SpinnerFrameSet {
	if (spinnerType === undefined) {
		return BUILTIN_SPINNERS.dots as SpinnerFrameSet;
	}
	if (typeof spinnerType === "string") {
		return BUILTIN_SPINNERS[spinnerType] as SpinnerFrameSet;
	}
	return spinnerType;
}

// ────────────────────────────────────────────────────────────────────────────
// Render helpers
// ────────────────────────────────────────────────────────────────────────────

const SUCCESS_SYMBOL = "✔";
const ERROR_SYMBOL = "✖";

function renderFrame(
	frame: string,
	message: string,
	theme: PromptTheme,
): string {
	return `${ERASE_LINE}${CURSOR_TO_START}${theme.spinner(frame)} ${theme.message(message)}`;
}

function renderSuccess(message: string, theme: PromptTheme): string {
	return `${ERASE_LINE}${CURSOR_TO_START}${theme.success(SUCCESS_SYMBOL)} ${theme.message(message)}\n`;
}

function renderError(message: string, theme: PromptTheme): string {
	return `${ERASE_LINE}${CURSOR_TO_START}${theme.error(ERROR_SYMBOL)} ${theme.message(message)}\n`;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Display a spinner animation while running an async task.
 *
 * The spinner renders to stderr so it doesn't interfere with piped stdout.
 * On task completion, the spinner is replaced with a success (✔) or error (✖)
 * indicator. If the task throws, the error is re-thrown after cleanup.
 *
 * Unlike other prompts, the spinner does **not** use raw mode or keypress
 * handling — it is output-only and non-interactive.
 *
 * @param options - Spinner prompt configuration
 * @returns The result of the async task
 *
 * @example
 * ```ts
 * const data = await spinner({
 *   message: "Loading data...",
 *   task: async () => {
 *     const res = await fetch("https://api.example.com/data");
 *     return res.json();
 *   },
 * });
 * ```
 *
 * @example
 * ```ts
 * // Custom spinner animation
 * await spinner({
 *   message: "Building project...",
 *   task: async () => { await buildProject(); },
 *   spinner: "arc",
 * });
 * ```
 *
 * @example
 * ```ts
 * // Custom frames and interval
 * await spinner({
 *   message: "Processing...",
 *   task: async () => { await processData(); },
 *   spinner: { frames: ["⊶", "⊷"], interval: 150 },
 * });
 * ```
 */
export async function spinner<T>(options: SpinnerOptions<T>): Promise<T> {
	const theme = resolveTheme(undefined, options.theme);
	const { frames, interval } = resolveSpinner(options.spinner);

	let frameIndex = 0;
	let timerId: ReturnType<typeof setInterval> | undefined;

	// Hide cursor and render initial frame
	process.stderr.write(HIDE_CURSOR);
	process.stderr.write(
		renderFrame(frames[0] as string, options.message, theme),
	);

	// Start frame animation
	timerId = setInterval(() => {
		frameIndex = (frameIndex + 1) % frames.length;
		process.stderr.write(
			renderFrame(frames[frameIndex] as string, options.message, theme),
		);
	}, interval);

	try {
		const result = await options.task();

		// Success — clear spinner and show success indicator
		clearInterval(timerId);
		timerId = undefined;
		process.stderr.write(renderSuccess(options.message, theme));
		process.stderr.write(SHOW_CURSOR);

		return result;
	} catch (error) {
		// Error — clear spinner and show error indicator
		if (timerId !== undefined) {
			clearInterval(timerId);
			timerId = undefined;
		}
		process.stderr.write(renderError(options.message, theme));
		process.stderr.write(SHOW_CURSOR);

		throw error;
	}
}
