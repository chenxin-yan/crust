import { PassThrough, Writable } from "node:stream";

import { withAmbientTerminalIO } from "@crustjs/utils/terminal";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { tick } from "../prompts/test-helpers.ts";
import { createPromptIO } from "../testing.ts";
import {
	canPrompt,
	NonInteractiveError,
	type PromptConfig,
	resolvePromptIO,
	runPrompt,
	submit,
	withTerminalIO,
} from "./renderer.ts";
import { defaultThemeFor } from "./theme.ts";

/** An output stream that records every byte a prompt writes. */
function recordingOutput(isTTY = true) {
	const recorded = {
		raw: "",
		output: Object.assign(
			new Writable({
				write(chunk, _encoding, callback) {
					recorded.raw += chunk.toString();
					callback();
				},
			}),
			{ isTTY, columns: 80 },
		),
	};
	return recorded;
}

const submitOnKey: PromptConfig<undefined, string> = {
	render: () => "prompt",
	handleKey: () => submit("done"),
	initialState: undefined,
};

describe("resolvePromptIO", () => {
	it("prefers explicit and prompt-scoped output over ambient terminal output", () => {
		const errors: string[] = [];
		const explicit = new Writable({ write: (_chunk, _encoding, done) => done() });
		const scoped = new Writable({ write: (_chunk, _encoding, done) => done() });

		withAmbientTerminalIO({ stdout: () => {}, stderr: (text) => errors.push(text) }, () => {
			expect(resolvePromptIO({ output: explicit }).output).toBe(explicit);
			withTerminalIO({ output: scoped }, () => {
				expect(resolvePromptIO().output).toBe(scoped);
			});
		});

		expect(errors).toEqual([]);
	});
});

describe("canPrompt", () => {
	const ttys = [process.stdin, process.stderr].map((stream) => [stream, stream.isTTY] as const);
	const setProcessTTY = (value: boolean) => {
		for (const [stream] of ttys) {
			Object.defineProperty(stream, "isTTY", { value, writable: true, configurable: true });
		}
	};

	afterEach(() => {
		for (const [stream, value] of ttys) {
			Object.defineProperty(stream, "isTTY", { value, writable: true, configurable: true });
		}
		vi.unstubAllEnvs();
	});

	it("needs both the resolved input and output to be TTYs", () => {
		vi.stubEnv("CI", "");
		const tty = createPromptIO().io;
		const piped = createPromptIO({ isTTY: false }).io;
		expect(canPrompt(tty)).toBe(true);
		expect(canPrompt({ input: piped.input, output: tty.output })).toBe(false);
		expect(canPrompt({ input: tty.input, output: piped.output })).toBe(false);
		withTerminalIO(piped, () => expect(canPrompt()).toBe(false));
		withTerminalIO(tty, () => expect(canPrompt()).toBe(true));
	});

	it("refuses the process terminal under CI, but not an injected one", () => {
		setProcessTTY(true);
		vi.stubEnv("CI", "");
		expect(canPrompt()).toBe(true);
		vi.stubEnv("CI", "true");
		expect(canPrompt()).toBe(false);
		withTerminalIO(createPromptIO().io, () => expect(canPrompt()).toBe(true));
	});
});

// ────────────────────────────────────────────────────────────────────────────
// runPrompt
// ────────────────────────────────────────────────────────────────────────────

describe("runPrompt — default theme color", () => {
	const originalIsTTY = process.stdout.isTTY;

	afterEach(() => {
		Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
		vi.unstubAllEnvs();
	});

	function stubColorEnvironment(stdoutIsTTY: boolean): void {
		vi.stubEnv("FORCE_COLOR", undefined);
		vi.stubEnv("NO_COLOR", undefined);
		vi.stubEnv("COLORTERM", undefined);
		vi.stubEnv("TERM", undefined);
		Object.defineProperty(process.stdout, "isTTY", { value: stdoutIsTTY, configurable: true });
	}

	it("colors the default theme on a TTY output when stdout is piped", async () => {
		stubColorEnvironment(false);
		const harness = createPromptIO();
		const recorded = recordingOutput();
		const answer = runPrompt(
			{ ...submitOnKey, render: (_state, theme) => theme.prefix("?") },
			{ input: harness.io.input, output: recorded.output },
		);
		harness.type("x");
		await answer;
		expect(recorded.raw).toContain("\x1b[36m?\x1b[39m");
	});

	// runPrompt refuses a non-TTY output, so check the theme it would resolve directly.
	it("keeps the default theme plain for a redirected output when stdout is a TTY", () => {
		stubColorEnvironment(true);
		expect(defaultThemeFor({ isTTY: false }).prefix("?")).toBe("?");
	});
});

