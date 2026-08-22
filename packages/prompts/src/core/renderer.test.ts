import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { PassThrough, Writable } from "node:stream";

import { withAmbientTerminalIO } from "@crustjs/utils/terminal";

import { createPromptIO } from "../testing.ts";
import {
	assertTTY,
	NonInteractiveError,
	type PromptConfig,
	resolvePromptIO,
	runPrompt,
	submit,
	withPromptIO,
} from "./renderer.ts";
import { defaultTheme } from "./theme.ts";

describe("resolvePromptIO", () => {
	it("line-buffers ambient terminal output without changing input", () => {
		const errors: string[] = [];

		withAmbientTerminalIO({ stdout: () => {}, stderr: (text) => errors.push(text) }, () => {
			const resolved = resolvePromptIO();
			expect(resolved.input).toBe(process.stdin);

			resolved.output.write("first");
			resolved.output.write(" line\nsecond\npartial");
		});

		expect(errors).toEqual(["first line", "second"]);
	});

	it("prefers explicit and prompt-scoped output over ambient terminal output", () => {
		const errors: string[] = [];
		const explicit = new Writable({ write: (_chunk, _encoding, done) => done() });
		const scoped = new Writable({ write: (_chunk, _encoding, done) => done() });

		withAmbientTerminalIO({ stdout: () => {}, stderr: (text) => errors.push(text) }, () => {
			expect(resolvePromptIO({ output: explicit }).output).toBe(explicit);
			withPromptIO({ output: scoped }, () => {
				expect(resolvePromptIO().output).toBe(scoped);
			});
		});

		expect(errors).toEqual([]);
	});
});

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

	it("does not throw when stdin is a TTY", () => {
		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			writable: true,
			configurable: true,
		});

		expect(() => assertTTY()).not.toThrow();
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
		process.stderr.write = (chunk: string | Uint8Array) => {
			stderrOutput += chunk.toString();
			return true;
		};

		// Ensure stdin looks like a TTY with a working setRawMode
		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			writable: true,
			configurable: true,
		});

		// Mock setRawMode since the test runner stdin is not a real TTY
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

	it("uses supplied TTY streams instead of process globals", async () => {
		const input = new PassThrough() as PassThrough & {
			isTTY: boolean;
			isRaw: boolean;
			setRawMode: (mode: boolean) => PassThrough;
		};
		input.isTTY = true;
		input.isRaw = false;
		input.setRawMode = (mode) => {
			input.isRaw = mode;
			return input;
		};

		let output = "";
		const stream = new Writable({
			write(chunk, _encoding, callback) {
				output += chunk.toString();
				callback();
			},
		}) as Writable & { columns: number };
		stream.columns = 80;

		const config: PromptConfig<{ value: string }, string> = {
			render: (state) => state.value,
			handleKey: () => submit("done"),
			initialState: { value: "prompt" },
			theme: defaultTheme,
		};

		const answer = runPrompt(config, { input, output: stream });
		input.write("x");

		expect(await answer).toBe("done");
		expect(output).toContain("prompt");
	});

	it("resolves an omitted theme to defaultTheme", async () => {
		const input = new PassThrough() as PassThrough & {
			isTTY: boolean;
			isRaw: boolean;
			setRawMode: (mode: boolean) => PassThrough;
		};
		input.isTTY = true;
		input.isRaw = false;
		input.setRawMode = (mode) => {
			input.isRaw = mode;
			return input;
		};
		const stream = new Writable({
			write(_chunk, _encoding, callback) {
				callback();
			},
		}) as Writable & { columns: number };
		stream.columns = 80;

		let seenTheme: unknown;
		const answer = runPrompt<{ value: string }, string>(
			{
				render: (state, theme) => {
					seenTheme = theme;
					return state.value;
				},
				handleKey: () => submit("done"),
				initialState: { value: "prompt" },
			},
			{ input, output: stream },
		);
		input.write("x");
		expect(await answer).toBe("done");
		expect(seenTheme).toEqual(defaultTheme);
	});

	it("merges a partial theme onto defaultTheme", async () => {
		const input = new PassThrough() as PassThrough & {
			isTTY: boolean;
			isRaw: boolean;
			setRawMode: (mode: boolean) => PassThrough;
		};
		input.isTTY = true;
		input.isRaw = false;
		input.setRawMode = (mode) => {
			input.isRaw = mode;
			return input;
		};
		const stream = new Writable({
			write(_chunk, _encoding, callback) {
				callback();
			},
		}) as Writable & { columns: number };
		stream.columns = 80;

		const prefix = (t: string) => `<P ${t}>`;
		let seenTheme: { prefix: typeof prefix; message: unknown } | undefined;
		const answer = runPrompt<{ value: string }, string>(
			{
				render: (state, theme) => {
					seenTheme = theme;
					return state.value;
				},
				handleKey: () => submit("done"),
				initialState: { value: "prompt" },
				theme: { prefix },
			},
			{ input, output: stream },
		);
		input.write("x");
		expect(await answer).toBe("done");
		expect(seenTheme?.prefix).toBe(prefix); // override applied
		expect(seenTheme?.message).toBe(defaultTheme.message); // default preserved
	});

	it("disables raw mode on a fake input without isRaw", async () => {
		const input = new PassThrough() as PassThrough & {
			isTTY: boolean;
			setRawMode: (mode: boolean) => PassThrough;
		};
		input.isTTY = true;
		const rawModes: boolean[] = [];
		input.setRawMode = (mode) => {
			rawModes.push(mode);
			return input;
		};
		const output = new Writable({
			write(_chunk, _encoding, callback) {
				callback();
			},
		});
		const config: PromptConfig<undefined, string> = {
			render: () => "prompt",
			handleKey: () => submit("done"),
			initialState: undefined,
			theme: defaultTheme,
		};

		const answer = runPrompt(config, { input, output });
		input.write("x");

		await answer;
		expect(rawModes).toEqual([true, false]);
	});

	it("uses streams from withPromptIO", async () => {
		const harness = createPromptIO();
		const config: PromptConfig<{ value: string }, string> = {
			render: (state) => state.value,
			handleKey: () => submit("done"),
			initialState: { value: "prompt" },
			theme: defaultTheme,
		};

		const answer = withPromptIO(harness.io, () => runPrompt(config));
		harness.type("x");

		expect(await answer).toBe("done");
		expect(harness.screen()).toContain("prompt");
	});

	it("permits concurrent prompts on distinct input streams", async () => {
		const first = createPromptIO();
		const second = createPromptIO();
		const config: PromptConfig<undefined, string> = {
			render: () => "prompt",
			handleKey: () => submit("done"),
			initialState: undefined,
			theme: defaultTheme,
		};

		const firstAnswer = runPrompt(config, first.io);
		const secondAnswer = runPrompt(config, second.io);
		first.type("x");
		second.type("x");

		expect(await firstAnswer).toBe("done");
		expect(await secondAnswer).toBe("done");
	});

	it("rejects concurrent prompts on the same input stream", async () => {
		const harness = createPromptIO();
		const config: PromptConfig<undefined, string> = {
			render: () => "prompt",
			handleKey: () => submit("done"),
			initialState: undefined,
			theme: defaultTheme,
		};

		const answer = runPrompt(config, harness.io);
		await expect(runPrompt(config, harness.io)).rejects.toThrow("same input or output stream");
		harness.type("x");
		await answer;
	});

	it("rejects concurrent prompts sharing an output stream", async () => {
		const first = createPromptIO();
		const second = createPromptIO();
		const config: PromptConfig<undefined, string> = {
			render: () => "prompt",
			handleKey: () => submit("done"),
			initialState: undefined,
			theme: defaultTheme,
		};

		const answer = runPrompt(config, first.io);
		await expect(
			runPrompt(config, { input: second.io.input, output: first.io.output }),
		).rejects.toThrow("same input or output stream");
		first.type("x");
		await answer;
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
			handleKey: () => submit("hello"),
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
					return submit(`${state.value}!`);
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
			handleKey: () => submit("done"),
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
			handleKey: () => submit("done"),
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
			handleKey: () => submit("final"),
			initialState: { value: "test" },
			theme: defaultTheme,
			renderSubmitted: (_state, value, theme) => `${theme.success("done")} ${value}`,
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
				return submit("async-result");
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

	it("rejects with an AbortError DOMException on Ctrl+C", async () => {
		const config: PromptConfig<{ value: string }, string> = {
			render: (state) => state.value,
			handleKey: (_key, state) => state,
			initialState: { value: "" },
			theme: defaultTheme,
		};

		const promise = runPrompt(config);

		await new Promise((r) => setTimeout(r, 10));
		process.stdin.emit("keypress", undefined, { name: "c", ctrl: true });

		await expect(promise).rejects.toBeInstanceOf(DOMException);
		await expect(promise).rejects.toMatchObject({
			name: "AbortError",
		});
	});

	it("renders initial state immediately", async () => {
		const config: PromptConfig<{ value: string }, string> = {
			render: () => "initial frame",
			handleKey: () => submit("done"),
			initialState: { value: "" },
			theme: defaultTheme,
		};

		const promise = runPrompt(config);

		await new Promise((r) => setTimeout(r, 10));
		expect(stderrOutput).toContain("initial frame");

		process.stdin.emit("keypress", "a", { name: "return" });
		await promise;
	});

	it("erases previous frame before rendering new frame", async () => {
		let renderCount = 0;

		const config: PromptConfig<{ value: string }, string> = {
			render: (state) => {
				renderCount++;
				return `frame ${state.value}`;
			},
			handleKey: (_key, state) => {
				if (state.value === "2") return submit(state.value);
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

		// clearScreenDown sequence should appear for frame clearing
		expect(stderrOutput).toContain("\x1B[0J");
		// Should have rendered multiple frames
		expect(renderCount).toBeGreaterThanOrEqual(2);
	});
});
