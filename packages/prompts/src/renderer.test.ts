import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	assertTTY,
	NonInteractiveError,
	type PromptConfig,
	runPrompt,
} from "./renderer.ts";
import { defaultTheme } from "./theme.ts";

// ────────────────────────────────────────────────────────────────────────────
// TTY detection
// ────────────────────────────────────────────────────────────────────────────

describe("assertTTY", () => {
	const originalIsTTY = process.stdin.isTTY;

	afterEach(() => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: originalIsTTY,
			writable: true,
			configurable: true,
		});
	});

	it("throws NonInteractiveError when stdin is not a TTY", () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		expect(() => assertTTY()).toThrow(NonInteractiveError);
	});

	it("throws with descriptive message when not a TTY", () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		expect(() => assertTTY()).toThrow(
			"Prompts require an interactive terminal (TTY)",
		);
	});

	it("does not throw when stdin is a TTY", () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			writable: true,
			configurable: true,
		});

		expect(() => assertTTY()).not.toThrow();
	});
});

describe("NonInteractiveError", () => {
	it("has the correct name", () => {
		const error = new NonInteractiveError();
		expect(error.name).toBe("NonInteractiveError");
	});

	it("has a default message", () => {
		const error = new NonInteractiveError();
		expect(error.message).toContain("interactive terminal");
	});

	it("accepts a custom message", () => {
		const error = new NonInteractiveError("custom error");
		expect(error.message).toBe("custom error");
	});

	it("is an instance of Error", () => {
		const error = new NonInteractiveError();
		expect(error).toBeInstanceOf(Error);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// runPrompt
// ────────────────────────────────────────────────────────────────────────────

describe("runPrompt", () => {
	const originalIsTTY = process.stdin.isTTY;
	const originalSetRawMode = process.stdin.setRawMode;
	const originalIsRaw = process.stdin.isRaw;
	const originalStderrWrite = process.stderr.write;
	let stderrOutput: string;

	beforeEach(() => {
		stderrOutput = "";

		// Mock stderr to capture output
		process.stderr.write = ((chunk: string | Uint8Array) => {
			if (typeof chunk === "string") {
				stderrOutput += chunk;
			}
			return true;
		}) as typeof process.stderr.write;

		// Ensure stdin looks like a TTY with a working setRawMode
		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			writable: true,
			configurable: true,
		});

		// Mock setRawMode since the test runner stdin is not a real TTY
		// biome-ignore lint/suspicious/noExplicitAny: mocking process.stdin methods for testing
		(process.stdin as any).setRawMode = (mode: boolean) => {
			Object.defineProperty(process.stdin, "isRaw", {
				value: mode,
				writable: true,
				configurable: true,
			});
			return process.stdin;
		};
	});

	afterEach(() => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: originalIsTTY,
			writable: true,
			configurable: true,
		});
		Object.defineProperty(process.stdin, "isRaw", {
			value: originalIsRaw,
			writable: true,
			configurable: true,
		});
		if (originalSetRawMode) {
			process.stdin.setRawMode = originalSetRawMode;
		}
		process.stderr.write = originalStderrWrite;
		// Remove any lingering keypress listeners added during tests
		process.stdin.removeAllListeners("keypress");
	});

	it("rejects with NonInteractiveError when stdin is not a TTY", async () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			writable: true,
			configurable: true,
		});

		const config: PromptConfig<{ value: string }, string> = {
			render: (state) => state.value,
			handleKey: (_key, state) => state,
			initialState: { value: "" },
			theme: defaultTheme,
		};

		await expect(runPrompt(config)).rejects.toThrow(NonInteractiveError);
	});

	it("resolves with submitted value when handleKey returns submit", async () => {
		const config: PromptConfig<{ value: string }, string> = {
			render: (state) => state.value,
			handleKey: () => ({ submit: "hello" }),
			initialState: { value: "test" },
			theme: defaultTheme,
		};

		const promise = runPrompt(config);

		// Allow event listener setup
		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", "a", { name: "a" });

		const result = await promise;
		expect(result).toBe("hello");
	});

	it("updates state on non-submit keypress", async () => {
		let keypressCount = 0;

		const config: PromptConfig<{ value: string }, string> = {
			render: (state) => state.value,
			handleKey: (_key, state) => {
				keypressCount++;
				if (keypressCount >= 3) {
					return { submit: `${state.value}!` };
				}
				return { value: `${state.value}x` };
			},
			initialState: { value: "" },
			theme: defaultTheme,
		};

		const promise = runPrompt(config);

		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", "a", { name: "a" });
		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", "b", { name: "b" });
		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", undefined, { name: "return" });

		const result = await promise;
		expect(result).toBe("xx!");
	});

	it("writes output to stderr, not stdout", async () => {
		const config: PromptConfig<{ value: string }, string> = {
			render: () => "prompt output",
			handleKey: () => ({ submit: "done" }),
			initialState: { value: "" },
			theme: defaultTheme,
		};

		const promise = runPrompt(config);

		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", "a", { name: "return" });

		await promise;
		expect(stderrOutput).toContain("prompt output");
	});

	it("hides cursor on start and shows cursor on cleanup", async () => {
		const config: PromptConfig<{ value: string }, string> = {
			render: () => "test",
			handleKey: () => ({ submit: "done" }),
			initialState: { value: "" },
			theme: defaultTheme,
		};

		const promise = runPrompt(config);

		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", "a", { name: "return" });

		await promise;

		// Hide cursor (ESC[?25l) at start
		expect(stderrOutput).toContain("\x1B[?25l");
		// Show cursor (ESC[?25h) at cleanup
		expect(stderrOutput).toContain("\x1B[?25h");
	});

	it("calls renderSubmitted when provided", async () => {
		const config: PromptConfig<{ value: string }, string> = {
			render: (state) => `input: ${state.value}`,
			handleKey: () => ({ submit: "final" }),
			initialState: { value: "test" },
			theme: defaultTheme,
			renderSubmitted: (_state, value, theme) =>
				`${theme.success("done")} ${value}`,
		};

		const promise = runPrompt(config);

		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", undefined, { name: "return" });

		const result = await promise;
		expect(result).toBe("final");
		expect(stderrOutput).toContain("done");
		expect(stderrOutput).toContain("final");
	});

	it("handles async handleKey", async () => {
		const config: PromptConfig<{ value: string }, string> = {
			render: (state) => state.value,
			handleKey: async () => {
				await new Promise((r) => setTimeout(r, 5));
				return { submit: "async-result" };
			},
			initialState: { value: "" },
			theme: defaultTheme,
		};

		const promise = runPrompt(config);

		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", "a", { name: "a" });

		const result = await promise;
		expect(result).toBe("async-result");
	});

	it("rejects when handleKey throws", async () => {
		const config: PromptConfig<{ value: string }, string> = {
			render: (state) => state.value,
			handleKey: () => {
				throw new Error("handler error");
			},
			initialState: { value: "" },
			theme: defaultTheme,
		};

		const promise = runPrompt(config);

		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", "a", { name: "a" });

		await expect(promise).rejects.toThrow("handler error");
	});

	it("renders initial state immediately", async () => {
		const config: PromptConfig<{ value: string }, string> = {
			render: () => "initial frame",
			handleKey: () => ({ submit: "done" }),
			initialState: { value: "" },
			theme: defaultTheme,
		};

		const promise = runPrompt(config);

		await new Promise((r) => setTimeout(r, 10));
		expect(stderrOutput).toContain("initial frame");

		process.stdin.emit("keypress", "a", { name: "return" });
		await promise;
	});

	it("restores raw mode on cleanup", async () => {
		const config: PromptConfig<{ value: string }, string> = {
			render: () => "test",
			handleKey: () => ({ submit: "done" }),
			initialState: { value: "" },
			theme: defaultTheme,
		};

		const promise = runPrompt(config);

		await new Promise((r) => setTimeout(r, 10));
		// Raw mode should be enabled
		expect(process.stdin.isRaw).toBe(true);

		process.stdin.emit("keypress", "a", { name: "return" });
		await promise;

		// Raw mode should be restored after cleanup
		expect(process.stdin.isRaw).toBe(false);
	});

	it("erases previous frame before rendering new frame", async () => {
		let renderCount = 0;

		const config: PromptConfig<{ value: string }, string> = {
			render: (state) => {
				renderCount++;
				return `frame ${state.value}`;
			},
			handleKey: (_key, state) => {
				if (state.value === "2") return { submit: state.value };
				const next = state.value === "" ? "1" : "2";
				return { value: next };
			},
			initialState: { value: "" },
			theme: defaultTheme,
		};

		const promise = runPrompt(config);

		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", "a", { name: "a" });
		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", "b", { name: "b" });
		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", "c", { name: "c" });

		await promise;

		// ERASE_LINE sequence (ESC[2K) should appear for frame clearing
		expect(stderrOutput).toContain("\x1B[2K");
		// Should have rendered multiple frames
		expect(renderCount).toBeGreaterThanOrEqual(2);
	});

	it("handles multiline render content", async () => {
		const config: PromptConfig<{ value: string }, string> = {
			render: () => "line1\nline2\nline3",
			handleKey: () => ({ submit: "done" }),
			initialState: { value: "" },
			theme: defaultTheme,
		};

		const promise = runPrompt(config);

		await new Promise((r) => setTimeout(r, 10));
		expect(stderrOutput).toContain("line1\nline2\nline3");

		process.stdin.emit("keypress", "a", { name: "return" });
		await promise;
	});
});

