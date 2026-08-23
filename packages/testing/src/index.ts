import { setTimeout } from "node:timers/promises";

import type {
	AnyCrust,
	CommandPath,
	CommandShapeAt,
	ExtensionId,
	InvocationIO,
	RunInputArguments,
	RunOutcome,
} from "@crustjs/core";
import { type ProgressSink, withProgressSink } from "@crustjs/progress";
import { withPromptIO } from "@crustjs/prompts";
import { createPromptIO, type Key } from "@crustjs/prompts/testing";

/** Structural io shape shared by `run()` and `execute()` captures. */
export type CaptureIO = Partial<InvocationIO>;

// Indexed access into the `_types` phantom instead of conditionally inferring
// all nine `Crust` generics — the conditional forced a full structural match
// (and union distribution) per helper call.
type AppTree<App extends AnyCrust> = App["_types"]["tree"];
type ShapeAtPath<App extends AnyCrust, Path extends CommandPath<AppTree<App>>> = CommandShapeAt<
	App["_types"]["shape"],
	Path
>;

/**
 * Result of {@link captureRun}. Completed runs carry the selected action's
 * typed result, finished runs name the finishing Extension, and failed runs
 * carry the thrown value. Narrow with the `status` discriminant.
 */
export type CapturedRun<Result = unknown> = {
	readonly stdout: string;
	readonly stderr: string;
} & (
	| { readonly status: "completed"; readonly result: Result }
	| { readonly status: "finished"; readonly by: ExtensionId }
	| { readonly status: "failed"; readonly error: unknown }
);

/** Run an application and capture its text output without throwing invocation errors. */
export async function captureRun<
	App extends AnyCrust,
	const Path extends CommandPath<AppTree<App>>,
>(
	app: App,
	path: Path,
	...args: RunInputArguments<ShapeAtPath<App, Path>>
): Promise<CapturedRun<ShapeAtPath<App, Path>["result"]>> {
	// Each io callback invocation is one line in a real terminal (core's
	// defaults are console.log/console.error), so join captured calls with "\n".
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];

	try {
		const [input] = args;
		// The selected path and input are linked by ShapeAt, while run's generic
		// implementation signature cannot express that link through this wrapper.
		// SAFETY: Path was constrained by CommandPath above; erasure bridges the generic wrapper.
		const erasedPath = path as never;
		// SAFETY: input was constrained for Path by RunInputArguments above.
		const outcome = (await app.run(erasedPath, input as never, {
			stdout: (text) => {
				stdoutLines.push(text);
			},
			stderr: (text) => {
				stderrLines.push(text);
			},
		})) as RunOutcome<ShapeAtPath<App, Path>["result"]>;
		return { stdout: stdoutLines.join("\n"), stderr: stderrLines.join("\n"), ...outcome };
	} catch (error) {
		// Output written before the failure is retained.
		return {
			stdout: stdoutLines.join("\n"),
			stderr: stderrLines.join("\n"),
			status: "failed",
			error,
		};
	}
}

/** Minimal structural surface of `execute()` invoked by {@link captureExecute}. */
export interface ExecutableApp {
	execute(options?: { argv?: string[]; io?: CaptureIO }): Promise<void>;
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
			// oxlint-disable-next-line typescript/no-unnecessary-type-conversion -- execute() may set a numeric string; CapturedExecute guarantees a number
			exitCode: Number(process.exitCode ?? 0),
		};
	} finally {
		process.exitCode = savedExitCode;
	}
}

export interface InteractiveRun {
	waitFor(pattern: RegExp, timeoutMs?: number): Promise<void>;
	type(text: string): void;
	keys(...namedKeys: Key[]): void;
	screen(): string;
	readonly done: Promise<void>;
}

/** Run an application with fake terminal streams for its prompts and stderr output. */
export function runInteractive<App extends AnyCrust, const Path extends CommandPath<AppTree<App>>>(
	app: App,
	path: Path,
	...args: RunInputArguments<ShapeAtPath<App, Path>>
): InteractiveRun {
	const harness = createPromptIO();
	const output = harness.io.output;
	// Spinners and progress indicators render onto the same fake terminal as
	// prompts, so waitFor()/screen() observe them too.
	const sink: ProgressSink = {
		isTTY: true,
		write: (text) => {
			output.write(text);
		},
	};
	const [input] = args;
	// SAFETY: Path and input were constrained together by RunInputArguments above.
	const done = withProgressSink(sink, () =>
		withPromptIO(harness.io, () =>
			app
				.run(path as never, input as never, {
					stdout: () => {},
					stderr: (text) => {
						// Line-oriented like core's console.error default.
						output.write(`${text}\n`);
					},
				})
				.then(() => {}),
		),
	);

	// Observe settlement so waitFor can stop polling; the action also keeps an
	// unawaited rejected `done` from surfacing as an unhandled rejection.
	let settled = false;
	let failed = false;
	let failure: unknown;
	const recordFailure = <Failure>(caught: Failure): void => {
		settled = true;
		failed = true;
		failure = caught;
	};
	done.then(() => {
		settled = true;
	}, recordFailure);

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
				await setTimeout(1);
			}
		},
		type: (text) => harness.type(text),
		keys: (...namedKeys) => harness.keys(...namedKeys),
		screen: () => harness.screen(),
		done,
	};
}
