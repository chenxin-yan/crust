import type { InvocationIO } from "@crustjs/core";
import { type ProgressSink, withProgressSink } from "@crustjs/progress";
import { withPromptIO } from "@crustjs/prompts";
import { createPromptIO, type Key } from "@crustjs/prompts/testing";

/** Structural io shape shared by `run()` and `execute()` captures. */
export type CaptureIO = Partial<InvocationIO>;

/** Minimal structural surface invoked by the testing helpers. */
export interface RunnableApp {
	run(argv: readonly string[], io?: CaptureIO): Promise<void>;
}

/**
 * Argv literals a Crust app's static type knows about — command spellings and
 * dashed flag spellings, including those defined inside `defineCommand`
 * recipes — extracted from the `_types.hints` phantom. Apps without the
 * phantom resolve to `never`.
 */
export type ArgvHints<App> = App extends {
	readonly _types: { hints(hint: infer H extends string): void };
}
	? H
	: never;

type FlagHints<H extends string> = Extract<H, `-${string}`>;
type LongFlags<H extends string> = Extract<H, `--${string}`>;
type ShortFlags<H extends string> = Exclude<FlagHints<H>, `--${string}`>;
type CommandHints<H extends string> = Exclude<H, `-${string}`>;

type LegalDashToken<H extends string> =
	| "-"
	| FlagHints<H>
	| `${LongFlags<H>}=${string}`
	| (LongFlags<H> extends `--${infer Name}` ? `--no-${Name}` : never)
	| `${ShortFlags<H>}${string}`
	| "--help"
	| "-h"
	| "--version";

/**
 * Compile-time-only brand carrying an argv validation message. An invalid
 * token's expected type is `Token & ArgvError<...>`: intersecting the string
 * literal with an object (rather than another string literal) keeps the
 * intersection from collapsing to `never`, so tsc prints the message instead
 * of `Type 'string' is not assignable to type 'never'`.
 */
type ArgvError<Message extends string> = { readonly [Brand in Message]: never };

type ValidateToken<T extends string, H extends string> = string extends T
	? T
	: T extends `-${string}`
		? T extends LegalDashToken<H>
			? T
			: ArgvError<`Unknown flag "${T}"`>
		: T;

/**
 * Whether the root command declares positional args (`.args()` narrows
 * `_types.args` to a non-empty tuple). When it does, Core routes an unmatched
 * first token to the root action as a positional, so it must not be rejected
 * as an unknown command.
 *
 * This is a deliberate proxy for Core's actual routing rule ("root has
 * `run()`"), which is invisible in types — `.action()` does not change
 * `Crust`'s type parameters. The proxy is stricter than runtime in one case:
 * a root action *without* declared args silently ignores extra positionals,
 * and we still reject those — passing a positional such a root never reads
 * is almost certainly a test bug.
 */
type RootHasPositionals<App> = App extends {
	readonly _types: { args: infer RA extends readonly unknown[] };
}
	? RA extends readonly [unknown, ...unknown[]]
		? true
		: false
	: false;

type ValidateArgv<
	A extends readonly string[],
	H extends string,
	RootPositional extends boolean,
	First extends boolean = true,
> = [H] extends [never]
	? A
	: number extends A["length"]
		? A
		: A extends readonly [infer Token extends string, ...infer Rest extends readonly string[]]
			? Token extends "--"
				? A
				: readonly [
						First extends true
							? Token extends `-${string}`
								? ValidateToken<Token, H>
								: [CommandHints<H>] extends [never]
									? Token
									: Token extends CommandHints<H>
										? Token
										: RootPositional extends true
											? Token
											: ArgvError<`Unknown command "${Token}"`>
							: ValidateToken<Token, H>,
						...ValidateArgv<Rest, H, RootPositional, false>,
					]
			: A;

export interface CapturedRun {
	readonly stdout: string;
	readonly stderr: string;
	readonly error?: unknown;
}

/** Run an application and capture its text output without throwing invocation errors. */
export async function captureRun<App extends RunnableApp, const A extends readonly string[]>(
	app: App,
	argv: A & ValidateArgv<A, ArgvHints<App>, RootHasPositionals<App>>,
): Promise<CapturedRun> {
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
export function captureExecute<App extends ExecutableApp, const A extends readonly string[]>(
	app: App,
	argv: A & ValidateArgv<A, ArgvHints<App>, RootHasPositionals<App>>,
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
export function runInteractive<App extends RunnableApp, const A extends readonly string[]>(
	app: App,
	argv: A & ValidateArgv<A, ArgvHints<App>, RootHasPositionals<App>>,
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
	const done = withProgressSink(sink, () =>
		withPromptIO(harness.io, () =>
			app.run(argv, {
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