describe("runPrompt", () => {
	it("disables raw mode on a fake input without isRaw", async () => {
		const rawModes: boolean[] = [];
		const input = Object.assign(new PassThrough(), {
			isTTY: true,
			setRawMode(mode: boolean) {
				rawModes.push(mode);
				return input;
			},
		});

		const answer = runPrompt(submitOnKey, { input, output: recordingOutput().output });
		input.write("x");

		await answer;
		expect(rawModes).toEqual([true, false]);
	});

	it("uses streams from withTerminalIO", async () => {
		const harness = createPromptIO();
		const config: PromptConfig<{ value: string }, string> = {
			render: (state) => state.value,
			handleKey: () => submit("done"),
			initialState: { value: "prompt" },
		};

		const answer = withTerminalIO(harness.io, () => runPrompt(config));
		harness.type("x");

		expect(await answer).toBe("done");
		expect(harness.screen()).toContain("prompt");
	});

	it("rejects concurrent prompts on the same input stream", async () => {
		const harness = createPromptIO();

		const answer = runPrompt(submitOnKey, harness.io);
		await expect(runPrompt(submitOnKey, harness.io)).rejects.toThrow("same input or output stream");
		harness.type("x");
		await answer;
	});

	it("rejects concurrent prompts sharing an output stream", async () => {
		const first = createPromptIO();
		const second = createPromptIO();

		const answer = runPrompt(submitOnKey, first.io);
		await expect(
			runPrompt(submitOnKey, { input: second.io.input, output: first.io.output }),
		).rejects.toThrow("same input or output stream");
		first.type("x");
		await answer;
	});

	it("rejects with NonInteractiveError when the output is not a TTY", async () => {
		const io = { input: createPromptIO().io.input, output: recordingOutput(false).output };

		await expect(runPrompt(submitOnKey, io)).rejects.toThrow(NonInteractiveError);
	});

	it("defaults output to stderr, not stdout", () => {
		expect(resolvePromptIO().output).toBe(process.stderr);
	});

	it("hides cursor on start and shows cursor on cleanup", async () => {
		const harness = createPromptIO();
		const recorded = recordingOutput();
		const promise = runPrompt(submitOnKey, { input: harness.io.input, output: recorded.output });

		await new Promise((r) => setTimeout(r, 10));
		harness.keys("return");

		await promise;

		expect(recorded.raw.startsWith("\x1B[?25l")).toBe(true);
		expect(recorded.raw.endsWith("\x1B[?25h")).toBe(true);
	});

	it("restores the cursor and raw mode on process exit and removes the exit listener", async () => {
		const harness = createPromptIO();
		const recorded = recordingOutput();
		const io = { input: harness.io.input, output: recorded.output };
		const previousHandlers = new Set(process.listeners("exit"));
		void runPrompt(submitOnKey, io);
		const added = process.listeners("exit").filter((listener) => !previousHandlers.has(listener));

		expect(added).toHaveLength(1);
		// Invoke directly — emitting a real "exit" would run the test runner's listeners.
		added[0]?.(0);
		await new Promise((r) => setTimeout(r, 0));
		expect(recorded.raw.endsWith("\x1B[?25h")).toBe(true);
		expect(harness.io.input.isRaw).toBe(false);
		expect(new Set(process.listeners("exit"))).toEqual(previousHandlers);

		// The streams were released, so a later prompt can reuse them.
		const next = runPrompt(submitOnKey, io);
		harness.keys("return");
		await next;
	});

	it("rejects when handleKey throws", async () => {
		const config: PromptConfig<{ value: string }, string> = {
			render: (state) => state.value,
			handleKey: () => {
				throw new Error("handler error");
			},
			initialState: { value: "" },
		};

		const harness = createPromptIO();
		const promise = runPrompt(config, harness.io);
		harness.type("a");

		await expect(promise).rejects.toThrow("handler error");
	});

	it("rejects and cleans up when a deferred render throws", async () => {
		const config: PromptConfig<number, string> = {
			render: (state) => {
				if (state > 0) throw new Error("render error");
				return "ready";
			},
			handleKey: (_key, state) => state + 1,
			initialState: 0,
		};

		const harness = createPromptIO();
		const promise = runPrompt(config, harness.io);
		harness.type("a");

		await expect(promise).rejects.toThrow("render error");
		expect(harness.io.input.isRaw).toBe(false);

		// Stream reservations were released: the same streams can host a new prompt.
		const reuse = runPrompt(
			{ ...config, render: () => "again", handleKey: () => submit("done") },
			harness.io,
		);
		harness.type("a");
		expect(await reuse).toBe("done");
	});

	it("ignores an in-flight handler after render failure and stream reuse", async () => {
		const pending = Promise.withResolvers<ReturnType<typeof submit<string>>>();
		const entered = Promise.withResolvers<void>();
		let submitted = false;
		const harness = createPromptIO();
		const recorded = recordingOutput();
		const io = { input: harness.io.input, output: recorded.output };
		const promise = runPrompt<number, string>(
			{
				initialState: 0,
				render: (state) => {
					if (state > 0) throw new Error("render error");
					return "old prompt";
				},
				handleKey: (_key, state) => {
					if (state === 0) return 1;
					entered.resolve();
					return pending.promise;
				},
				renderSubmitted: () => {
					submitted = true;
					return "stale submission";
				},
			},
			io,
		);
		harness.type("ab");
		await entered.promise;
		await expect(promise).rejects.toThrow("render error");
		const replacement = runPrompt(
			{ initialState: 0, render: () => "replacement", handleKey: () => submit("done") },
			io,
		);
		const before = recorded.raw;
		pending.resolve(submit("old"));
		await tick();
		const after = recorded.raw;
		harness.keys("return");
		expect(await replacement).toBe("done");
		expect(submitted).toBe(false);
		expect(after).toBe(before);
	});

	it("keeps keys typed ahead in the same chunk for the next prompt", async () => {
		const harness = createPromptIO();
		const line: PromptConfig<string, string> = {
			render: (value) => `? ${value}`,
			handleKey: (key, value) => (key.name === "return" ? submit(value) : value + key.char),
			initialState: "",
		};

		const first = runPrompt(line, harness.io);
		harness.type("one\rtwo\r");
		expect(await first).toBe("one");
		expect(await runPrompt(line, harness.io)).toBe("two");
	});

	it("drops keys typed ahead of a cancelled prompt", async () => {
		const harness = createPromptIO();
		const first = runPrompt(submitOnKey, harness.io);
		harness.type("\x03x");
		await expect(first).rejects.toMatchObject({ name: "AbortError" });

		const second = runPrompt({ ...submitOnKey, handleKey: (key) => submit(key.name) }, harness.io);
		await tick();
		harness.keys("return");
		expect(await second).toBe("return");
	});

	it("hands a Ctrl+D typed after a submit in the same chunk to the next prompt", async () => {
		const harness = createPromptIO();
		const line: PromptConfig<string, string> = {
			render: (value) => `? ${value}`,
			handleKey: (key, value) => (key.name === "return" ? submit(value) : value + key.char),
			initialState: "",
		};

		const first = runPrompt(line, harness.io);
		harness.type("one\r\x04");
		expect(await first).toBe("one");
		await expect(runPrompt(line, harness.io)).rejects.toMatchObject({ name: "AbortError" });
	});

	it("cancels the next prompt once when Ctrl+C and Ctrl+D follow a submit in the same chunk", async () => {
		const harness = createPromptIO();
		const first = runPrompt({ ...submitOnKey, renderSubmitted: () => "first" }, harness.io);
		harness.type("\r\x03\x04");
		await first;
		const second = runPrompt({ ...submitOnKey, renderCancelled: () => "x second" }, harness.io);

		await expect(second).rejects.toMatchObject({ name: "AbortError" });
		expect(harness.screen()).toBe("first\nx second");
	});

	it("cancels on a Ctrl+C typed in the same chunk as a key whose handler never settles", async () => {
		const harness = createPromptIO();
		const promise = runPrompt(
			{ ...submitOnKey, handleKey: () => new Promise<undefined>(() => {}) },
			harness.io,
		);
		harness.type("a\x03");

		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
	});

	it("cancels at once on Ctrl+D while a key handler is still running", async () => {
		const harness = createPromptIO();
		const pending = Promise.withResolvers<undefined>();
		const promise = runPrompt({ ...submitOnKey, handleKey: () => pending.promise }, harness.io);
		harness.type("ab");
		await tick();
		harness.keys("ctrl+d");

		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		pending.resolve(undefined);
	});

	it("counts the frame's rows at the new width after a resize", async () => {
		const recorded = recordingOutput();
		const harness = createPromptIO();
		const promise = runPrompt(
			{ ...submitOnKey, render: () => `? ${"x".repeat(98)}` },
			{ input: harness.io.input, output: recorded.output },
		);
		recorded.raw = "";

		// 100 columns wrap to 2 rows at 80 and to 3 at 40: the redraw climbs 2 rows, not 1.
		recorded.output.columns = 40;
		recorded.output.emit("resize");
		await tick();
		expect(recorded.raw).toContain("\x1B[2A");

		harness.keys("return");
		await promise;
	});

	it("counts a wide character that does not fit the last column as starting a new row", async () => {
		const harness = createPromptIO();
		const promise = runPrompt({ ...submitOnKey, render: () => "界界界" }, harness.io);

		// At 3 columns each two-column character takes a row of its own: 3 rows, not 6 / 3.
		harness.resize(3, 24);
		await tick();
		expect(harness.screen()).toBe("界\n界\n界");

		harness.keys("return");
		await promise;
	});

	it("counts an escape sequence's bytes as no columns when wrapping", async () => {
		const harness = createPromptIO();
		let written = "";
		const output = {
			isTTY: true,
			columns: 4,
			write: (chunk: string) => ((written += chunk), true),
			on: () => output,
		};
		// A DCS sequence, then the two visible columns "OK": one row on a 4-column output.
		const promise = runPrompt(
			{ ...submitOnKey, render: () => "\x1bP$qm\x1b\\OK", renderSubmitted: () => "OK" },
			{ input: harness.io.input, output },
		);
		await tick();
		written = "";
		harness.keys("return");
		await promise;

		expect(written).not.toContain("\x1b[1A");
	});

	it("finishes on an output with on() but no removeListener(), and can run again", async () => {
		const harness = createPromptIO();
		const output = { isTTY: true, columns: 80, write: () => true, on: () => output };
		for (let run = 0; run < 2; run++) {
			const promise = runPrompt(submitOnKey, { input: harness.io.input, output });
			harness.keys("return");
			expect(await promise).toBe("done");
			expect(harness.io.input.isRaw).toBe(false);
		}
	});

	it.each(["ctrl+c", "ctrl+d"] as const)("draws the cancelled state on %s", async (key) => {
		const harness = createPromptIO();
		const promise = runPrompt({ ...submitOnKey, renderCancelled: () => "✗ cancelled" }, harness.io);
		harness.keys(key);

		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		expect(harness.screen()).toBe("✗ cancelled");
		expect(harness.io.input.isRaw).toBe(false);
	});

	it("draws the cancelled state when the signal aborts", async () => {
		const harness = createPromptIO();
		const controller = new AbortController();
		const promise = runPrompt(
			{ ...submitOnKey, renderCancelled: () => "✗ cancelled" },
			{ ...harness.io, signal: controller.signal },
		);
		controller.abort(new Error("stop"));

		await expect(promise).rejects.toThrow("stop");
		expect(harness.screen()).toBe("✗ cancelled");
	});

	it("rejects with an AbortError DOMException on Ctrl+C", async () => {
		const config: PromptConfig<{ value: string }, string> = {
			render: (state) => state.value,
			handleKey: (_key, state) => state,
			initialState: { value: "" },
		};

		const harness = createPromptIO();
		const promise = runPrompt(config, harness.io);
		harness.keys("ctrl+c");

		await expect(promise).rejects.toBeInstanceOf(DOMException);
		await expect(promise).rejects.toMatchObject({
			name: "AbortError",
		});
	});

	it("restores the terminal and rejects with the reason when the scope's signal aborts", async () => {
		const harness = createPromptIO();
		const recorded = recordingOutput();
		const io = { input: harness.io.input, output: recorded.output };
		const controller = new AbortController();
		const exitListeners = process.listenerCount("exit");
		const promise = withTerminalIO({ signal: controller.signal }, () => runPrompt(submitOnKey, io));
		const reason = new DOMException("Terminated by SIGTERM.", "AbortError");
		controller.abort(reason);

		await expect(promise).rejects.toBe(reason);
		expect(recorded.raw.endsWith("\n\x1B[?25h")).toBe(true);
		expect(harness.io.input.isRaw).toBe(false);
		expect(harness.io.input.listenerCount("keypress")).toBe(0);
		expect(process.listenerCount("exit")).toBe(exitListeners);
		// The streams were released, so a later prompt can reuse them.
		const next = runPrompt(submitOnKey, io);
		harness.keys("return");
		expect(await next).toBe("done");
	});

	it("rejects without drawing when an explicit signal already aborted", async () => {
		const harness = createPromptIO();
		const reason = new Error("deadline");
		const promise = runPrompt(submitOnKey, { ...harness.io, signal: AbortSignal.abort(reason) });

		await expect(promise).rejects.toBe(reason);
		expect(harness.screen()).toBe("");
	});

	it("erases every wrapped row of a frame wider than the terminal", async () => {
		const config: PromptConfig<{ long: boolean }, string> = {
			render: (state) => (state.long ? `? ${"x".repeat(100)}` : "? short"),
			handleKey: (key, state) => (key.name === "return" ? submit("done") : { long: !state.long }),
			initialState: { long: true },
		};

		const harness = createPromptIO();
		harness.io.output.write("above\n");
		const promise = runPrompt(config, harness.io);
		expect(harness.screen()).toBe(`above\n? ${"x".repeat(78)}\n${"x".repeat(22)}`);

		harness.type("a");
		await tick();
		expect(harness.screen()).toBe("above\n? short");

		harness.keys("return");
		await promise;
	});
});
