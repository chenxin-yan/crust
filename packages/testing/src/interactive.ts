import { setTimeout } from "node:timers/promises";

import type { AnyCrust, CommandPath, CommandShapeAt, RunInputArguments } from "@crustjs/core";
import { withTerminalIO } from "@crustjs/prompts";
import { createPromptIO, type Key } from "@crustjs/prompts/testing";

export interface InteractiveRun {
	waitFor(pattern: RegExp, timeoutMs?: number): Promise<void>;
	type(text: string): void;
	keys(...namedKeys: Key[]): void;
	screen(): string;
	readonly done: Promise<void>;
}

/** Run an application with fake terminal streams for its prompts and stderr output. */
export function runInteractive<
	App extends AnyCrust,
	const Path extends CommandPath<App["_types"]["tree"]>,
>(
	app: App,
	path: Path,
	...args: RunInputArguments<CommandShapeAt<App["_types"]["shape"], Path>>
): InteractiveRun {
	const harness = createPromptIO();
	const output = harness.io.output;
	const [input] = args;
	const done = withTerminalIO(harness.io, () =>
		// SAFETY: Path + RunInputArguments constrain input to App; AnyCrust.run erases the link.
		app
			.run(path as never, input as never, {
				stdout: () => {},
				stderr: (text) => {
					// Line-oriented like core's console.error default.
					output.write(`${text}\n`);
				},
			})
			.then((outcome) => {
				if (outcome.status === "failed") throw outcome.error;
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
		done,
	};
}
