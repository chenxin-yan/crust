import { setTimeout as tick } from "node:timers/promises";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { type TerminalOutput, spinner, withTerminalIO } from "./spinner.ts";
import { createFakeSink } from "./test-helpers.ts";

// Keep frames plain; the default theme follows the sink's TTY state (see "default theme color").
beforeAll(() => vi.stubEnv("FORCE_COLOR", "0"));
afterAll(() => vi.unstubAllEnvs());

let sink: TerminalOutput;
let writes: string[];

beforeEach(() => {
	({ sink, writes } = createFakeSink());
});

describe("spinner — terminal sink", () => {
	it("hides and restores the cursor in TTY mode", () => {
		const previousHandlers = process.listeners("SIGINT");
		const { sink, writes } = createFakeSink(true);
		const handle = spinner({ message: "Working", sink });

		handle.start();
		handle.stop();

		expect(writes[0]).toBe("\x1B[?25l");
		expect(writes.at(-1)).toBe("\x1B[?25h");
		expect(process.listeners("SIGINT")).toEqual(previousHandlers);
	});

	it("restores the cursor and re-raises SIGINT", () => {
		const { sink, writes } = createFakeSink(true);
		const previousHandlers = new Set(process.listeners("SIGINT"));
		const handle = spinner({ message: "Working", sink });
		handle.start();
		const handler = process.listeners("SIGINT").find((listener) => !previousHandlers.has(listener));

		expect(handler).toBeDefined();
		// Stub the re-raise — a real one would terminate the test run.
		const realKill = process.kill;
		const kills: (string | number | undefined)[] = [];
		process.kill = (pid: number, signal?: string | number) => {
			kills.push(signal);
			return true;
		};
		try {
			handler?.("SIGINT");
		} finally {
			process.kill = realKill;
		}
		expect(kills).toEqual(["SIGINT"]);
		expect(writes.at(-1)).toBe("\x1B[?25h");
		expect(process.listeners("SIGINT")).not.toContain(handler);
	});

	it("does not re-raise SIGINT when the host keeps its own listener", () => {
		const { sink, writes } = createFakeSink(true);
		const hostListener = () => {};
		process.on("SIGINT", hostListener);
		const previousHandlers = new Set(process.listeners("SIGINT"));
		const handle = spinner({ message: "Working", sink });
		handle.start();
		const handler = process.listeners("SIGINT").find((listener) => !previousHandlers.has(listener));

		const realKill = process.kill;
		const kills: (string | number | undefined)[] = [];
		process.kill = (pid: number, signal?: string | number) => {
			kills.push(signal);
			return true;
		};
		try {
			handler?.("SIGINT");
		} finally {
			process.kill = realKill;
			process.removeListener("SIGINT", hostListener);
		}
		expect(kills).toEqual([]);
		expect(writes.at(-1)).toBe("\x1B[?25h");
	});

	it("applies per-call theme overrides to rendered output", () => {
		const { sink, writes } = createFakeSink(false);
		const handle = spinner({
			message: "Working",
			theme: { success: (t) => `<OK ${t}>` },
			sink,
		});

		handle.start();
		handle.stop("success");

		expect(writes[0]).toContain("<OK ✓> Working\n");
	});

	it("finalizes once", () => {
		const { sink, writes } = createFakeSink(false);
		const handle = spinner({ message: "Working", sink });

		handle.start();
		handle.stop("success");
		const finalOutput = [...writes];
		handle.stop("error");

		expect(writes).toEqual(finalOutput);
	});

	it("leaves SIGINT to the application when disabled", () => {
		const { sink } = createFakeSink(true);
		const previousHandlers = process.listeners("SIGINT");
		const handle = spinner({ message: "Working", sigint: false, sink });

		handle.start();
		expect(process.listeners("SIGINT")).toEqual(previousHandlers);
		handle.stop();
	});

	it("restores the cursor on process exit and removes the exit listener on stop", () => {
		const { sink, writes } = createFakeSink(true);
		const previousHandlers = new Set(process.listeners("exit"));
		const handle = spinner({ message: "Working", sigint: false, sink });
		handle.start();
		const added = process.listeners("exit").filter((listener) => !previousHandlers.has(listener));

		expect(added).toHaveLength(1);
		// Invoke directly — emitting a real "exit" would run the test runner's listeners.
		added[0]?.(0);
		expect(writes.at(-1)).toBe("\x1B[?25h");

		handle.stop();
		expect(new Set(process.listeners("exit"))).toEqual(previousHandlers);
	});

	it("cuts a message wider than the terminal to one row and prints it whole when done", () => {
		const writes: string[] = [];
		const sink = { isTTY: true, columns: 10, write: (text: string) => void writes.push(text) };
		// "⠋ " leaves 7 of the 9 usable columns: 6 characters and "…".
		const handle = spinner({ message: "abcdefghijklmnop", sigint: false, sink });
		handle.start();
		handle.updateMessage("short");
		handle.stop("success", "abcdefghijklmnop");

		expect(writes).toEqual([
			"\x1B[?25l",
			"\x1B[2K\r⠋ abcdef…",
			"\x1B[2K\r⠋ short",
			"\x1B[2K\r✓ abcdefghijklmnop\n",
			"\x1B[?25h",
		]);
	});

	it("cuts a wide character that would cross the edge whole", () => {
		const writes: string[] = [];
		const sink = { isTTY: true, columns: 10, write: (text: string) => void writes.push(text) };
		const handle = spinner({ message: "aaaaa界", sigint: false, sink });
		handle.start();
		handle.updateMessage("aaaaaa界");
		handle.stop();

		// "aaaaa界" fills the 7 columns exactly; one more "a" pushes "界" past them.
		expect(writes.slice(1, 3)).toEqual(["\x1B[2K\r⠋ aaaaa界", "\x1B[2K\r⠋ aaaaaa…"]);
	});

	it("does not count text a carriage return rewinds over toward the row width", () => {
		const writes: string[] = [];
		const sink = { isTTY: true, columns: 10, write: (text: string) => void writes.push(text) };
		// "abcdef" and "ghijkl" overwrite each other within the 7 columns left.
		const handle = spinner({ message: "abcdef\rghijkl", sigint: false, sink });
		handle.start();
		handle.stop();

		expect(writes[1]).toBe("\x1B[2K\r⠋ abcdef\rghijkl");
	});

	it("cuts a multi-line message at its first line break", () => {
		const writes: string[] = [];
		const sink = { isTTY: true, columns: 10, write: (text: string) => void writes.push(text) };
		const handle = spinner({ message: "ab\ncd", sigint: false, sink });
		handle.start();
		handle.stop();

		expect(writes[1]).toBe("\x1B[2K\r⠋ ab…");
	});

	it("keeps the styles a cut frame opened closed", () => {
		const writes: string[] = [];
		const sink = { isTTY: true, columns: 10, write: (text: string) => void writes.push(text) };
		const handle = spinner({
			message: "Building",
			spinner: { frames: ["ABCDEFGHIJ"], interval: 60_000 },
			theme: { spinner: (frame) => `\x1B[35m${frame}\x1B[39m`, message: (text) => text },
			sigint: false,
			sink,
		});
		handle.start();
		handle.stop();

		expect(writes[1]).toBe("\x1B[2K\r\x1B[35mABCDEFGH…\x1B[39m");
	});
});

