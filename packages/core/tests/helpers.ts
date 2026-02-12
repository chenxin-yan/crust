/**
 * Test utility for running commands and capturing output.
 *
 * Accepts a Command + argv array, captures stdout/stderr via mocked console,
 * and returns { stdout, stderr, exitCode }.
 */

import type { Command } from "../src/types.ts";

export interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/**
 * Run a command with the given argv and capture all output.
 *
 * Usage:
 *   const result = await runCommand(myCmd, ["--flag", "value"]);
 *   expect(result.stdout).toContain("expected output");
 *   expect(result.exitCode).toBe(0);
 */
export async function runCommand(
	_command: Command,
	_argv: string[] = [],
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
		// Placeholder: once runCommand from @crust/core is implemented (Task 7),
		// this will call the real execution pipeline:
		//   await coreRunCommand(command, argv);
		//
		// For now, this is a stub that can be used for basic testing.
		// Future tasks will update this to use the real implementation.

		// If the command has a run function, call it as a basic stub
		if (_command && typeof _command.run === "function") {
			await _command.run({
				args: {},
				flags: {},
				rawArgs: _argv,
				cmd: _command,
			});
		}
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
		if (process.exitCode !== undefined && process.exitCode !== null) {
			exitCode = process.exitCode as number;
		}

		// Restore original exit code
		process.exitCode = originalExitCode;
	}

	return {
		stdout: stdoutChunks.join("\n"),
		stderr: stderrChunks.join("\n"),
		exitCode,
	};
}
