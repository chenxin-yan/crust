import { setTimeout } from "node:timers/promises";

import type {
	AnyCrust,
	CommandPath,
	CommandShapeAt,
	RunInputArguments,
	RunOutcome,
	ShapeRunOutcome,
} from "@crustjs/core";
import { withTerminalIO } from "@crustjs/prompts";
import { createPromptIO, type Key } from "@crustjs/prompts/testing";

import { type CaptureOptions, captureText } from "./capture.ts";

/**
 * A running interactive invocation. `Outcome` is the `run()` outcome of the selected command;
 * `done` resolves with its `completed` or `handled` branch.
 */
export interface InteractiveRun<Outcome = RunOutcome<unknown, readonly unknown[] | undefined>> {
	waitFor(pattern: RegExp, timeoutMs?: number): Promise<void>;
	type(text: string): void;
	keys(...namedKeys: Key[]): void;
	screen(): string;
	/**
	 * Text passed to the action's `stdout()` so far, joined with newlines like `RunOutcome.stdout`;
	 * plain unless `raw` is set.
	 */
	stdout(): string;
	/**
	 * Settles after cleanup like `app.run()`: resolves with the typed `result` (or the handling
	 * Extension) and the captured `stdout` and `stderr` (plain unless `raw` is set), or rejects
	 * with a failed outcome's `error`.
	 */
	readonly done: Promise<Exclude<Outcome, { readonly status: "failed" }>>;
}

/**
 * Run an application with fake terminal streams for its prompts and stderr output. Flags' `env`
 * fallbacks read `options.env` when given, and captured text is plain unless `options.raw` is set.
 */
export function runInteractive<
	App extends AnyCrust,
	const Path extends CommandPath<App["_types"]["tree"]>,
>(
	app: App,
	path: Path,
	...args: readonly [
		...RunInputArguments<CommandShapeAt<App["_types"]["shape"], Path>>,
		options?: CaptureOptions,
	]
): InteractiveRun<ShapeRunOutcome<CommandShapeAt<App["_types"]["shape"], Path>>> {
	const harness = createPromptIO();
	const output = harness.io.output;
	const input = args[0];
	// SAFETY: the rest tuple puts CaptureOptions second; its generic input element hides that here.
	const options = args[1] as CaptureOptions | undefined;
	const stdoutLines: string[] = [];
	const done = withTerminalIO(harness.io, () =>
		// SAFETY: Path + RunInputArguments constrain input to App; AnyCrust.run erases the link.
		app
			.run(path as never, input as never, {
				env: options?.env,
				stdout: (text) => {
					stdoutLines.push(text);
				},
				stderr: (text) => {
					// Line-oriented like core's default stderr.
					output.write(`${text}\n`);
				},
			})
			.then((outcome) => {
				if (outcome.status === "failed") throw outcome.error;
				const captured = {
					...outcome,
					stdout: captureText([outcome.stdout], options),
					stderr: captureText([outcome.stderr], options),
				};
				// SAFETY: the same Path + input link that types `app.run()` selects this outcome.
				return captured as Exclude<
					ShapeRunOutcome<CommandShapeAt<App["_types"]["shape"], Path>>,
					{ readonly status: "failed" }
				>;
			}),
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
		(cause: unknown) => {
			settled = true;
			failed = true;
			failure = cause;
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
				await setTimeout(1);
			}
		},
		type: (text) => harness.type(text),
		keys: (...namedKeys) => harness.keys(...namedKeys),
		screen: () => harness.screen(),
		stdout: () => captureText(stdoutLines, options),
		done,
	};
}
