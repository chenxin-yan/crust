import type { InvocationIO } from "@crustjs/core";

export { fuzzRoundTrip } from "./fuzz.ts";
export type { FuzzRoundTripOptions, FuzzRoundTripReport } from "./fuzz.ts";

/** Structural io shape accepted by {@link captureExecute}. */
export type CaptureIO = Partial<InvocationIO>;

/** Minimal structural surface of `execute()` invoked by {@link captureExecute}. */
export interface ExecutableApp {
	execute(options?: { argv?: string[]; io?: CaptureIO }): Promise<number>;
}

export interface CapturedExecute {
	readonly stdout: string;
	readonly stderr: string;
	/** The exit code `execute()` established (`0`, `1`, or `130` for cancellation). */
	readonly exitCode: number;
}

// Overlapping captures share process-global exit state, so only the outermost can restore it safely.
let activeExecuteCaptures = 0;
let exitCodeBeforeExecuteCaptures: typeof process.exitCode;

/**
 * Drive the terminal `execute()` path in-process: exit-code protocol,
 * Extension `onError` rendering, and cancellation (130) are all observable
 * without spawning a subprocess.
 */
export async function captureExecute(
	app: ExecutableApp,
	argv: readonly string[],
): Promise<CapturedExecute> {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	if (activeExecuteCaptures === 0) exitCodeBeforeExecuteCaptures = process.exitCode;
	activeExecuteCaptures++;
	try {
		const exitCode = await app.execute({
			argv: [...argv],
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
			stdout: stdoutLines.join("\n"),
			stderr: stderrLines.join("\n"),
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
