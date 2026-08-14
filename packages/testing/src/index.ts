import type {
	CommandPath,
	CommandShape,
	CommandShapeAt,
	Crust,
	InvocationIO,
	RunInputArguments,
} from "@crustjs/core";
import { type ProgressSink, withProgressSink } from "@crustjs/progress";
import { withPromptIO } from "@crustjs/prompts";
import { createPromptIO, type Key } from "@crustjs/prompts/testing";

/** Structural io shape shared by `run()` and `execute()` captures. */
export type CaptureIO = Partial<InvocationIO>;

type TypedApp = Crust<any, any, any, any, any, any>;
type AppTypes<App extends TypedApp> =
	App extends Crust<infer Flags, infer Args, any, any, any, infer Tree>
		? { shape: CommandShape<Args, Flags, Tree>; tree: Tree }
		: never;
type AppTree<App extends TypedApp> = AppTypes<App>["tree"];
type ShapeAtPath<App extends TypedApp, Path extends CommandPath<AppTree<App>>> = CommandShapeAt<
	AppTypes<App>["shape"],
	Path
>;

export interface CapturedRun {
	readonly stdout: string;
	readonly stderr: string;
	readonly error?: unknown;
}

/** Run an application and capture its text output without throwing invocation errors. */
export async function captureRun<
	App extends TypedApp,
	const Path extends CommandPath<AppTree<App>>,
>(app: App, path: Path, ...args: RunInputArguments<ShapeAtPath<App, Path>>): Promise<CapturedRun> {
	// Each io callback invocation is one line in a real terminal (core's
	// defaults are console.log/console.error), so join captured calls with "\n".
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	let failed = false;
	let error: unknown;

	try {
		const [input] = args;
		await app.run(path as never, input as never, {
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
export function runInteractive<App extends TypedApp, const Path extends CommandPath<AppTree<App>>>(
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
	const done = withProgressSink(sink, () =>
		withPromptIO(harness.io, () =>
			app.run(path as never, input as never, {
				stdout: () => {},
				stderr: (text) => {
					// Line-oriented like core's console.error default.
					output.write(`${text}\n`);
				},
			}),
		),
	);

	// Observe settlement so waitFor can stop polling; the action also keeps an
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
