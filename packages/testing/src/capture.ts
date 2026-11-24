import { stripVTControlCharacters } from "node:util";

import type { ExecuteOptions } from "@crustjs/core";

/** Variables that replace `process.env`; an `undefined` value leaves its variable out. */
export type Environment = Readonly<Record<string, string | undefined>>;

/** Options shared by the helpers that invoke an application. */
export interface CaptureOptions {
	/**
	 * Replaces `process.env` for the run, then restores it, so flags' `env` fallbacks, settings,
	 * config and state directories, app code and child processes see only these variables.
	 * `{}` is an empty environment; `{ ...process.env, NAME: "value" }` keeps the shell's and
	 * changes one. Only one run at a time may replace it.
	 */
	env?: Environment | undefined;
	/**
	 * Working directory for the run, resolved against the current one, then restored. Only one
	 * run at a time may replace it.
	 */
	cwd?: string | undefined;
	/**
	 * Keep ANSI escape sequences in captured `stdout` and `stderr`. By default they are stripped,
	 * so output is plain even when the runner sets `FORCE_COLOR` for its workers.
	 */
	raw?: boolean | undefined;
}

/** Minimal structural surface of `execute()` the helpers invoke. */
export interface ExecutableApp {
	// Core's own options type: a copy of its members drifts, and stops matching under
	// `exactOptionalPropertyTypes`.
	execute(options?: ExecuteOptions): Promise<number>;
}

/** What one run wrote and how it ended. */
export interface CapturedExecute {
	/** Exactly what was written to stdout, plain unless `raw` is set. */
	readonly stdout: string;
	/** Exactly what was written to stderr, plain unless `raw` is set. */
	readonly stderr: string;
	/**
	 * The exit code `execute()` resolved to: `0` or the action's `exitCode(n)`, `1` or a thrown
	 * value's non-zero integer `exitCode`, `2` for a usage error, `130` for cancellation, `143` after `SIGTERM`.
	 */
	readonly exitCode: number;
}

/** Captured text as the helpers return it: plain unless `raw` keeps escape sequences. */
export function captureText(
	chunks: readonly Buffer[],
	options: CaptureOptions | undefined,
): string {
	const text = Buffer.concat(chunks).toString("utf8");
	return options?.raw ? text : stripVTControlCharacters(text);
}

function replaceEnv(env: Environment): void {
	for (const name of Object.keys(process.env)) delete process.env[name];
	for (const [name, value] of Object.entries(env))
		if (value !== undefined) process.env[name] = value;
}

// The environment and working directory belong to the process: replacing them while another
// run is active would change what that run reads.
let replacing = false;

/**
 * Run `fn` with `options.env` and `options.cwd` in place, restoring both once it settles. Both
 * are in place when this returns, and it throws without running `fn` while another run is active.
 */
export function isolate<T>(options: CaptureOptions | undefined, fn: () => Promise<T>): Promise<T> {
	const cwd = options?.cwd;
	if (options?.env === undefined && cwd === undefined) return fn();
	// shortcut: a run without `env` or `cwd` that starts during a replacement is not caught, because
	// telling it from a run nested in withEnv() needs AsyncLocalStorage.
	if (replacing || activeExecutions > 0) {
		throw new Error(
			"Another run is active. Run tests that pass `env` or `cwd`, or use withEnv(), one after another, not concurrently.",
		);
	}
	// Copied before anything changes: the caller may pass `process.env` itself.
	const env = options?.env && { ...options.env };
	const savedEnv = { ...process.env };
	const savedCwd = process.cwd();
	if (cwd !== undefined) process.chdir(cwd);
	replacing = true;
	if (env !== undefined) replaceEnv(env);
	return (async () => {
		try {
			return await fn();
		} finally {
			if (env !== undefined) replaceEnv(savedEnv);
			if (cwd !== undefined) process.chdir(savedCwd);
			replacing = false;
		}
	})();
}

/**
 * Run `fn` with `process.env` replaced by `env`, then restore it, for typed
 * `app.run(path, input)` tests: `fn`'s result keeps its type. `{}` is an empty environment;
 * an `undefined` value leaves its variable out. Rejects while another run is active.
 */
export async function withEnv<T>(env: Environment, fn: () => Promise<T>): Promise<T> {
	return await isolate({ env }, fn);
}

// Overlapping runs share process-global exit state, so only the outermost can restore it safely.
let activeExecutions = 0;
let exitCodeBeforeExecutions: typeof process.exitCode;

/** `app.execute(options)`, leaving `process.exitCode` as the caller had it. */
export async function executeInProcess(
	app: ExecutableApp,
	options: ExecuteOptions,
): Promise<number> {
	if (activeExecutions === 0) exitCodeBeforeExecutions = process.exitCode;
	activeExecutions++;
	try {
		return await app.execute(options);
	} finally {
		activeExecutions--;
		if (activeExecutions === 0) {
			// Bun cannot clear a numeric exitCode back to undefined, so zero is the equivalent success state.
			process.exitCode = exitCodeBeforeExecutions ?? 0;
		}
	}
}
