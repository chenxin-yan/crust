import { setTimeout } from "node:timers/promises";

import type {
	AnyCrust,
	CommandPath,
	CommandShapeAt,
	InvocationIO,
	RunInputArguments,
} from "@crustjs/core";
import { withTerminalIO } from "@crustjs/prompts";
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
	const [input] = args;
	const done = withTerminalIO(harness.io, () =>
		app
			.run(
				// SAFETY: the public Path constraint and RunInputArguments link this input
				// to App; TypeScript loses that dependent relation through AnyCrust.run.
				path as never,
				// SAFETY: validated statically by the same public dependent-generic contract.
				input as never,
				{
					stdout: () => {},
					stderr: (text) => {
						// Line-oriented like core's console.error default.
						output.write(`${text}\n`);
					},
				},
			)
			.then((outcome) => {
				if (outcome.status === "failed") throw outcome.error;
			}),
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
