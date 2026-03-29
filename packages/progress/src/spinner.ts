// ────────────────────────────────────────────────────────────────────────────
// Spinner — Display a spinner while running an async task for @crustjs/progress
// ────────────────────────────────────────────────────────────────────────────

import { resolveTheme } from "./theme.ts";
import type { PartialProgressTheme, ProgressTheme } from "./types.ts";

const ESC = "\x1B[";
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const ERASE_LINE = `${ESC}2K`;
const CURSOR_TO_START = "\r";

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

const SUCCESS_SYMBOL = "✓";
const ERROR_SYMBOL = "✗";

export type SpinnerType =
	| "dots"
	| "line"
	| "arc"
	| "bounce"
	| { readonly frames: readonly string[]; readonly interval: number };

export interface SpinnerController {
	/** Update the message displayed alongside the spinner. */
	updateMessage: (message: string) => void;
}

export interface SpinnerOptions<T> {
	/** The message displayed alongside the spinner. */
	readonly message: string;
	/** The async task to run while the spinner is displayed. */
	readonly task: (controller: SpinnerController) => Promise<T>;
	/** Spinner animation style (defaults to `"dots"`). */
	readonly spinner?: SpinnerType;
	/** Per-spinner theme overrides. */
	readonly theme?: PartialProgressTheme;
}

function resolveSpinner(spinnerType: SpinnerType | undefined): SpinnerFrameSet {
	if (spinnerType === undefined) {
		return BUILTIN_SPINNERS.dots as SpinnerFrameSet;
	}
	if (typeof spinnerType === "string") {
		return BUILTIN_SPINNERS[spinnerType] as SpinnerFrameSet;
	}
	return spinnerType;
}

function renderFrame(
	frame: string,
	message: string,
	theme: ProgressTheme,
): string {
	return `${ERASE_LINE}${CURSOR_TO_START}${theme.spinner(frame)} ${theme.message(message)}`;
}

function renderSuccess(message: string, theme: ProgressTheme): string {
	return `${ERASE_LINE}${CURSOR_TO_START}${theme.success(SUCCESS_SYMBOL)} ${theme.message(message)}\n`;
}

function renderError(message: string, theme: ProgressTheme): string {
	return `${ERASE_LINE}${CURSOR_TO_START}${theme.error(ERROR_SYMBOL)} ${theme.message(message)}\n`;
}

function renderStaticSuccess(message: string, theme: ProgressTheme): string {
	return `${theme.success(SUCCESS_SYMBOL)} ${theme.message(message)}\n`;
}

function renderStaticError(message: string, theme: ProgressTheme): string {
	return `${theme.error(ERROR_SYMBOL)} ${theme.message(message)}\n`;
}

export async function spinner<T>(options: SpinnerOptions<T>): Promise<T> {
	const theme = resolveTheme(options.theme);
	const isInteractive = !!process.stderr.isTTY;

	if (!isInteractive) {
		let currentMessage = options.message;
		let finished = false;

		const controller: SpinnerController = {
			updateMessage(message: string) {
				if (finished) return;
				currentMessage = message;
			},
		};

		try {
			const result = await options.task(controller);
			finished = true;
			process.stderr.write(renderStaticSuccess(currentMessage, theme));
			return result;
		} catch (error) {
			finished = true;
			process.stderr.write(renderStaticError(currentMessage, theme));
			throw error;
		}
	}

	const { frames, interval } = resolveSpinner(options.spinner);
	let frameIndex = 0;
	let currentMessage = options.message;
	let finished = false;
	let timerId: ReturnType<typeof setInterval> | undefined;
	let sigintHandler: (() => void) | undefined;

	function cleanupInteractive(): void {
		if (timerId !== undefined) {
			clearInterval(timerId);
			timerId = undefined;
		}
		if (sigintHandler) {
			process.removeListener("SIGINT", sigintHandler);
			sigintHandler = undefined;
		}
	}

	const controller: SpinnerController = {
		updateMessage(message: string) {
			if (finished) return;
			currentMessage = message;
			process.stderr.write(
				renderFrame(frames[frameIndex] as string, currentMessage, theme),
			);
		},
	};

	process.stderr.write(HIDE_CURSOR);
	process.stderr.write(renderFrame(frames[0] as string, currentMessage, theme));

	timerId = setInterval(() => {
		frameIndex = (frameIndex + 1) % frames.length;
		process.stderr.write(
			renderFrame(frames[frameIndex] as string, currentMessage, theme),
		);
	}, interval);

	sigintHandler = () => {
		cleanupInteractive();
		process.stderr.write(SHOW_CURSOR);
		process.exit(130);
	};
	process.once("SIGINT", sigintHandler);

	try {
		const result = await options.task(controller);
		finished = true;
		cleanupInteractive();
		process.stderr.write(renderSuccess(currentMessage, theme));
		process.stderr.write(SHOW_CURSOR);
		return result;
	} catch (error) {
		finished = true;
		cleanupInteractive();
		process.stderr.write(renderError(currentMessage, theme));
		process.stderr.write(SHOW_CURSOR);
		throw error;
	}
}
