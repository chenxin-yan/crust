import { beforeEach, describe, expect, it } from "bun:test";

import { withAmbientTerminalIO } from "@crustjs/utils/terminal";

import { type ProgressSink, spinner, withProgressSink } from "./spinner.ts";
import { createFakeSink } from "./test-helpers.ts";

let sink: ProgressSink;
let writes: string[];

beforeEach(() => {
	({ sink, writes } = createFakeSink());
});

function tick(ms = 10): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
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
			// TODO: drop cast once https://github.com/oven-sh/bun/issues/40003 is fixed.
			// Cast: bun-types 1.4.0's memoryPressure override shadows the generic overload.
			(process as NodeJS.EventEmitter).removeListener("SIGINT", hostListener);
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

	it("renders the final line when stopped before starting", () => {
		const { sink, writes } = createFakeSink(false);
		const handle = spinner({ message: "Working", sink });

		handle.stop("error", "Failed");

		expect(writes).toEqual(["✗ Failed\n"]);
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
	it("reads TTY state from process.stderr for the default sink", () => {
		const originalWrite = process.stderr.write;
		const originalIsTTY = process.stderr.isTTY;
		const output: string[] = [];
		try {
			process.stderr.write = (chunk: string | Uint8Array) => {
				output.push(chunk.toString());
				return true;
			};
			Object.defineProperty(process.stderr, "isTTY", {
				value: true,
				configurable: true,
			});

			const handle = spinner({ message: "Default", sigint: false });
			handle.start();
			handle.stop();

			expect(output).toContain("\x1B[?25l");
		} finally {
			process.stderr.write = originalWrite;
			Object.defineProperty(process.stderr, "isTTY", {
				value: originalIsTTY,
				configurable: true,
			});
		}
	});

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

	it("routes non-interactive final lines through ambient terminal IO", () => {
		const errors: string[] = [];

		withAmbientTerminalIO({ stdout: () => {}, stderr: (text) => errors.push(text) }, () => {
			const handle = spinner({ message: "Bridged" });
			handle.start();
			handle.stop();
		});

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("✓ Bridged");
		expect(errors[0]).not.toEndWith("\n");
	});

	it("prefers the progress ambient sink over ambient terminal IO", () => {
		const { sink, writes } = createFakeSink(false);
		const errors: string[] = [];

		withAmbientTerminalIO({ stdout: () => {}, stderr: (text) => errors.push(text) }, () =>
			withProgressSink(sink, () => {
				const handle = spinner({ message: "Progress ambient" });
				handle.start();
				handle.stop();
			}),
		);

		expect(writes[0]).toContain("✓ Progress ambient\n");
		expect(errors).toEqual([]);
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

describe("spinner — stderr output", () => {
	it("shows success indicator on task completion", async () => {
		await spinner({
			sink,
			message: "Building...",
			task: async () => "ok",
		});

		expect(writes.join("")).toContain("✓");
		expect(writes.join("")).toContain("Building...");
	});

	it("shows error indicator on task failure", async () => {
		try {
			await spinner({
				sink,
				message: "Deploying...",
				task: async () => {
					throw new Error("deploy failed");
				},
			});
		} catch {}

		expect(writes.join("")).toContain("✗");
		expect(writes.join("")).toContain("Deploying...");
	});

	it("renders initial spinner frame immediately", async () => {
		await spinner({
			sink,
			message: "Loading...",
			task: async () => "ok",
		});

		expect(writes.join("")).toContain("⠋");
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
			task: async () => {
				await tick(200);
				return "ok";
			},
			spinner: "line",
		});

		expect(writes.join("")).toContain("-");
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
	it("updates the displayed message via updateMessage", async () => {
		await spinner({
			sink,
			message: "Step 1...",
			task: async ({ updateMessage }) => {
				updateMessage("Step 2...");
				return "ok";
			},
		});

		expect(writes.join("")).toContain("Step 1...");
		expect(writes.join("")).toContain("Step 2...");
	});

	it("success line uses the latest message", async () => {
		await spinner({
			sink,
			message: "Initial...",
			task: async ({ updateMessage }) => {
				updateMessage("Final...");
				return "ok";
			},
		});

		expect(writes.join("")).toContain("✓");
		expect(writes.join("")).toContain("Final...");
		const lastCursorShow = writes.join("").lastIndexOf("\x1B[?25h");
		const beforeCursor = writes.join("").slice(0, lastCursorShow);
		const lastNewline = beforeCursor.lastIndexOf("\n");
		expect(beforeCursor.slice(0, lastNewline + 1)).toContain("Final...");
	});

	it("error line uses the latest message", async () => {
		try {
			await spinner({
				sink,
				message: "Starting...",
				task: async ({ updateMessage }) => {
					updateMessage("Failed step...");
					throw new Error("boom");
				},
			});
		} catch {}

		expect(writes.join("")).toContain("✗");
		expect(writes.join("")).toContain("Failed step...");
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

	it("output ends with newline on success", async () => {
		await spinner({
			sink,
			message: "Working...",
			task: async () => "ok",
		});

		const lastCursorShow = writes.join("").lastIndexOf("\x1B[?25h");
		const beforeCursor = writes.join("").slice(0, lastCursorShow);
		expect(beforeCursor.endsWith("\n")).toBe(true);
	});
});

describe("spinner — non-interactive", () => {
	beforeEach(() => {
		({ sink, writes } = createFakeSink(false));
	});

	it("does not emit ANSI escape codes", async () => {
		await spinner({
			sink,
			message: "Working...",
			task: async () => "ok",
		});

		expect(writes.join("")).not.toContain("\x1B[?25l");
		expect(writes.join("")).not.toContain("\x1B[?25h");
		expect(writes.join("")).not.toContain("\x1B[2K");
		expect(writes.join("")).not.toContain("\r");
	});

	it("only outputs the final success line", async () => {
		await spinner({
			sink,
			message: "Building...",
			task: async () => "ok",
		});

		expect(writes.join("")).toContain("✓");
		expect(writes.join("")).toContain("Building...");
		const lines = writes
			.join("")
			.split("\n")
			.filter((l) => l.length > 0);
		expect(lines.length).toBe(1);
	});

	it("does not output spinner frames", async () => {
		await spinner({
			sink,
			message: "Working...",
			task: async () => {
				await tick(200);
				return "ok";
			},
		});

		expect(writes.join("")).not.toContain("⠋");
		expect(writes.join("")).not.toContain("⠙");
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

		expect(writes.join("")).not.toContain("Step 1...");
		expect(writes.join("")).not.toContain("Step 2...");
		expect(writes.join("")).toContain("Step 3...");
		const lines = writes
			.join("")
			.split("\n")
			.filter((l) => l.length > 0);
		expect(lines.length).toBe(1);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// spinner — imperative handle controller
// ────────────────────────────────────────────────────────────────────────────

describe("spinner — imperative handle", () => {
	it("start and stop live in different call frames", async () => {
		const handle = spinner({ sink, message: "Working..." });

		handle.start();
		await tick(20);
		handle.stop();

		expect(writes.join("")).toContain("Working...");
		expect(writes.join("")).toContain("✓");
		expect(writes.join("")).toContain("\x1B[?25h");
	});

	it("stop('error') renders the failure symbol without throwing", async () => {
		const handle = spinner({ sink, message: "Deploying..." });

		handle.start();
		handle.stop("error", "Deploy failed");

		expect(writes.join("")).toContain("✗");
		expect(writes.join("")).toContain("Deploy failed");
		expect(writes.join("")).not.toContain("✓");
	});
});
