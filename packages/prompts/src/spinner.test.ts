import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spinner } from "./spinner.ts";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

const originalStderrWrite = process.stderr.write;

let stderrOutput: string;

function setupMocks(): void {
	stderrOutput = "";

	process.stderr.write = ((chunk: string | Uint8Array) => {
		if (typeof chunk === "string") {
			stderrOutput += chunk;
		}
		return true;
	}) as typeof process.stderr.write;
}

function restoreMocks(): void {
	process.stderr.write = originalStderrWrite;
}

/**
 * Wait briefly for async processing.
 */
function tick(ms = 10): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ────────────────────────────────────────────────────────────────────────────
// Task result
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Task error
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Stderr output
// ────────────────────────────────────────────────────────────────────────────

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

		expect(stderrOutput).toContain("✔");
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
		} catch {
			// Expected
		}

		expect(stderrOutput).toContain("✖");
		expect(stderrOutput).toContain("Deploying...");
	});

	it("hides cursor at start", async () => {
		await spinner({
			message: "Working...",
			task: async () => "ok",
		});

		// ESC[?25l is the ANSI sequence to hide cursor
		expect(stderrOutput).toContain("\x1B[?25l");
	});

	it("shows cursor after success", async () => {
		await spinner({
			message: "Working...",
			task: async () => "ok",
		});

		// ESC[?25h is the ANSI sequence to show cursor
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
		} catch {
			// Expected
		}

		expect(stderrOutput).toContain("\x1B[?25h");
	});

	it("renders initial spinner frame immediately", async () => {
		await spinner({
			message: "Loading...",
			task: async () => "ok",
		});

		// Default dots spinner starts with ⠋
		expect(stderrOutput).toContain("⠋");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Spinner animation frames
// ────────────────────────────────────────────────────────────────────────────

describe("spinner — animation", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("animates through frames during long-running task", async () => {
		await spinner({
			message: "Working...",
			task: async () => {
				// Wait long enough for at least one frame cycle (default dots interval is 80ms)
				await tick(200);
				return "ok";
			},
		});

		// Should have rendered at least the first two frames of dots spinner
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

		// Line spinner starts with "-"
		expect(stderrOutput).toContain("-");
	});

	it("uses arc spinner when specified", async () => {
		await spinner({
			message: "Loading...",
			task: async () => "ok",
			spinner: "arc",
		});

		// Arc spinner starts with ◐
		expect(stderrOutput).toContain("◐");
	});

	it("uses bounce spinner when specified", async () => {
		await spinner({
			message: "Loading...",
			task: async () => "ok",
			spinner: "bounce",
		});

		// Bounce spinner starts with ⠁
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

// ────────────────────────────────────────────────────────────────────────────
// Cleanup
// ────────────────────────────────────────────────────────────────────────────

describe("spinner — cleanup", () => {
	beforeEach(setupMocks);
	afterEach(restoreMocks);

	it("cleans up interval on success (no lingering writes)", async () => {
		await spinner({
			message: "Done...",
			task: async () => "ok",
		});

		const outputAfterComplete = stderrOutput;

		// Wait to ensure no more frames are being written
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
		} catch {
			// Expected
		}

		const outputAfterError = stderrOutput;

		// Wait to ensure no more frames are being written
		await tick(200);

		expect(stderrOutput).toBe(outputAfterError);
	});

	it("output ends with newline on success", async () => {
		await spinner({
			message: "Working...",
			task: async () => "ok",
		});

		// The last write before show-cursor should end with newline
		// (renderSuccess appends \n)
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
		} catch {
			// Expected
		}

		const lastCursorShow = stderrOutput.lastIndexOf("\x1B[?25h");
		const beforeCursor = stderrOutput.slice(0, lastCursorShow);
		expect(beforeCursor.endsWith("\n")).toBe(true);
	});
});
