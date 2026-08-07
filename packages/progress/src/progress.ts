// ────────────────────────────────────────────────────────────────────────────
// Progress — Determinate (current/total) progress for @crustjs/progress
// ────────────────────────────────────────────────────────────────────────────

import {
	type SpinnerHandle,
	type SpinnerHandleOptions,
	type SpinnerOutcome,
	type SpinnerSink,
	createSpinnerHandle,
} from "./spinner.ts";

export interface ProgressOptions extends SpinnerHandleOptions {
	/** Total number of units of work. */
	readonly total: number;
}

export interface ProgressHandle {
	/** Begin rendering at `(0/total)`. */
	start: () => void;
	/** Advance by `amount` units and repaint, optionally with a new message. */
	advance: (amount?: number, message?: string) => void;
	/**
	 * Finish: render the final `✓`/`✗` line with the last `(current/total)`.
	 *
	 * @param outcome - Final symbol to render. @default "success"
	 * @param message - Final message. Defaults to the last message shown.
	 */
	stop: (outcome?: SpinnerOutcome, message?: string) => void;
}

/** Internal progress constructor that threads the spinner terminal sink through. */
export function createProgressHandle(options: ProgressOptions, sink?: SpinnerSink): ProgressHandle {
	const { total } = options;
	let current = 0;
	let message = options.message;

	const format = (msg: string): string => `${msg} (${current}/${total})`;

	const handle: SpinnerHandle = createSpinnerHandle(
		{
			...options,
			message: format(message),
		},
		sink,
	);

	return {
		start: handle.start,
		advance(amount = 1, nextMessage?: string) {
			current += amount;
			if (nextMessage !== undefined) message = nextMessage;
			handle.updateMessage(format(message));
		},
		stop(outcome: SpinnerOutcome = "success", finalMessage?: string) {
			handle.stop(outcome, format(finalMessage ?? message));
		},
	};
}

/**
 * Create a determinate progress indicator rendered as
 * `⠋ <message> (<current>/<total>)` on the spinner line.
 */
export function progress(options: ProgressOptions): ProgressHandle {
	return createProgressHandle(options);
}
