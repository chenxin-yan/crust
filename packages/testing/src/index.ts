import type { Crust } from "@crustjs/core";
import { withPromptIO } from "@crustjs/prompts";
import { createPromptIO } from "@crustjs/prompts/testing";

export interface CapturedRun {
	readonly stdout: string;
	readonly stderr: string;
	readonly error?: unknown;
}

/** Run an application and capture its text output without throwing invocation errors. */
export async function captureRun(app: Crust, argv: readonly string[]): Promise<CapturedRun> {
	let stdout = "";
	let stderr = "";
	let failed = false;
	let error: unknown;

	try {
		await app.run(argv, {
			stdout: (text) => {
				stdout += text;
			},
			stderr: (text) => {
				stderr += text;
			},
		});
	} catch (caught) {
		failed = true;
		error = caught;
	}

	return failed ? { stdout, stderr, error } : { stdout, stderr };
}

export interface InteractiveRun {
	waitFor(pattern: RegExp): Promise<void>;
	type(text: string): void;
	keys(...namedKeys: string[]): void;
	screen(): string;
	readonly done: Promise<void>;
}

/** Run an application with fake terminal streams for its prompts and stderr output. */
export function interactiveRun(app: Crust, argv: readonly string[]): InteractiveRun {
	const harness = createPromptIO();
	const output = harness.io.output!;
	const done = withPromptIO(harness.io, () =>
		app.run(argv, {
			stdout: () => {},
			stderr: (text) => {
				output.write(text);
			},
		}),
	);

	return {
		waitFor: async (pattern) => {
			const matcher = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
			while (!matcher.test(harness.screen())) {
				await Bun.sleep(1);
			}
		},
		type: (text) => harness.type(text),
		keys: (...namedKeys) => harness.keys(...namedKeys),
		screen: () => harness.screen(),
		done,
	};
}
