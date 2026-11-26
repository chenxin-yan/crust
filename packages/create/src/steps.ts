import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve as resolvePath } from "node:path";

import { runProcess, which } from "@crustjs/utils/process";
import { getTerminalSignal, writeProcessOutput } from "@crustjs/utils/terminal";

import { detectPackageManager, type PackageManager } from "./detect.ts";
import type { PostScaffoldStep, RunStepsOptions } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Post-Scaffold Step Runner
// ────────────────────────────────────────────────────────────────────────────

/**
 * Execute an array of post-scaffold steps sequentially.
 *
 * Each step is a declarative object describing an action to perform after
 * file scaffolding is complete. Steps run in array order; if any step fails,
 * the error propagates immediately (remaining steps are skipped).
 *
 * `install` and `command` children write their output to this process's standard error, so it
 * never mixes with what the CLI prints on standard output.
 *
 * @param steps - Array of {@link PostScaffoldStep} objects to execute.
 * @param cwd - The working directory for steps (typically the scaffold dest). A relative path
 *   resolves against the process working directory.
 * @param options - Where non-fatal warnings go and what cancels the steps; see {@link RunStepsOptions}.
 * @throws An `Error` with the child's `exitCode` (`null` when a signal ended it) when a step's
 *   command fails.
 * @throws `signal.reason` when the signal aborts, after the running child exits or, 5 seconds
 *   later, is killed.
 *
 * @example
 * ```ts
 * await runSteps(
 *   [
 *     { type: "install" },
 *     { type: "git-init", commit: "Initial commit" },
 *     { type: "open-editor" },
 *   ],
 *   "./my-project",
 * );
 * ```
 */
export async function runSteps(
	steps: readonly PostScaffoldStep[],
	cwd: string,
	options: RunStepsOptions = {},
): Promise<void> {
	const stderr = options.stderr ?? ((text) => writeProcessOutput(2, `${text}\n`));
	const signal = options.signal ?? getTerminalSignal();
	const root = resolvePath(cwd);
	for (const step of steps) {
		signal?.throwIfAborted();
		switch (step.type) {
			case "install":
				await runInstall(root, step.packageManager ?? detectPackageManager(root) ?? "npm", signal);
				break;
			case "git-init":
				await runGitInit(root, step.commit, signal);
				break;
			case "open-editor":
				await runOpenEditor(root, stderr);
				break;
			case "command":
				await runCommand(step.cmd, step.cwd ? resolvePath(root, step.cwd) : root, signal);
				break;
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Step Implementations
// ────────────────────────────────────────────────────────────────────────────

/** Run the package manager's install command. */
async function runInstall(
	cwd: string,
	pm: PackageManager,
	signal: AbortSignal | undefined,
): Promise<void> {
	const executable = which(pm);
	if (!executable) {
		throw new Error(`Package manager "${pm}" was not found on PATH. Install ${pm} and try again.`);
	}

	const { exitCode } = await runProcess(executable, ["install"], {
		cwd,
		stdio: "stderr",
		signal,
	});
	if (exitCode !== 0) {
		throw stepError(`"${pm} install" exited with code ${exitCode}`, exitCode);
	}
}

/**
 * Initialize a git repository. If a commit message is provided,
 * stage all files and create an initial commit.
 */
async function runGitInit(
	cwd: string,
	commit: string | undefined,
	signal: AbortSignal | undefined,
): Promise<void> {
	const git = which("git");
	if (!git) {
		throw new Error('"git" was not found on PATH. Install Git and try again.');
	}

	await spawnChecked(git, ["init"], cwd, "git init", signal);

	if (commit) {
		const identityArgs = await fallbackGitIdentityArgs(cwd, git, signal);
		await spawnChecked(git, ["add", "."], cwd, "git add", signal);
		await spawnChecked(git, [...identityArgs, "commit", "-m", commit], cwd, "git commit", signal);
	}
}

/**
 * Open the project directory in the user's preferred editor.
 *
 * Checks `$EDITOR` first, then falls back to `code` (VS Code).
 * Does not throw if the editor is not found — reports a warning instead.
 */
async function runOpenEditor(cwd: string, stderr: (text: string) => void): Promise<void> {
	const editor = process.env.EDITOR || "code";
	// Reported after the try, so a throwing `stderr` is not mistaken for a spawn failure.
	let warning: string | undefined;

	try {
		const proc = spawn(editor, [cwd], {
			stdio: "ignore",
			// $EDITOR may be a bare name that resolves to a .cmd shim on Windows
			// (e.g. "code"); shell mode is required to spawn those.
			shell: process.platform === "win32",
		});
		// Don't block the event loop on a long-lived editor process.
		proc.unref();
		// GUI editors outlive us: a 500 ms race only catches an immediate failed exit.
		const raceResult = await Promise.race([
			once(proc, "close").then(([code]) => ({ kind: "exited" as const, code })),
			new Promise<{ kind: "timeout" }>((resolve) =>
				setTimeout(() => resolve({ kind: "timeout" }), 500),
			),
		]);

		// If it exited immediately with a non-zero code, the editor likely wasn't found
		if (raceResult.kind === "exited" && raceResult.code !== 0) {
			warning = `Warning: could not open editor "${editor}" (exit code ${raceResult.code})`;
		}
	} catch {
		warning = `Warning: could not open editor "${editor}"`;
	}
	if (warning !== undefined) stderr(warning);
}

/** Run an arbitrary command string through the platform shell. */
async function runCommand(
	cmd: string,
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<void> {
	const { exitCode } = await runProcess(cmd, [], { cwd, shell: true, stdio: "stderr", signal });
	if (exitCode !== 0) {
		throw stepError(`Command "${cmd}" exited with code ${exitCode}`, exitCode);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** A failed step's error, carrying the child's exit status (`null` when a signal ended it). */
function stepError(message: string, exitCode: number | null): Error & { exitCode: number | null } {
	return Object.assign(new Error(message), { exitCode });
}

/**
 * Build `-c` arguments that fill in a missing git `user.name` / `user.email`.
 *
 * CI environments often lack global git config, which causes `git commit`
 * to fail. The fallback applies to the initial commit only and is never
 * written to the repo config, so later commits use the user's own identity.
 */
async function fallbackGitIdentityArgs(
	cwd: string,
	git: string,
	signal: AbortSignal | undefined,
): Promise<string[]> {
	const args: string[] = [];
	if (!(await hasGitConfig(git, "user.name", cwd, signal))) {
		args.push("-c", "user.name=Crust");
	}
	if (!(await hasGitConfig(git, "user.email", cwd, signal))) {
		args.push("-c", "user.email=crust@scaffolded.project");
	}
	return args;
}

/** Probe a git config key; non-zero exit means it is unset. */
async function hasGitConfig(
	git: string,
	key: string,
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<boolean> {
	const { exitCode } = await runProcess(git, ["config", key], {
		cwd,
		stdio: "collect",
		stdout: "ignore",
		signal,
	});
	return exitCode === 0;
}

/**
 * Spawn a process and throw a descriptive error if it exits non-zero.
 */
async function spawnChecked(
	command: string,
	args: readonly string[],
	cwd: string,
	label: string,
	signal: AbortSignal | undefined,
): Promise<void> {
	const { exitCode, stderr } = await runProcess(command, args, {
		cwd,
		stdio: "collect",
		stdout: "ignore",
		signal,
	});
	if (exitCode !== 0) {
		throw stepError(
			`"${label}" failed with exit code ${exitCode}${stderr ? `: ${stderr.trim()}` : ""}`,
			exitCode,
		);
	}
}
