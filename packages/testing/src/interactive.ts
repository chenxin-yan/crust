import { setTimeout } from "node:timers/promises";

import type { OutputSink } from "@crustjs/core";
import { withTerminalIO } from "@crustjs/prompts";
import { createPromptIO, type NamedKey } from "@crustjs/prompts/testing";

import {
	type CaptureOptions,
	type CapturedExecute,
	captureText,
	type ExecutableApp,
	executeInProcess,
	isolate,
} from "./capture.ts";

type Letter =
	| "a"
	| "b"
	| "c"
	| "d"
	| "e"
	| "f"
	| "g"
	| "h"
	| "i"
	| "j"
	| "k"
	| "l"
	| "m"
	| "n"
	| "o"
	| "p"
	| "q"
	| "r"
	| "s"
	| "t"
	| "u"
	| "v"
	| "w"
	| "x"
	| "y"
	| "z";

/** A key {@link InteractiveRun.keys} presses: a named key or `ctrl+<letter>`. Text goes through `type()`. */
export type InteractiveKey = NamedKey | `ctrl+${Letter}`;

/** A running interactive invocation on a fake terminal. */
export interface InteractiveRun {
	/** Resolves once the screen matches `pattern`; rejects after `timeoutMs` or once the run ended without a match. */
	waitFor(pattern: RegExp, timeoutMs?: number): Promise<void>;
	/** Type `text` as the user would. */
	type(text: string): void;
	keys(...keys: InteractiveKey[]): void;
	/**
	 * Resize the terminal: the screen rewraps at `columns`, as most terminal emulators do,
	 * `stderr.columns` reports it, and the terminal emits `resize`.
	 */
	resize(columns: number, rows: number): void;
	/** Cancel the run as Ctrl-C does: a prompt, or any work that honors `signal`, ends with exit code 130. */
	cancel(): void;
	/** What the terminal shows: prompts and stderr, as plain text. */
	screen(): string;
	/** Exactly what the action wrote to `stdout` so far; plain unless `raw` is set. */
	stdout(): string;
	/** Resolves once `execute()` finished, with what it wrote and its exit code. Never rejects. */
	readonly done: Promise<CapturedExecute>;
}

/**
 * Run `argv` through `app.execute()` on a fake terminal: prompts and `stderr` draw on it and read
 * keys from it, and `stdout` is captured apart, as a pipe. `options.env` and `options.cwd`
 * replace the process's until `done` settles, and captured text is plain unless `options.raw`
 * is set. Throws for `env` or `cwd` while another run is active. `options.provide` replaces the
 * same-name Contexts for the run, wherever they are provided.
 */
export function runInteractive(
	app: ExecutableApp,
	argv: readonly string[],
	options?: CaptureOptions,
): InteractiveRun {
	const harness = createPromptIO();
	const terminal = harness.io.output;
	const controller = new AbortController();
	const stdoutChunks: Buffer[] = [];
	const stderrChunks: Buffer[] = [];
	// One decoder across stderr writes, so a character split between two writes reaches the screen whole.
	const stderrDecoder = new TextDecoder("utf-8", { ignoreBOM: true });
	const stdout: OutputSink = {
		write: (chunk) => void stdoutChunks.push(Buffer.from(chunk)),
		isTTY: false,
	};
	const stderr: OutputSink = {
		write: (chunk) => {
			stderrChunks.push(Buffer.from(chunk));
			// A string starts on a character boundary, so bytes still waiting are an incomplete character.
			terminal.write(
				typeof chunk === "string"
					? stderrDecoder.decode() + chunk
					: stderrDecoder.decode(chunk, { stream: true }),
			);
		},
		isTTY: true,
		get columns() {
			return terminal.columns;
		},
	};
	const cancel = () =>
		controller.abort(
			Object.assign(new DOMException("Cancelled", "AbortError"), { cause: "SIGINT" }),
		);
	let exitCode: number | undefined;
	const done = isolate(options, () =>
		withTerminalIO(harness.io, () =>
			executeInProcess(app, {
				argv,
				io: { stdin: harness.io.input, stdout, stderr },
				signal: controller.signal,
				...(options?.provide && { provide: options.provide }),
			}),
		),
	).then((code) => {
		const rest = stderrDecoder.decode();
		if (rest) terminal.write(rest);
		exitCode = code;
		return {
			stdout: captureText(stdoutChunks, options),
			stderr: captureText(stderrChunks, options),
			exitCode: code,
		};
	});

	return {
		waitFor: async (pattern, timeoutMs = 5000) => {
			const matcher = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
			const deadline = Date.now() + timeoutMs;
			while (!matcher.test(harness.screen())) {
				if (exitCode !== undefined) {
					// All writes land before settlement; re-test once in case the
					// loop condition ran before the final frame was written.
					if (matcher.test(harness.screen())) return;
					throw new Error(
						`waitFor(${matcher}) never matched; the application already exited with code ${exitCode}. Screen:\n${harness.screen()}`,
					);
				}
				if (Date.now() > deadline) {
					// A failing test may never await `done`; ending the run restores `env` and `cwd`.
					cancel();
					throw new Error(
						`waitFor(${matcher}) timed out after ${timeoutMs}ms. Screen:\n${harness.screen()}`,
					);
				}
				await setTimeout(1);
			}
		},
		type: (text) => harness.type(text),
		keys: (...keys) => harness.keys(...keys),
		resize: (columns, rows) => harness.resize(columns, rows),
		cancel,
		screen: () => harness.screen(),
		stdout: () => captureText(stdoutChunks, options),
		done,
	};
}
