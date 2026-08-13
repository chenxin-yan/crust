import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { type ProgressSink, type SpinnerHandle, spinner, withProgressSink } from "./spinner.ts";

const originalStderrWrite = process.stderr.write;
const originalStderrIsTTY = process.stderr.isTTY;

let stderrOutput: string;

function setupMocks(): void {
	stderrOutput = "";

	process.stderr.write = (chunk: string | Uint8Array) => {
		if (typeof chunk === "string") {
			stderrOutput += chunk;
		}
		return true;
	};

	Object.defineProperty(process.stderr, "isTTY", {
		value: true,
		writable: true,
		configurable: true,
	});
}

function restoreMocks(): void {
	process.stderr.write = originalStderrWrite;
	Object.defineProperty(process.stderr, "isTTY", {
		value: originalStderrIsTTY,
		writable: true,
		configurable: true,
	});
}

function tick(ms = 10): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function createFakeSink(isTTY: boolean) {
	const writes: string[] = [];
	const sink: ProgressSink = {
		isTTY,
		write(text) {
			writes.push(text);
		},
	};
	return { sink, writes };
}

describe("spinner — terminal sink", () => {
	it("hides and restores the cursor in TTY mode", () => {
		const { sink, writes } = createFakeSink(true);
		const handle = spinner({ message: "Working", sink });

		handle.start();
		handle.stop();

		expect(writes[0]).toBe("\x1B[?25l");
		expect(writes).toContain("\x1B[?25h");
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
		process.kill = ((pid: number, signal?: string | number) => {
			kills.push(signal);
			return true;
		}) as typeof process.kill;
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
		process.kill = ((pid: number, signal?: string | number) => {
			kills.push(signal);
			return true;
		}) as typeof process.kill;
		try {
			handler?.("SIGINT");
		} finally {
			process.kill = realKill;
			process.removeListener("SIGINT", hostListener);
		}
		expect(kills).toEqual([]);
		expect(writes.at(-1)).toBe("\x1B[?25h");
	});

	it("writes only the final line in non-TTY mode", () => {
		const { sink, writes } = createFakeSink(false);
		const handle = spinner({ message: "Working", sink });

		handle.start();
		handle.stop();

		expect(writes).toHaveLength(1);
		expect(writes[0]).toContain("✓ Working\n");
		expect(writes[0]).not.toContain("\x1B[");
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
});

describe("spinner — sink resolution", () => {
	it("routes output to the per-call sink option", () => {
		const { sink, writes } = createFakeSink(false);
		const handle = spinner({ message: "Working", sink });

		handle.start();
		handle.stop();

		expect(writes).toHaveLength(1);
		expect(writes[0]).toContain("✓ Working\n");
	});

	it("routes output to the ambient withProgressSink sink", () => {
		const { sink, writes } = createFakeSink(false);

		withProgressSink(sink, () => {
			const handle = spinner({ message: "Ambient" });
			handle.start();
			handle.stop();
		});

		expect(writes[0]).toContain("✓ Ambient\n");
	});

	it("per-call sink option wins over the ambient sink", () => {
		const ambient = createFakeSink(false);
		const explicit = createFakeSink(false);

		withProgressSink(ambient.sink, () => {
			const handle = spinner({ message: "Explicit", sink: explicit.sink });
			handle.start();
			handle.stop();
		});

		expect(ambient.writes).toHaveLength(0);
		expect(explicit.writes[0]).toContain("✓ Explicit\n");
	});

	it("the nearest ambient sink wins when scopes nest", () => {
		const outer = createFakeSink(false);
		const inner = createFakeSink(false);

		withProgressSink(outer.sink, () => {
			withProgressSink(inner.sink, () => {
				const handle = spinner({ message: "Nested" });
				handle.start();
				handle.stop();
			});
		});

		expect(outer.writes).toHaveLength(0);
		expect(inner.writes[0]).toContain("✓ Nested\n");
	});

	it("a handle created inside the scope keeps its sink when stopped outside", () => {
		const { sink, writes } = createFakeSink(false);

		const handle = withProgressSink(sink, () => spinner({ message: "Escaped" }));
		handle.start();
		handle.stop();

		expect(writes[0]).toContain("✓ Escaped\n");
	});

	it("the ambient sink survives async boundaries", async () => {
		const { sink, writes } = createFakeSink(false);

		await withProgressSink(sink, () =>
			spinner({
				message: "Async",
				task: async () => {
					await tick(10);
					return "ok";
				},
			}),
		);

		expect(writes[0]).toContain("✓ Async\n");
	});
});

describe("spinner — task result", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("returns the task result on success", async () => {
		const result = await spinner({
			message: "Loading...",
			task: async () => 42,
		});

		expect(result).toBe(42);
	});

	it("returns complex task result types", async () => {
		const data = { name: "test", values: [1, 2, 3] };
		const result = await spinner({
			message: "Fetching...",
			task: async () => data,
		});

		expect(result).toEqual(data);
	});

	it("returns string task results", async () => {
		const result = await spinner({
			message: "Processing...",
			task: async () => "done",
		});

		expect(result).toBe("done");
	});

	it("awaits async tasks that take time", async () => {
		const result = await spinner({
			message: "Working...",
			task: async () => {
				await tick(50);
				return "completed";
			},
		});

		expect(result).toBe("completed");
	});
});

describe("spinner — task error", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("re-throws errors from the task", async () => {
		await expect(
			spinner({
				message: "Failing...",
				task: async () => {
					throw new Error("task failed");
				},
			}),
		).rejects.toThrow("task failed");
	});

	it("cleans up when the task throws synchronously", async () => {
		await expect(
			spinner({
				message: "Sync boom",
				// Non-async task throwing before it returns a promise.
				task: () => {
					throw new Error("sync boom");
				},
			}),
		).rejects.toThrow("sync boom");

		expect(stderrOutput).toContain("✗");
		expect(stderrOutput).toContain("\x1B[?25h");
		const outputAfterError = stderrOutput;
		await tick(200);
		expect(stderrOutput).toBe(outputAfterError);
	});

	it("re-throws the original error object", async () => {
		const originalError = new TypeError("type mismatch");

		try {
			await spinner({
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

describe("spinner — stderr output", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("writes message to stderr", async () => {
		await spinner({
			message: "Loading data...",
			task: async () => "ok",
		});

		expect(stderrOutput).toContain("Loading data...");
	});

	it("shows success indicator on task completion", async () => {
		await spinner({
			message: "Building...",
			task: async () => "ok",
		});

		expect(stderrOutput).toContain("✓");
		expect(stderrOutput).toContain("Building...");
	});

	it("shows error indicator on task failure", async () => {
		try {
			await spinner({
				message: "Deploying...",
				task: async () => {
					throw new Error("deploy failed");
				},
			});
		} catch {}

		expect(stderrOutput).toContain("✗");
		expect(stderrOutput).toContain("Deploying...");
	});

	it("hides cursor at start", async () => {
		await spinner({
			message: "Working...",
			task: async () => "ok",
		});

		expect(stderrOutput).toContain("\x1B[?25l");
	});

	it("shows cursor after success", async () => {
		await spinner({
			message: "Working...",
			task: async () => "ok",
		});

		expect(stderrOutput).toContain("\x1B[?25h");
	});

	it("shows cursor after error", async () => {
		try {
			await spinner({
				message: "Failing...",
				task: async () => {
					throw new Error("fail");
				},
			});
		} catch {}

		expect(stderrOutput).toContain("\x1B[?25h");
	});

	it("renders initial spinner frame immediately", async () => {
		await spinner({
			message: "Loading...",
			task: async () => "ok",
		});

		expect(stderrOutput).toContain("⠋");
	});
});

describe("spinner — animation", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("animates through frames during long-running task", async () => {
		await spinner({
			message: "Working...",
			task: async () => {
				await tick(200);
				return "ok";
			},
		});

		expect(stderrOutput).toContain("⠋");
		expect(stderrOutput).toContain("⠙");
	});

	it("uses line spinner when specified", async () => {
		await spinner({
			message: "Processing...",
			task: async () => {
				await tick(200);
				return "ok";
			},
			spinner: "line",
		});

		expect(stderrOutput).toContain("-");
	});

	it("uses arc spinner when specified", async () => {
		await spinner({
			message: "Loading...",
			task: async () => "ok",
			spinner: "arc",
		});

		expect(stderrOutput).toContain("◐");
	});

	it("uses bounce spinner when specified", async () => {
		await spinner({
			message: "Loading...",
			task: async () => "ok",
			spinner: "bounce",
		});

		expect(stderrOutput).toContain("⠁");
	});

	it("uses custom spinner frames", async () => {
		await spinner({
			message: "Custom...",
			task: async () => "ok",
			spinner: { frames: ["A", "B", "C"], interval: 50 },
		});

		expect(stderrOutput).toContain("A");
	});

	it("cycles through custom spinner frames", async () => {
		await spinner({
			message: "Custom...",
			task: async () => {
				await tick(200);
				return "ok";
			},
			spinner: { frames: ["X", "Y"], interval: 50 },
		});

		expect(stderrOutput).toContain("X");
		expect(stderrOutput).toContain("Y");
	});
});

describe("spinner — message updates", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("updates the displayed message via updateMessage", async () => {
		await spinner({
			message: "Step 1...",
			task: async ({ updateMessage }) => {
				updateMessage("Step 2...");
				return "ok";
			},
		});

		expect(stderrOutput).toContain("Step 1...");
		expect(stderrOutput).toContain("Step 2...");
	});

	it("success line uses the latest message", async () => {
		await spinner({
			message: "Initial...",
			task: async ({ updateMessage }) => {
				updateMessage("Final...");
				return "ok";
			},
		});

		expect(stderrOutput).toContain("✓");
		expect(stderrOutput).toContain("Final...");
		const lastCursorShow = stderrOutput.lastIndexOf("\x1B[?25h");
		const beforeCursor = stderrOutput.slice(0, lastCursorShow);
		const lastNewline = beforeCursor.lastIndexOf("\n");
		expect(beforeCursor.slice(0, lastNewline + 1)).toContain("Final...");
	});

	it("error line uses the latest message", async () => {
		try {
			await spinner({
				message: "Starting...",
				task: async ({ updateMessage }) => {
					updateMessage("Failed step...");
					throw new Error("boom");
				},
			});
		} catch {}

		expect(stderrOutput).toContain("✗");
		expect(stderrOutput).toContain("Failed step...");
	});

	it("supports multiple message updates", async () => {
		await spinner({
			message: "Phase 1...",
			task: async ({ updateMessage }) => {
				updateMessage("Phase 2...");
				updateMessage("Phase 3...");
				updateMessage("Phase 4...");
				return "ok";
			},
		});

		expect(stderrOutput).toContain("Phase 1...");
		expect(stderrOutput).toContain("Phase 2...");
		expect(stderrOutput).toContain("Phase 3...");
		expect(stderrOutput).toContain("Phase 4...");
	});

	it("ignores updateMessage calls after task completes", async () => {
		let savedController: { updateMessage: (msg: string) => void } | undefined;

		await spinner({
			message: "Running...",
			task: async (controller) => {
				savedController = controller;
				return "ok";
			},
		});

		const outputAfterComplete = stderrOutput;
		savedController?.updateMessage("Late update...");

		expect(stderrOutput).toBe(outputAfterComplete);
		expect(stderrOutput).not.toContain("Late update...");
	});

	it("works when callback ignores the controller", async () => {
		const result = await spinner({
			message: "Simple task...",
			task: async () => 42,
		});

		expect(result).toBe(42);
		expect(stderrOutput).toContain("Simple task...");
		expect(stderrOutput).toContain("✓");
	});
});

describe("spinner — cleanup", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("cleans up interval on success (no lingering writes)", async () => {
		await spinner({
			message: "Done...",
			task: async () => "ok",
		});

		const outputAfterComplete = stderrOutput;
		await tick(200);

		expect(stderrOutput).toBe(outputAfterComplete);
	});

	it("cleans up interval on error (no lingering writes)", async () => {
		try {
			await spinner({
				message: "Failing...",
				task: async () => {
					throw new Error("fail");
				},
			});
		} catch {}

		const outputAfterError = stderrOutput;
		await tick(200);

		expect(stderrOutput).toBe(outputAfterError);
	});

	it("output ends with newline on success", async () => {
		await spinner({
			message: "Working...",
			task: async () => "ok",
		});

		const lastCursorShow = stderrOutput.lastIndexOf("\x1B[?25h");
		const beforeCursor = stderrOutput.slice(0, lastCursorShow);
		expect(beforeCursor.endsWith("\n")).toBe(true);
	});

	it("output ends with newline on error", async () => {
		try {
			await spinner({
				message: "Failing...",
				task: async () => {
					throw new Error("fail");
				},
			});
		} catch {}

		const lastCursorShow = stderrOutput.lastIndexOf("\x1B[?25h");
		const beforeCursor = stderrOutput.slice(0, lastCursorShow);
		expect(beforeCursor.endsWith("\n")).toBe(true);
	});
});

describe("spinner — non-interactive", () => {
	beforeEach(() => {
		setupMocks();
		Object.defineProperty(process.stderr, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});
	});
	afterEach(restoreMocks);

	it("returns the task result on success", async () => {
		const result = await spinner({
			message: "Loading...",
			task: async () => 42,
		});

		expect(result).toBe(42);
	});

	it("re-throws errors from the task", async () => {
		await expect(
			spinner({
				message: "Failing...",
				task: async () => {
					throw new Error("task failed");
				},
			}),
		).rejects.toThrow("task failed");
	});

	it("does not emit ANSI escape codes", async () => {
		await spinner({
			message: "Working...",
			task: async () => "ok",
		});

		expect(stderrOutput).not.toContain("\x1B[?25l");
		expect(stderrOutput).not.toContain("\x1B[?25h");
		expect(stderrOutput).not.toContain("\x1B[2K");
		expect(stderrOutput).not.toContain("\r");
	});

	it("only outputs the final success line", async () => {
		await spinner({
			message: "Building...",
			task: async () => "ok",
		});

		expect(stderrOutput).toContain("✓");
		expect(stderrOutput).toContain("Building...");
		const lines = stderrOutput.split("\n").filter((l) => l.length > 0);
		expect(lines.length).toBe(1);
	});

	it("only outputs the final error line", async () => {
		try {
			await spinner({
				message: "Deploying...",
				task: async () => {
					throw new Error("deploy failed");
				},
			});
		} catch {}

		expect(stderrOutput).toContain("✗");
		expect(stderrOutput).toContain("Deploying...");
		const lines = stderrOutput.split("\n").filter((l) => l.length > 0);
		expect(lines.length).toBe(1);
	});

	it("does not output spinner frames", async () => {
		await spinner({
			message: "Working...",
			task: async () => {
				await tick(200);
				return "ok";
			},
		});

		expect(stderrOutput).not.toContain("⠋");
		expect(stderrOutput).not.toContain("⠙");
	});

	it("updateMessage silently updates the message", async () => {
		await spinner({
			message: "Step 1...",
			task: async ({ updateMessage }) => {
				updateMessage("Step 2...");
				updateMessage("Step 3...");
				return "ok";
			},
		});

		expect(stderrOutput).not.toContain("Step 1...");
		expect(stderrOutput).not.toContain("Step 2...");
		expect(stderrOutput).toContain("Step 3...");
		const lines = stderrOutput.split("\n").filter((l) => l.length > 0);
		expect(lines.length).toBe(1);
	});

	it("success line uses the latest message", async () => {
		await spinner({
			message: "Initial...",
			task: async ({ updateMessage }) => {
				updateMessage("Final...");
				return "ok";
			},
		});

		const lines = stderrOutput.split("\n").filter((l) => l.length > 0);
		expect(lines.length).toBe(1);
		expect(lines[0]).toContain("✓");
		expect(lines[0]).toContain("Final...");
	});

	it("error line uses the latest message", async () => {
		try {
			await spinner({
				message: "Starting...",
				task: async ({ updateMessage }) => {
					updateMessage("Failed step...");
					throw new Error("boom");
				},
			});
		} catch {}

		const lines = stderrOutput.split("\n").filter((l) => l.length > 0);
		expect(lines.length).toBe(1);
		expect(lines[0]).toContain("✗");
		expect(lines[0]).toContain("Failed step...");
	});

	it("ignores updateMessage calls after task completes", async () => {
		let savedController: Pick<SpinnerHandle, "updateMessage"> | undefined;

		await spinner({
			message: "Running...",
			task: async (controller) => {
				savedController = controller;
				return "ok";
			},
		});

		const outputAfterComplete = stderrOutput;

		savedController?.updateMessage("Late update...");

		expect(stderrOutput).toBe(outputAfterComplete);
		expect(stderrOutput).not.toContain("Late update...");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// spinner — imperative handle controller
// ────────────────────────────────────────────────────────────────────────────

describe("spinner — imperative handle", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("start and stop live in different call frames", async () => {
		const handle = spinner({ message: "Working..." });

		handle.start();
		await tick(20);
		handle.stop();

		expect(stderrOutput).toContain("Working...");
		expect(stderrOutput).toContain("✓");
		expect(stderrOutput).toContain("\x1B[?25h");
	});

	it("stop('error') renders the failure symbol without throwing", async () => {
		const handle = spinner({ message: "Deploying..." });

		handle.start();
		handle.stop("error", "Deploy failed");

		expect(stderrOutput).toContain("✗");
		expect(stderrOutput).toContain("Deploy failed");
		expect(stderrOutput).not.toContain("✓");
	});

	it("updateMessage repaints while running", async () => {
		const handle = spinner({ message: "Step 1" });

		handle.start();
		handle.updateMessage("Step 2");
		handle.stop();

		expect(stderrOutput).toContain("Step 2");
	});

	it("stop is idempotent", async () => {
		const handle = spinner({ message: "Once" });

		handle.start();
		handle.stop("success", "done");
		handle.stop("error", "again");

		expect(stderrOutput).not.toContain("✗");
	});
});
