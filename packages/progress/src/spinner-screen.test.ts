import { Terminal } from "@xterm/headless";
import { describe, expect, it } from "vite-plus/test";

import { progress } from "./progress.ts";
import { spinner, type TerminalOutput } from "./spinner.ts";

/** A spinner drawing into an xterm screen, plus that screen's logical lines. */
function setup(columns: number, reflowCursorLine: boolean, message: string) {
	const terminal = new Terminal({
		cols: columns,
		rows: 20,
		allowProposedApi: true,
		reflowCursorLine,
	});
	const handle = spinner({
		message,
		spinner: { frames: ["-"], interval: 60_000 },
		sigint: false,
		sink: {
			isTTY: true,
			get columns() {
				return terminal.cols;
			},
			write: (text: string) => terminal.write(text),
		},
	});
	const flush = () => new Promise<void>((resolve) => terminal.write("", resolve));
	const row = (index: number) =>
		terminal.buffer.active.getLine(index)?.translateToString(true) ?? "";
	// Join rows the terminal wrapped, so each entry is one logical line.
	const screen = () => {
		let text = "";
		for (let index = 0; index < terminal.buffer.active.length; index++) {
			text += (terminal.buffer.active.getLine(index)?.isWrapped ? "" : "\n") + row(index);
		}
		return text.trim();
	};
	const dispose = () => {
		handle.stop();
		terminal.dispose();
	};
	return { terminal, handle, flush, row, screen, dispose };
}

describe.each([false, true])("spinner resize (reflowCursorLine: %s)", (reflowCursorLine) => {
	describe.each([
		[10, 20],
		[20, 10],
		[9, 18],
		[18, 9],
	])("from %i to %i columns", (from, to) => {
		it.each(["redraw", "stop"])("preserves preceding output on %s", async (action) => {
			const { terminal, handle, flush, row, screen, dispose } = setup(
				from,
				reflowCursorLine,
				"abcdefghijklmnop",
			);
			try {
				terminal.write("above\r\n");
				handle.start();
				await flush();
				const frame = row(1);
				terminal.resize(to, 20);
				if (action === "redraw") handle.updateMessage("short");
				else handle.stop("success", "done");
				await flush();

				// A terminal that reflows the cursor's row wraps a frame wider than the narrower
				// screen; only the cursor's row is erased, so the frame's head stays behind.
				const staleHead = reflowCursorLine && to < from ? [frame.slice(0, to)] : [];
				expect(screen()).toBe(
					["above", ...staleHead, action === "redraw" ? "- short" : "✓ done"].join("\n"),
				);
			} finally {
				dispose();
			}
		});
	});
});

describe("spinner frame wider than the row", () => {
	const frames = (...list: string[]) => ({ frames: list, interval: 60_000 });
	it.each<
		[
			string,
			number,
			(sink: TerminalOutput) => { start(): void; redraw(): void; stop(): void },
			string,
		]
	>([
		[
			"a CRLF line break in the message",
			20,
			(sink) => {
				const handle = spinner({ message: "ab\r\ncd", spinner: frames("-"), sigint: false, sink });
				return {
					start: handle.start,
					redraw: () => handle.updateMessage("ab\r\ncd"),
					stop: () => handle.stop(),
				};
			},
			"- ab…",
		],
		[
			"a count wider than the row",
			10,
			(sink) => {
				const handle = progress({
					total: 1_000_000,
					message: "Files",
					spinner: frames("-"),
					sigint: false,
					sink,
				});
				return { start: handle.start, redraw: () => handle.advance(0), stop: () => handle.stop() };
			},
			"-  (0/10…",
		],
		[
			"a symbol and count that leave no room for the message",
			8,
			(sink) => {
				const handle = progress({
					total: 2,
					message: "X",
					spinner: frames("-"),
					sigint: false,
					sink,
				});
				return { start: handle.start, redraw: () => handle.advance(0), stop: () => handle.stop() };
			},
			"-  (0/…",
		],
		[
			"text a theme adds to the message",
			10,
			(sink) => {
				const handle = spinner({
					message: "abcdefg",
					spinner: frames("-"),
					theme: { message: (text) => `[${text}]` },
					sigint: false,
					sink,
				});
				return {
					start: handle.start,
					redraw: () => handle.updateMessage("abcdefg"),
					stop: () => handle.stop(),
				};
			},
			"- [abcd…]",
		],
		[
			"a multi-line spinner frame",
			20,
			(sink) => {
				const handle = spinner({
					message: "Building",
					spinner: frames("a\nb"),
					sigint: false,
					sink,
				});
				return {
					start: handle.start,
					redraw: () => handle.updateMessage("Building"),
					stop: () => handle.stop(),
				};
			},
			"a…",
		],
	])("keeps one row with %s", async (_, columns, create, frame) => {
		const terminal = new Terminal({ cols: columns, rows: 20, allowProposedApi: true });
		const indicator = create({
			isTTY: true,
			columns,
			write: (text: string) => terminal.write(text),
		});
		try {
			indicator.start();
			indicator.redraw();
			indicator.redraw();
			await new Promise<void>((resolve) => terminal.write("", resolve));

			const rows = Array.from(
				{ length: terminal.rows },
				(_, index) => terminal.buffer.active.getLine(index)?.translateToString(true) ?? "",
			);
			expect(rows.filter(Boolean)).toEqual([frame]);
		} finally {
			// Clears the redraw interval and the exit listener before the terminal goes away.
			indicator.stop();
			terminal.dispose();
		}
	});
});

describe.each([false, true])(
	"spinner with output between frames (reflowCursorLine: %s)",
	(reflowCursorLine) => {
		it.each([
			["a one-row message", "Building", "- Building"],
			["a message cut to one row", "Downloading every file", "- Downloading ever…"],
		])("keeps a line logged mid-spin with %s", async (_, message, frame) => {
			const { terminal, handle, flush, screen, dispose } = setup(20, reflowCursorLine, message);
			try {
				handle.start();
				terminal.write("downloaded\r\n");
				handle.updateMessage("short");
				handle.stop("success", "done");
				await flush();

				// The log lands after the frame on the cursor's row; the next frame starts below it.
				expect(screen()).toBe(`${frame}downloaded\n✓ done`);
			} finally {
				dispose();
			}
		});
	},
);
