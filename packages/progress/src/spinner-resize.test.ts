import { Terminal } from "@xterm/headless";
import { describe, expect, it } from "vite-plus/test";

import { spinner } from "./spinner.ts";

describe.each([false, true])("spinner resize (reflowCursorLine: %s)", (reflowCursorLine) => {
	describe.each([
		[10, 20],
		[20, 10],
		[9, 18],
		[18, 9],
	])("from %i to %i columns", (from, to) => {
		it.each(["redraw", "stop"])("preserves preceding output on %s", async (action) => {
			const terminal = new Terminal({
				cols: from,
				rows: 20,
				allowProposedApi: true,
				reflowCursorLine,
			});
			const flush = () => new Promise<void>((resolve) => terminal.write("", resolve));
			const sink = {
				isTTY: true,
				get columns() {
					return terminal.cols;
				},
				write: (text: string) => terminal.write(text),
			};
			const handle = spinner({
				message: "abcdefghijklmnop",
				spinner: { frames: ["-"], interval: 60_000 },
				sigint: false,
				sink,
			});
			try {
				terminal.write("above\r\n");
				handle.start();
				await flush();
				terminal.resize(to, 20);
				if (action === "redraw") handle.updateMessage("short");
				else handle.stop("success", "done");
				await flush();

				const lines = Array.from({ length: terminal.buffer.active.length }, (_, index) =>
					terminal.buffer.active.getLine(index)?.translateToString(true),
				);
				expect(lines.join("\n").trimEnd()).toBe(
					action === "redraw" ? "above\n- short" : "above\n✓ done",
				);
			} finally {
				handle.stop();
				terminal.dispose();
			}
		});
	});
});
