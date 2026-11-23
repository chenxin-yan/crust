import { writeProcessOutput } from "@crustjs/utils/terminal";
import { Terminal } from "@xterm/headless";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { progressGroup } from "./progress-group.ts";
import { createFakeSink } from "./test-helpers.ts";

beforeAll(() => vi.stubEnv("FORCE_COLOR", "0"));
afterAll(() => vi.unstubAllEnvs());

/** A group drawing into an xterm screen, plus that screen's logical lines. */
function setup(columns = 40) {
	// A terminal device returns the carriage on "\n" (ONLCR), which xterm leaves to the pty.
	const terminal = new Terminal({
		cols: columns,
		rows: 20,
		allowProposedApi: true,
		convertEol: true,
	});
	const group = progressGroup({
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
	const screen = async () => {
		await new Promise<void>((resolve) => terminal.write("", resolve));
		// Join rows the terminal wrapped, so each entry is one logical line.
		let text = "";
		for (let index = 0; index < terminal.buffer.active.length; index++) {
			const line = terminal.buffer.active.getLine(index);
			text += (line?.isWrapped ? "" : "\n") + (line?.translateToString(true) ?? "");
		}
		return text.trim().split("\n");
	};
	return { terminal, group, screen };
}

describe("progressGroup on a terminal", () => {
	it("draws one row per running indicator and prints finished ones above them", async () => {
		const { terminal, group, screen } = setup();
		const a = group.add({ total: 3, message: "a3ed95" });
		const b = group.add({ total: 2, message: "6c3374" });
		const c = group.add({ total: 1, message: "0718aa" });
		try {
			terminal.write("above\n");
			a.start();
			b.start();
			c.start();
			a.advance();
			b.advance(2);
			expect(await screen()).toEqual([
				"above",
				"- a3ed95 (1/3)",
				"- 6c3374 (2/2)",
				"- 0718aa (0/1)",
			]);

			b.stop("success", "Pull complete");
			expect(await screen()).toEqual([
				"above",
				"✓ Pull complete (2/2)",
				"- a3ed95 (1/3)",
				"- 0718aa (0/1)",
			]);

			a.stop("error");
			c.stop();
			expect(await screen()).toEqual([
				"above",
				"✓ Pull complete (2/2)",
				"✗ a3ed95 (1/3)",
				"✓ 0718aa (0/1)",
			]);
		} finally {
			terminal.dispose();
		}
	});

	it("keeps every line of a multi-line message", async () => {
		const { terminal, group, screen } = setup(20);
		const a = group.add({ total: 2, message: "layer a\nextracting files" });
		const b = group.add({ total: 2, message: "layer b" });
		try {
			a.start();
			b.start();
			a.advance();
			expect(await screen()).toEqual(["- layer a", "  extracting… (1/2)", "- layer b (0/2)"]);

			a.stop();
			b.stop();
			expect(await screen()).toEqual(["✓ layer a", "  extracting files (1/2)", "✓ layer b (0/2)"]);
		} finally {
			terminal.dispose();
		}
	});

	it("erases the rows a narrowed terminal reflowed", async () => {
		const { terminal, group, screen } = setup();
		const a = group.add({ total: 2, message: "layer one with a long name" });
		const b = group.add({ total: 2, message: "b" });
		try {
			terminal.write("above\n");
			a.start();
			b.start();
			await screen();
			terminal.resize(20, 20);
			a.advance();
			expect(await screen()).toEqual(["above", "- layer one … (1/2)", "- b (0/2)"]);
		} finally {
			a.stop();
			b.stop();
			terminal.dispose();
		}
	});

	it.skipIf(process.platform === "win32")(
		"moves its rows below a line written through Crust's process output",
		async () => {
			const { terminal, group, screen } = setup();
			vi.spyOn(process.getBuiltinModule("node:tty"), "isatty").mockReturnValue(true);
			vi.spyOn(process.getBuiltinModule("node:fs"), "writeSync").mockImplementation(((
				_fd: number,
				buffer: Uint8Array,
				offset?: number | null,
			) => {
				terminal.write(buffer.subarray(offset ?? 0));
				return buffer.length - (offset ?? 0);
			}) as typeof import("node:fs").writeSync);
			const a = group.add({ total: 1, message: "a" });
			const b = group.add({ total: 1, message: "b\nsecond line" });
			try {
				a.start();
				b.start();
				writeProcessOutput(1, "pkg-a: built\n");
				expect(await screen()).toEqual(["pkg-a: built", "- a (0/1)", "- b", "  second line (0/1)"]);
			} finally {
				a.stop();
				b.stop();
				vi.restoreAllMocks();
				terminal.dispose();
			}
		},
	);

	it("hides the cursor while any indicator runs and restores it after the last", () => {
		const { sink, writes } = createFakeSink();
		const group = progressGroup({ sigint: false, sink });
		const a = group.add({ total: 1, message: "a" });
		const b = group.add({ total: 1, message: "b" });

		a.start();
		b.start();
		a.stop();
		expect(writes.filter((text) => text === "\x1B[?25h")).toEqual([]);
		b.stop();
		expect(writes.filter((text) => text === "\x1B[?25l")).toHaveLength(1);
		expect(writes.at(-1)).toBe("\x1B[?25h");
	});

	it("installs one SIGINT listener for the group that restores the cursor and re-raises", () => {
		const { sink, writes } = createFakeSink();
		const group = progressGroup({ sink });
		const before = new Set(process.listeners("SIGINT"));
		group.add({ total: 1, message: "a" }).start();
		group.add({ total: 1, message: "b" }).start();
		const added = process.listeners("SIGINT").filter((listener) => !before.has(listener));
		expect(added).toHaveLength(1);

		const kill = vi.spyOn(process, "kill").mockReturnValue(true);
		try {
			added[0]?.("SIGINT");
			expect(kill).toHaveBeenCalledWith(process.pid, "SIGINT");
		} finally {
			kill.mockRestore();
		}
		expect(writes.at(-1)).toBe("\x1B[?25h");
		expect(process.listeners("SIGINT")).toEqual([...before]);
	});

	it("stops running indicators with ✗ when the signal aborts", async () => {
		const { sink, writes } = createFakeSink(false);
		const controller = new AbortController();
		const group = progressGroup({ sigint: false, sink, signal: controller.signal });
		const a = group.add({ total: 2, message: "a" });
		const b = group.add({ total: 2, message: "b" });

		a.start();
		b.start();
		controller.abort();
		await new Promise((resolve) => setImmediate(resolve));

		expect(writes).toEqual(["✗ a (0/2)\n", "✗ b (0/2)\n"]);
	});

	it("leaves an indicator started after the abort to finish on its own", async () => {
		const { sink, writes } = createFakeSink(false);
		const controller = new AbortController();
		const group = progressGroup({ sigint: false, sink, signal: controller.signal });
		const a = group.add({ total: 1, message: "a" });
		const cleanup = group.add({ total: 1, message: "cleanup" });

		a.start();
		controller.abort();
		cleanup.start();
		await new Promise((resolve) => setImmediate(resolve));
		cleanup.advance();
		cleanup.stop();

		expect(writes).toEqual(["✗ a (0/1)\n", "✓ cleanup (1/1)\n"]);
	});

	it("restores the cursor and its listeners when the first draw throws", async () => {
		const { sink, writes } = createFakeSink();
		const previousExit = process.listeners("exit");
		const previousSigint = process.listeners("SIGINT");
		const themeError = new Error("theme boom");
		const group = progressGroup({
			sink,
			theme: {
				spinner: () => {
					throw themeError;
				},
			},
		});
		const a = group.add({ total: 1, message: "a" });

		expect(() => a.start()).toThrow(themeError);
		expect(writes.at(-1)).toBe("\x1B[?25h");
		expect(process.listeners("exit")).toEqual(previousExit);
		expect(process.listeners("SIGINT")).toEqual(previousSigint);
		const written = writes.length;
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(writes).toHaveLength(written);
	});

	it("restores the cursor when the last final line throws", () => {
		const { sink, writes } = createFakeSink();
		const themeError = new Error("theme boom");
		const group = progressGroup({
			sigint: false,
			sink,
			theme: {
				success: () => {
					throw themeError;
				},
			},
		});
		const a = group.add({ total: 1, message: "a" });

		a.start();
		expect(() => a.stop()).toThrow(themeError);
		expect(writes.at(-1)).toBe("\x1B[?25h");
	});
});

describe("progressGroup without a terminal", () => {
	it("prints one line per finished indicator and nothing else", () => {
		const { sink, writes } = createFakeSink(false);
		const group = progressGroup({ sink });
		const a = group.add({ total: 2, message: "a3ed95" });
		const b = group.add({ total: 2, message: "6c3374\nverifying" });

		a.start();
		b.start();
		a.advance();
		b.advance(2);
		b.stop("success");
		a.stop("error", "a3ed95 failed");

		expect(writes).toEqual(["✓ 6c3374\n  verifying (2/2)\n", "✗ a3ed95 failed (1/2)\n"]);
	});
});
