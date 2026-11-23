// ────────────────────────────────────────────────────────────────────────────
// Progress group — Concurrent determinate indicators for @crustjs/progress
// ────────────────────────────────────────────────────────────────────────────

import { stringWidth } from "@crustjs/style";
import {
	getTerminalIO,
	getTerminalSignal,
	processStderr,
	registerLiveFrame,
} from "@crustjs/utils/terminal";

import type { ProgressHandle, ProgressOptions } from "./progress.ts";
import {
	ESC,
	fitRow,
	frameAt,
	HIDE_CURSOR,
	listenForSigint,
	renderFinal,
	resolveSpinner,
	SHOW_CURSOR,
	type SpinnerHandleOptions,
	type SpinnerOutcome,
} from "./spinner.ts";
import { defaultThemeFor } from "./theme.ts";

/** Options shared by every indicator in a {@link progressGroup}. */
export type ProgressGroupOptions = Omit<SpinnerHandleOptions, "message">;

export interface ProgressGroup {
	/**
	 * Add a determinate indicator. Once started it draws below the indicators started before it;
	 * `stop()` prints its final line above the ones still running.
	 */
	add: (options: Pick<ProgressOptions, "total" | "message">) => ProgressHandle;
}

interface Item {
	message: string;
	current: number;
	readonly total: number;
	state: "idle" | "running" | "done";
}

// Continuation lines of a multi-line message line up after the symbol.
const INDENT = "  ";
const LINE_SPLIT = /\r?\n/;

/**
 * Create a group of determinate indicators that run at the same time. On a terminal each running
 * indicator has its own rows, redrawn together; without one, each prints only its final line.
 */
export function progressGroup(options: ProgressGroupOptions = {}): ProgressGroup {
	const sink = options.sink ?? getTerminalIO()?.output ?? processStderr;
	const theme = { ...defaultThemeFor(sink), ...options.theme };
	const isInteractive = sink.isTTY ?? false;
	const { frames, interval } = resolveSpinner(options.spinner);
	const sigint = options.sigint ?? "exit";
	const signal = options.signal ?? getTerminalSignal();

	const running = new Set<Item>();
	let frameIndex = 0;
	// The display width of each row on screen.
	let drawn: number[] = [];
	let timerId: ReturnType<typeof setInterval> | undefined;
	let removeSigint: (() => void) | undefined;
	let releaseFrame: (() => void) | undefined;
	const showCursor = () => sink.write(SHOW_CURSOR);
	// Deferred a turn so a `stop()` with its own message, run by the cancellation itself, wins.
	// Only the items running now: one started after the abort reports cleanup.
	const onAbort = () => {
		const aborted = [...running];
		setImmediate(() => {
			for (const item of aborted) stopItem(item, "error");
		});
	};

	const count = (item: Item) => ` (${item.current}/${item.total})`;

	// Rows are drawn short of the last column and the cursor stays at the end of the last one, so
	// moving up one less than the rows they take lands on the first; erasing to the end of the
	// screen leaves the cursor at its start. A terminal narrowed since then reflowed each row.
	function erase(): string {
		const columns = sink.columns || 80;
		const height = drawn.reduce((sum, width) => sum + Math.max(1, Math.ceil(width / columns)), 0);
		drawn = [];
		return `\r${height > 1 ? `${ESC}${height - 1}A` : ""}${ESC}J`;
	}

	function rows(): string[] {
		const width = (sink.columns || 80) - 1;
		const symbol = `${theme.spinner(frameAt(frames, frameIndex))} `;
		return [...running].flatMap((item) => {
			const parts = item.message.split(LINE_SPLIT);
			return parts.map((part, index) => {
				const head = index === 0 ? symbol : INDENT;
				// The count follows the last line and survives a cut, as in `progress()`.
				const tail = index === parts.length - 1 ? count(item) : "";
				const room = width - stringWidth(head + theme.message(tail));
				return fitRow(head + theme.message(fitRow(part, room) + tail), width);
			});
		});
	}

	// `above` is printed in place of the old rows, above the new ones.
	function draw(above = ""): void {
		const lines = rows();
		sink.write(erase() + above + lines.join("\n"));
		drawn = lines.map(stringWidth);
	}

	function begin(): void {
		if (signal && !signal.aborted) signal.addEventListener("abort", onAbort, { once: true });
		if (!isInteractive) return;
		sink.write(HIDE_CURSOR);
		// `process.exit()` skips stop(); "exit" listeners run synchronously, so restore here.
		process.once("exit", showCursor);
		timerId = setInterval(() => {
			frameIndex = (frameIndex + 1) % frames.length;
			draw();
		}, interval);
		releaseFrame = registerLiveFrame({ clear: () => sink.write(erase()), redraw: draw });
		if (sigint === "exit") {
			removeSigint = listenForSigint(onAbort, () => {
				end();
				for (const item of running) item.state = "done";
				running.clear();
				showCursor();
			});
		}
	}

	function end(): void {
		clearInterval(timerId);
		timerId = undefined;
		removeSigint?.();
		removeSigint = undefined;
		releaseFrame?.();
		releaseFrame = undefined;
		process.removeListener("exit", showCursor);
		signal?.removeEventListener("abort", onAbort);
	}

	function stopItem(item: Item, outcome: SpinnerOutcome, message?: string): void {
		if (item.state === "done") return;
		item.state = "done";
		if (message !== undefined) item.message = message;
		const live = isInteractive && running.size > 0;
		running.delete(item);
		const last = running.size === 0;
		if (last) end();
		// `done` blocks retries, so a throwing theme or sink must not skip restoring the cursor.
		// The first failure wins; boxed because any value (even undefined) can be thrown.
		let renderFailure: { error: unknown } | undefined;
		try {
			const text = item.message.replaceAll("\n", `\n${INDENT}`) + count(item);
			if (live && !last) draw(renderFinal(text, theme, outcome, ""));
			else sink.write(renderFinal(text, theme, outcome, live ? erase() : ""));
		} catch (error) {
			renderFailure = { error };
		}
		if (live && last) {
			try {
				showCursor();
			} catch (error) {
				if (!renderFailure) throw error;
			}
		}
		if (renderFailure) throw renderFailure.error;
	}

	return {
		add({ total, message }) {
			const item: Item = { message, current: 0, total, state: "idle" };
			return {
				start() {
					if (item.state !== "idle") return;
					item.state = "running";
					running.add(item);
					if (running.size === 1) begin();
					if (!isInteractive) return;
					try {
						draw();
					} catch (error) {
						// A throwing theme or sink must not leave the item to the timer or the session open.
						item.state = "done";
						running.delete(item);
						if (running.size === 0) {
							end();
							try {
								showCursor();
							} catch {
								// The draw failure wins.
							}
						}
						throw error;
					}
				},
				advance(amount = 1, nextMessage?: string) {
					item.current += amount;
					if (nextMessage !== undefined) item.message = nextMessage;
					if (item.state === "running" && isInteractive) draw();
				},
				stop: (outcome = "success", finalMessage?: string) => stopItem(item, outcome, finalMessage),
			};
		},
	};
}
