import { Terminal } from "@xterm/headless";
import { describe, expect, it } from "vite-plus/test";

import { spinner } from "./spinner.ts";

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
