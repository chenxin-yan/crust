import type { ExecuteOptions, InvocationIO } from "@crustjs/core";

import { type CaptureOptions, captureText } from "./capture.ts";

export type { CaptureOptions } from "./capture.ts";

/** Structural io shape accepted by {@link captureExecute}. */
export type CaptureIO = Partial<InvocationIO>;

/** Minimal structural surface of `execute()` invoked by {@link captureExecute}. */
export interface ExecutableApp {
	// Core's own options type: a copy of its members drifts, and stops matching under
	// `exactOptionalPropertyTypes`.
	execute(options?: ExecuteOptions): Promise<number>;
}

export interface CapturedExecute {
	readonly stdout: string;
	readonly stderr: string;
	/**
	 * The exit code `execute()` resolved to: `0` or the action's `exitCode(n)`, `1` or a thrown
	 * value's integer `exitCode`, `2` for a usage error, `130` for cancellation, `143` after `SIGTERM`.
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
 * captured text is plain unless `options.raw` is set.
 */
export async function captureExecute(
	app: ExecutableApp,
	argv: readonly string[],
	options?: CaptureOptions,
): Promise<CapturedExecute> {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	if (activeExecuteCaptures === 0) exitCodeBeforeExecuteCaptures = process.exitCode;
	activeExecuteCaptures++;
	try {
		const exitCode = await app.execute({
			argv,
			...(options?.env !== undefined && { env: options.env }),
			io: {
				stdout: (text) => {
					stdoutLines.push(text);
				},
				stderr: (text) => {
					stderrLines.push(text);
				},
			},
		});
		return {
			stdout: captureText(stdoutLines, options),
			stderr: captureText(stderrLines, options),
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
