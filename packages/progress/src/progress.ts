// ────────────────────────────────────────────────────────────────────────────
// Progress — Determinate (current/total) progress for @crustjs/progress
// ────────────────────────────────────────────────────────────────────────────

import {
	createSpinnerHandle,
	type SpinnerHandle,
	type SpinnerHandleOptions,
	type SpinnerOutcome,
} from "./spinner.ts";

export interface ProgressOptions extends SpinnerHandleOptions {
	/** Total number of units of work. */
	readonly total: number;
}

export interface ProgressHandle {
	/** Begin rendering at `(0/total)`. */
	start: () => void;
	/** Advance by `amount` units and repaint, optionally with a new message. Before `start()`, this mutates the count without repainting. */
	advance: (amount?: number, message?: string) => void;
	/**
	 * Finish: render the final `✓`/`✗` line with the last `(current/total)`.
	 *
	 * @param outcome - Final symbol to render. @default "success"
	 * @param message - Final message. Defaults to the last message shown.
	 */
	stop: (outcome?: SpinnerOutcome, message?: string) => void;
}

/**
 * Create a determinate progress indicator rendered as
 * `⠋ <message> (<current>/<total>)` on the spinner line.
 */
export function progress(options: ProgressOptions): ProgressHandle {
	const { total } = options;
	let current = 0;
	let message = options.message;

	const handle: SpinnerHandle = createSpinnerHandle(options, () => ` (${current}/${total})`);

	return {
		start: handle.start,
		advance(amount = 1, nextMessage?: string) {
			current += amount;
			if (nextMessage !== undefined) message = nextMessage;
			handle.updateMessage(message);
		},
		stop(outcome: SpinnerOutcome = "success", finalMessage?: string) {
			handle.stop(outcome, finalMessage);
		},
	};
}