describe("spinner — sink resolution", () => {
	it("writes the default sink through Core's stderr writer and reads its TTY state from fd 2", () => {
		const output: string[] = [];
		vi.spyOn(process.getBuiltinModule("node:tty"), "isatty").mockImplementation((fd) => fd === 2);
		// The shared writer targets fd 2, or `process.stderr` on Windows.
		if (process.platform === "win32") {
			vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
				output.push(Buffer.from(chunk).toString("utf8"));
				return true;
			});
		} else {
			const fs = process.getBuiltinModule("node:fs");
			const writeSync = fs.writeSync;
			vi.spyOn(fs, "writeSync").mockImplementation(((
				fd: number,
				buffer: Uint8Array,
				offset?: number,
			) => {
				if (fd !== 2) return writeSync(fd, buffer, offset);
				output.push(Buffer.from(buffer.subarray(offset)).toString("utf8"));
				return buffer.length - (offset ?? 0);
			}) as typeof writeSync);
		}
		try {
			const handle = spinner({ message: "Default", sigint: false });
			handle.start();
			handle.stop();

			expect(output).toContain("\x1B[?25l");
			expect(output.at(-1)).toBe("\x1B[?25h");
		} finally {
			vi.restoreAllMocks();
		}
	});

	it("routes output to the ambient withTerminalIO output", () => {
		const { sink, writes } = createFakeSink(false);

		withTerminalIO({ output: sink }, () => {
			const handle = spinner({ message: "Ambient" });
			handle.start();
			handle.stop();
		});

		expect(writes[0]).toContain("✓ Ambient\n");
	});

	it("per-call sink option wins over the ambient sink", () => {
		const ambient = createFakeSink(false);
		const explicit = createFakeSink(false);

		withTerminalIO({ output: ambient.sink }, () => {
			const handle = spinner({ message: "Explicit", sink: explicit.sink });
			handle.start();
			handle.stop();
		});

		expect(ambient.writes).toHaveLength(0);
		expect(explicit.writes[0]).toContain("✓ Explicit\n");
	});

	it("a handle created inside the scope keeps its sink when stopped outside", () => {
		const { sink, writes } = createFakeSink(false);

		const handle = withTerminalIO({ output: sink }, () => spinner({ message: "Escaped" }));
		handle.start();
		handle.stop();

		expect(writes[0]).toContain("✓ Escaped\n");
	});
});