// ────────────────────────────────────────────────────────────────────────────
// HandleKeyResult discrimination (via runPrompt integration)
// ────────────────────────────────────────────────────────────────────────────

describe("HandleKeyResult discrimination", () => {
	const originalIsTTY = process.stdin.isTTY;
	const originalSetRawMode = process.stdin.setRawMode;
	const originalIsRaw = process.stdin.isRaw;
	const originalStderrWrite = process.stderr.write;

	beforeEach(() => {
		process.stderr.write = (() => true) as typeof process.stderr.write;
		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			writable: true,
			configurable: true,
		});
		// biome-ignore lint/suspicious/noExplicitAny: mocking process.stdin methods for testing
		(process.stdin as any).setRawMode = (mode: boolean) => {
			Object.defineProperty(process.stdin, "isRaw", {
				value: mode,
				writable: true,
				configurable: true,
			});
			return process.stdin;
		};
	});

	afterEach(() => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: originalIsTTY,
			writable: true,
			configurable: true,
		});
		Object.defineProperty(process.stdin, "isRaw", {
			value: originalIsRaw,
			writable: true,
			configurable: true,
		});
		if (originalSetRawMode) {
			process.stdin.setRawMode = originalSetRawMode;
		}
		process.stderr.write = originalStderrWrite;
		process.stdin.removeAllListeners("keypress");
	});

	it("accumulates state updates until submit", async () => {
		const config: PromptConfig<{ count: number }, number> = {
			render: (state) => `count: ${state.count}`,
			handleKey: (_key, state) => {
				if (state.count >= 2) return { submit: state.count };
				return { count: state.count + 1 };
			},
			initialState: { count: 0 },
			theme: defaultTheme,
		};

		const promise = runPrompt(config);

		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", "a", { name: "a" });
		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", "a", { name: "a" });
		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", "a", { name: "a" });

		const result = await promise;
		expect(result).toBe(2);
	});
});
