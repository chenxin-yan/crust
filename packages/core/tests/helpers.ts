/**
 * Test utility for running commands and capturing output.
 *
 * Accepts a Command + RunOptions, captures stdout/stderr via mocked console,
 * and returns { stdout, stderr, exitCode }.
 *
 * Uses the real runCommand execution pipeline from @crust/core.
 */

import type { RunOptions } from "../src/run.ts";
import { runCommand as coreRunCommand } from "../src/run.ts";
import type { AnyCommand } from "../src/types.ts";

export interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/**
 * Run a command with the given options and capture all output.
 *
 * Usage:
 *   const result = await runCommand(myCmd, { argv: ["--flag", "value"] });
 *   expect(result.stdout).toContain("expected output");
 *   expect(result.exitCode).toBe(0);
 */
export async function runCommand(
	_command: AnyCommand,
	_options?: RunOptions,
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
		await coreRunCommand(_command, _options);
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
