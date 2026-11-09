import { stripVTControlCharacters } from "node:util";

import type { ExecuteOptions } from "@crustjs/core";

/** Options shared by the helpers that invoke an application. */
export interface CaptureOptions {
	/**
	 * Variables flags' `env` bindings read. Defaults to `{}`, so results never depend on the
	 * shell running the tests.
	 */
	env?: ExecuteOptions["env"];
	/**
	 * Keep ANSI escape sequences in captured `stdout` and `stderr`. By default they are stripped,
	 * so output is plain even when the runner sets `FORCE_COLOR` for its workers.
	 */
	raw?: boolean;
}

/** Captured text as the helpers return it: plain unless `raw` keeps escape sequences. */
export function captureText(lines: readonly string[], options: CaptureOptions | undefined): string {
	const text = lines.join("\n");
	return options?.raw ? text : stripVTControlCharacters(text);
}