describe("spinner — default theme color", () => {
	const originalIsTTY = process.stdout.isTTY;

	function withStdoutTTY(isTTY: boolean, fn: () => void): void {
		vi.stubEnv("FORCE_COLOR", undefined);
		vi.stubEnv("NO_COLOR", undefined);
		vi.stubEnv("COLORTERM", undefined);
		vi.stubEnv("TERM", undefined);
		Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true });
		try {
			fn();
		} finally {
			Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
			vi.stubEnv("FORCE_COLOR", "0");
		}
	}

	it("styles a TTY sink when stdout is piped", () => {
		const { sink, writes } = createFakeSink(true);
		withStdoutTTY(false, () => {
			const handle = spinner({ message: "Colored", sigint: false, sink });
			handle.start();
			handle.stop();
		});

		expect(writes.join("")).toContain("\x1B[32m✓\x1B[39m \x1B[1mColored\x1B[22m\n");
	});

	it("keeps a redirected sink plain when stdout is a TTY", () => {
		const { sink, writes } = createFakeSink(false);
		withStdoutTTY(true, () => {
			const handle = spinner({ message: "Plain", sink });
			handle.start();
			handle.stop();
		});

		expect(writes).toEqual(["✓ Plain\n"]);
	});
});

describe("spinner — task result", () => {
	it("returns the task result on success", async () => {
		const result = await spinner({
			sink,
			message: "Loading...",
			task: async () => 42,
		});

		expect(result).toBe(42);
	});
});

