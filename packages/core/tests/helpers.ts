/**
 * Test utility for running Crust builders and capturing output.
 *
 * Accepts a Crust builder instance + optional argv, captures stdout/stderr
 * via mocked console, and returns { stdout, stderr, exitCode }.
 *
 * Uses the real .execute() pipeline from the Crust builder.
 */

import type { Crust } from "../src/crust.ts";

export interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/**
 * Execute a Crust builder with the given argv and capture all output.
 *
 * Usage:
 *   const result = await executeCrust(myApp, ["--flag", "value"]);
 *   expect(result.stdout).toContain("expected output");
 *   expect(result.exitCode).toBe(0);
 */
export async function executeCrust(
	// biome-ignore lint/suspicious/noExplicitAny: accepts any Crust generic params
	builder: Crust<any, any, any>,
	argv?: string[],
): Promise<RunResult> {
	const stdoutChunks: string[] = [];
	const stderrChunks: string[] = [];
	let exitCode = 0;

	// Save original console methods and process.exitCode
	const originalLog = console.log;
	const originalError = console.error;
	const originalWarn = console.warn;
	const originalExitCode = process.exitCode;

	// Mock console to capture output
	console.log = (...args: unknown[]) => {
		stdoutChunks.push(
			args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
		);
	};
	console.error = (...args: unknown[]) => {
		stderrChunks.push(
			args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
		);
	};
	console.warn = (...args: unknown[]) => {
		stderrChunks.push(
			args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
		);
	};

	try {
		await builder.execute({ argv });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		stderrChunks.push(message);
		exitCode = 1;
	} finally {
		// Restore original console methods
		console.log = originalLog;
		console.error = originalError;
		console.warn = originalWarn;

		// Capture exit code if set by the command
		if (
			process.exitCode !== undefined &&
			process.exitCode !== null &&
			process.exitCode !== originalExitCode
		) {
			exitCode = process.exitCode as number;
		}

		// Restore original exit code
		if (originalExitCode !== undefined) {
			process.exitCode = originalExitCode;
		}
	}

	return {
		stdout: stdoutChunks.join("\n"),
		stderr: stderrChunks.join("\n"),
		exitCode,
	};
}
