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
	let drawnRows = 0;
	let timerId: ReturnType<typeof setInterval> | undefined;
	let removeSigint: (() => void) | undefined;
	let releaseFrame: (() => void) | undefined;
	const showCursor = () => sink.write(SHOW_CURSOR);
	// Deferred a turn so a `stop()` with its own message, run by the cancellation itself, wins.
	const onAbort = () =>
		setImmediate(() => {
			for (const item of running) stopItem(item, "error");
		});

	const count = (item: Item) => ` (${item.current}/${item.total})`;

	// Rows never wrap and the cursor stays at the end of the last one, so moving up `drawnRows - 1`
	// lands on the first; erasing to the end of the screen leaves the cursor at its start.
	function erase(): string {
		const up = drawnRows > 1 ? `${ESC}${drawnRows - 1}A` : "";
		drawnRows = 0;
		return `\r${up}${ESC}J`;
	}

	function rows(): string {
		const width = (sink.columns || 80) - 1;
		const symbol = `${theme.spinner(frameAt(frames, frameIndex))} `;
		const lines = [...running].flatMap((item) => {
			const parts = item.message.split(LINE_SPLIT);
			return parts.map((part, index) => {
				const head = index === 0 ? symbol : INDENT;
				// The count follows the last line and survives a cut, as in `progress()`.
				const tail = index === parts.length - 1 ? count(item) : "";
				const room = width - stringWidth(head + theme.message(tail));
				return fitRow(head + theme.message(fitRow(part, room) + tail), width);
			});
		});
		drawnRows = lines.length;
		return lines.join("\n");
	}

	function draw(): void {
		sink.write(erase() + rows());
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
		const final = renderFinal(
			item.message.replaceAll("\n", `\n${INDENT}`) + count(item),
			theme,
			outcome,
			live ? erase() : "",
		);
		try {
			sink.write(live && !last ? final + erase() + rows() : final);
		} finally {
			if (live && last) showCursor();
		}
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
					if (isInteractive) draw();
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