describe("spinner — task error", () => {
	it("cleans up when the task throws synchronously", async () => {
		await expect(
			spinner({
				sink,
				message: "Sync boom",
				// Non-async task throwing before it returns a promise.
				task: () => {
					throw new Error("sync boom");
				},
			}),
		).rejects.toThrow("sync boom");

		expect(writes.join("")).toContain("✗");
		expect(writes.join("")).toContain("\x1B[?25h");
		const outputAfterError = writes.join("");
		await tick(200);
		expect(writes.join("")).toBe(outputAfterError);
	});

	it("re-throws the original error object", async () => {
		const originalError = new TypeError("type mismatch");

		try {
			await spinner({
				sink,
				message: "Failing...",
				task: async () => {
					throw originalError;
				},
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toBe(originalError);
		}
	});
});

describe("spinner — animation", () => {
	it("animates through frames during long-running task", async () => {
		await spinner({
			sink,
			message: "Working...",
			task: async () => {
				await tick(200);
				return "ok";
			},
		});

		expect(writes.join("")).toContain("⠋");
		expect(writes.join("")).toContain("⠙");
	});

	it("uses line spinner when specified", async () => {
		await spinner({
			sink,
			message: "Processing...",
			task: async () => "ok",
			spinner: "line",
		});

		expect(writes[1]).toContain("- Processing...");
	});

	it("uses custom spinner frames", async () => {
		await spinner({
			sink,
			message: "Custom...",
			task: async () => "ok",
			spinner: { frames: ["A", "B", "C"], interval: 50 },
		});

		expect(writes.join("")).toContain("A");
	});

	it("rejects an empty custom frame set", () => {
		expect(() =>
			spinner({ sink, message: "Empty", spinner: { frames: [], interval: 50 } }),
		).toThrow("requires at least one frame");
	});
});

describe("spinner — message updates", () => {
	it("success line uses the latest message", async () => {
		await spinner({
			sink,
			message: "Initial...",
			task: async ({ updateMessage }) => {
				updateMessage("Final...");
				return "ok";
			},
		});

		expect(writes.at(-2)).toBe("\x1B[2K\r✓ Final...\n");
		expect(writes.at(-1)).toBe("\x1B[?25h");
	});

	it("ignores updateMessage calls after task completes", async () => {
		let savedController: { updateMessage: (msg: string) => void } | undefined;

		await spinner({
			sink,
			message: "Running...",
			task: async (controller) => {
				savedController = controller;
				return "ok";
			},
		});

		const outputAfterComplete = writes.join("");
		savedController?.updateMessage("Late update...");

		expect(writes.join("")).toBe(outputAfterComplete);
		expect(writes.join("")).not.toContain("Late update...");
	});
});

describe("spinner — cleanup", () => {
	it("cleans up interval on success (no lingering writes)", async () => {
		await spinner({
			sink,
			message: "Done...",
			task: async () => "ok",
		});

		const outputAfterComplete = writes.join("");
		await tick(200);

		expect(writes.join("")).toBe(outputAfterComplete);
	});

	it("restores the cursor and removes the exit listener when the first frame throws", () => {
		const { sink, writes } = createFakeSink(true);
		const previousExit = process.listeners("exit");
		const previousSigint = process.listeners("SIGINT");
		const themeError = new Error("theme boom");
		const handle = spinner({
			message: "Working",
			sink,
			theme: {
				spinner: () => {
					throw themeError;
				},
			},
		});

		expect(() => handle.start()).toThrow(themeError);
		expect(writes.at(-1)).toBe("\x1B[?25h");
		expect(process.listeners("exit")).toEqual(previousExit);
		expect(process.listeners("SIGINT")).toEqual(previousSigint);
	});

	it("restores the cursor and cleans up when the final theme throws", async () => {
		const previousHandlers = process.listeners("SIGINT");
		const themeError = new Error("theme boom");

		await expect(
			spinner({
				sink,
				message: "Working",
				theme: {
					success: () => {
						throw themeError;
					},
				},
				task: async () => "ok",
			}),
		).rejects.toBe(themeError);

		expect(writes.at(-1)).toBe("\x1B[?25h");
		expect(process.listeners("SIGINT")).toEqual(previousHandlers);
		const outputAfterError = writes.join("");
		await tick(200);
		expect(writes.join("")).toBe(outputAfterError);
	});

	function stopWithFailingRestore(theme?: { success: () => never }) {
		const previousHandlers = process.listeners("SIGINT");
		const { sink: recording, writes } = createFakeSink(true);
		const failingRestore: TerminalOutput = {
			isTTY: true,
			write: (text) => {
				recording.write(text);
				if (text === "\x1B[?25h") throw new Error("restore boom");
				return true;
			},
		};
		const handle = spinner({ message: "Working", sink: failingRestore, theme });
		handle.start();
		const caught = (() => {
			try {
				handle.stop();
			} catch (error) {
				return { error };
			}
			return undefined;
		})();
		expect(writes.at(-1)).toBe("\x1B[?25h");
		expect(process.listeners("SIGINT")).toEqual(previousHandlers);
		return { caught, writes, themeWrites: writes.filter((text) => text.includes("✓")) };
	}

	it("keeps the final-render error when cursor restoration also throws", async () => {
		const { caught, writes } = stopWithFailingRestore({
			success: () => {
				// Arbitrary thrown values, including undefined, must survive.
				throw undefined;
			},
		});

		expect(caught).toStrictEqual({ error: undefined });
		const outputAfterError = writes.join("");
		await tick(200);
		expect(writes.join("")).toBe(outputAfterError);
	});

	it("propagates a cursor restoration failure after a successful final line", async () => {
		const { caught, writes, themeWrites } = stopWithFailingRestore();

		expect(caught?.error).toBeInstanceOf(Error);
		expect(caught?.error).toHaveProperty("message", "restore boom");
		expect(themeWrites).toHaveLength(1);
		const outputAfterError = writes.join("");
		await tick(200);
		expect(writes.join("")).toBe(outputAfterError);
	});
});

describe("spinner — non-interactive", () => {
	beforeEach(() => {
		({ sink, writes } = createFakeSink(false));
	});

	it("only outputs the final plain-text line during a long task", async () => {
		await spinner({
			sink,
			message: "Working...",
			task: async () => {
				await tick(200);
				return "ok";
			},
		});

		expect(writes).toEqual(["✓ Working...\n"]);
	});

	it("updateMessage silently updates the message", async () => {
		await spinner({
			sink,
			message: "Step 1...",
			task: async ({ updateMessage }) => {
				updateMessage("Step 2...");
				updateMessage("Step 3...");
				return "ok";
			},
		});

		expect(writes).toEqual(["✓ Step 3...\n"]);
	});
});
