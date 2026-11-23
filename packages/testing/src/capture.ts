import { stripVTControlCharacters } from "node:util";

import type { ExecuteOptions } from "@crustjs/core";

/** Options shared by the helpers that invoke an application. */
export interface CaptureOptions {
	/**
	 * Variables flags' `env` bindings read instead of `process.env`. Pass `{}` so results never
	 * depend on the shell running the tests.
	 */
	env?: ExecuteOptions["env"] | undefined;
	/**
	 * Keep ANSI escape sequences in captured `stdout` and `stderr`. By default they are stripped,
	 * so output is plain even when the runner sets `FORCE_COLOR` for its workers.
	 */
	raw?: boolean | undefined;
}

/** Captured text as the helpers return it: plain unless `raw` keeps escape sequences. */
export function captureText(text: string, options: CaptureOptions | undefined): string {
	return options?.raw ? text : stripVTControlCharacters(text);
}

/** Every chunk written, as UTF-8 text without the final newline a last `stdout(text)` adds, like `run()`. */
export function joinChunks(chunks: readonly (string | Uint8Array)[]): string {
	return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
		.toString("utf8")
		.replace(/\n$/, "");
}
