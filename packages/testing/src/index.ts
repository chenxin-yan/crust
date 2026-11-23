import type { ExecuteOptions, OutputSink } from "@crustjs/core";

import { type CaptureOptions, captureText, joinChunks } from "./capture.ts";

export type { CaptureOptions } from "./capture.ts";

/** Minimal structural surface of `execute()` invoked by {@link captureExecute}. */
export interface ExecutableApp {
	// Core's own options type: a copy of its members drifts, and stops matching under
	// `exactOptionalPropertyTypes`.
	execute(options?: ExecuteOptions): Promise<number>;
}

/** {@link CaptureOptions} plus the streams the action sees. */
export type CaptureExecuteOptions = CaptureOptions & {
	/**
	 * What the action reads from `stdin`, which then reports no terminal, as a pipe does.
	 * Default: no input.
	 */
	stdin?: string | Uint8Array | undefined;
} & (
		| {
				/** Make `stdout` and `stderr`, and `stdin` without the `stdin` option, report a terminal. */
				isTTY: true;
				/** The width `stdout.columns` and `stderr.columns` report. Default: 80. */
				columns?: number | undefined;
		  }
		| { isTTY?: false | undefined; columns?: undefined }
	);

export interface CapturedExecute {
	readonly stdout: string;
	readonly stderr: string;
	/**
	 * The exit code `execute()` resolved to: `0` or the action's `exitCode(n)`, `1` or a thrown
	 * value's non-zero integer `exitCode`, `2` for a usage error, `130` for cancellation, `143` after `SIGTERM`.
	 */
	readonly exitCode: number;
}

// Overlapping captures share process-global exit state, so only the outermost can restore it safely.
let activeExecuteCaptures = 0;
let exitCodeBeforeExecuteCaptures: typeof process.exitCode;

/**
 * Drive the terminal `execute()` path in-process: exit-code protocol,
 * Extension `onError` rendering, and cancellation (130, or 143 after SIGTERM) are all observable
 * without spawning a subprocess. Flags' `env` fallbacks read `options.env` when given, and
 * captured text is plain unless `options.raw` is set. The action's streams are no terminal
 * unless `options.isTTY` is set, and its `stdin` holds `options.stdin`, else nothing.
 */
export async function captureExecute(
	app: ExecutableApp,
	argv: readonly string[],
	options?: CaptureExecuteOptions,
): Promise<CapturedExecute> {
	const stdoutChunks: (string | Uint8Array)[] = [];
	const stderrChunks: (string | Uint8Array)[] = [];
	const isTTY = options?.isTTY === true;
	const columns = isTTY ? (options.columns ?? 80) : undefined;
	const sink = (chunks: (string | Uint8Array)[]): OutputSink => ({
		write: (chunk) => void chunks.push(chunk),
		isTTY,
		columns,
	});
	const input = options?.stdin;
	const stdin = Object.assign(
		(async function* () {
			if (input !== undefined) yield input;
		})(),
		{ isTTY: isTTY && input === undefined },
	);
	if (activeExecuteCaptures === 0) exitCodeBeforeExecuteCaptures = process.exitCode;
	activeExecuteCaptures++;
	try {
		const exitCode = await app.execute({
			argv,
			...(options?.env !== undefined && { env: options.env }),
			io: { stdin, stdout: sink(stdoutChunks), stderr: sink(stderrChunks) },
		});
		return {
			stdout: captureText(joinChunks(stdoutChunks), options),
			stderr: captureText(joinChunks(stderrChunks), options),
			exitCode,
		};
	} finally {
		activeExecuteCaptures--;
		if (activeExecuteCaptures === 0) {
			// Bun cannot clear a numeric exitCode back to undefined, so zero is the equivalent success state.
			process.exitCode = exitCodeBeforeExecuteCaptures ?? 0;
		}
	}
}
