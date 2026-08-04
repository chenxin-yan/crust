import { withPromptIO } from "@crustjs/prompts";
import { createPromptIO } from "@crustjs/prompts/testing";

/** Minimal structural surface invoked by the testing helpers. */
export interface RunnableApp {
	run(
		argv: readonly string[],
		io?: {
			stdout?: (text: string) => void;
			stderr?: (text: string) => void;
		},
	): Promise<void>;
}

export interface CapturedRun {
	readonly stdout: string;
	readonly stderr: string;
	readonly error?: unknown;
}

/** Run an application and capture its text output without throwing invocation errors. */
export async function captureRun(app: RunnableApp, argv: readonly string[]): Promise<CapturedRun> {
	// Each io callback invocation is one line in a real terminal (core's
	// defaults are console.log/console.error), so join captured calls with "\n".
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	let failed = false;
	let error: unknown;

	try {
		await app.run(argv, {
			stdout: (text) => {
				stdoutLines.push(text);
			},
			stderr: (text) => {
				stderrLines.push(text);
			},
		});
	} catch (caught) {
		failed = true;
		error = caught;
	}

	const stdout = stdoutLines.join("\n");
	const stderr = stderrLines.join("\n");
	return failed ? { stdout, stderr, error } : { stdout, stderr };
}

/** Minimal structural surface of `execute()` invoked by {@link captureExecute}. */
export interface ExecutableApp {
	execute(options?: {
		argv?: string[];
		io?: {
			stdout?: (text: string) => void;
			stderr?: (text: string) => void;
		};
	}): Promise<void>;
}

export interface CapturedExecute {
	readonly stdout: string;
	readonly stderr: string;
	/** The exit code `execute()` established (`0`, `1`, or `130` for cancellation). */
	readonly exitCode: number;
}

// `execute()` reports status only through the process-global
// `process.exitCode`, so overlapping captures would read or restore each
// other's state. Chain every capture behind the previous one so the whole
// save/reset/execute/read/restore sequence runs exclusively.
let captureExecuteChain: Promise<unknown> = Promise.resolve();

/**
 * Drive the terminal `execute()` path in-process: exit-code protocol,
 * Extension `onError` rendering, and cancellation (130) are all observable
 * without spawning a subprocess. `process.exitCode` is restored afterwards.
 * Concurrent calls are serialized because the exit-code protocol is
 * process-global.
 */
export function captureExecute(
	app: ExecutableApp,
	argv: readonly string[],
): Promise<CapturedExecute> {
	const run = captureExecuteChain.then(() => captureExecuteExclusive(app, argv));
	// A rejected capture (e.g. `throwOnError`) must not poison later captures.
	captureExecuteChain = run.catch(() => {});
	return run;
}

async function captureExecuteExclusive(
	app: ExecutableApp,
	argv: readonly string[],
): Promise<CapturedExecute> {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	const savedExitCode = process.exitCode;
	process.exitCode = 0;

	try {
		await app.execute({
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
			exitCode: Number(process.exitCode ?? 0),
		};
	} finally {
		process.exitCode = savedExitCode;
	}
}

export interface InteractiveRun {
	waitFor(pattern: RegExp, timeoutMs?: number): Promise<void>;
	type(text: string): void;
	keys(...namedKeys: string[]): void;
	screen(): string;
	readonly done: Promise<void>;
}

/** Run an application with fake terminal streams for its prompts and stderr output. */
export function interactiveRun(app: RunnableApp, argv: readonly string[]): InteractiveRun {
	const harness = createPromptIO();
	const output = harness.io.output!;
	const done = withPromptIO(harness.io, () =>
		app.run(argv, {
			stdout: () => {},
			stderr: (text) => {
				// Line-oriented like core's console.error default.
				output.write(`${text}\n`);
			},
		}),
	);

	// Observe settlement so waitFor can stop polling; the handler also keeps an
	// unawaited rejected `done` from surfacing as an unhandled rejection.
	let settled = false;
	let failed = false;
	let failure: unknown;
	done.then(
		() => {
			settled = true;
		},
		(caught: unknown) => {
			settled = true;
			failed = true;
			failure = caught;
		},
	);

	return {
		waitFor: async (pattern, timeoutMs = 5000) => {
			const matcher = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
			const deadline = Date.now() + timeoutMs;
			while (!matcher.test(harness.screen())) {
				if (settled) {
					// All writes land before settlement; re-test once in case the
					// loop condition ran before the final frame was written.
					if (matcher.test(harness.screen())) return;
					if (failed) throw failure;
					throw new Error(
						`waitFor(${matcher}) never matched; the application already completed. Screen:\n${harness.screen()}`,
					);
				}
				if (Date.now() > deadline) {
					throw new Error(
						`waitFor(${matcher}) timed out after ${timeoutMs}ms. Screen:\n${harness.screen()}`,
					);
				}
				await Bun.sleep(1);
			}
		},
		type: (text) => harness.type(text),
		keys: (...namedKeys) => harness.keys(...namedKeys),
		screen: () => harness.screen(),
		done,
	};
}
