import type { OutputSink } from "@crustjs/core";

import {
	type CaptureOptions,
	type CapturedExecute,
	captureText,
	type ExecutableApp,
	executeInProcess,
	isolate,
} from "./capture.ts";

export type { CaptureOptions, CapturedExecute, Environment, ExecutableApp } from "./capture.ts";
export { withEnv } from "./capture.ts";

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

/**
 * Run `argv` through `app.execute()` in-process and capture exactly what it wrote: exit codes,
 * Extension `onError` rendering, and cancellation (130, or 143 after SIGTERM) are all observable
 * without spawning a subprocess. `options.env` and `options.cwd` replace the process's for the
 * run, and captured text is plain unless `options.raw` is set. The action's streams are no
 * terminal unless `options.isTTY` is set, and its `stdin` holds `options.stdin`, else nothing.
 */
export async function captureExecute(
	app: ExecutableApp,
	argv: readonly string[],
	options?: CaptureExecuteOptions,
): Promise<CapturedExecute> {
	const stdoutChunks: Buffer[] = [];
	const stderrChunks: Buffer[] = [];
	const isTTY = options?.isTTY === true;
	const columns = isTTY ? (options.columns ?? 80) : undefined;
	const sink = (chunks: Buffer[]): OutputSink => ({
		write: (chunk) => void chunks.push(Buffer.from(chunk)),
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
	const exitCode = await isolate(options, () =>
		executeInProcess(app, {
			argv,
			io: { stdin, stdout: sink(stdoutChunks), stderr: sink(stderrChunks) },
		}),
	);
	return {
		stdout: captureText(stdoutChunks, options),
		stderr: captureText(stderrChunks, options),
		exitCode,
	};
}
