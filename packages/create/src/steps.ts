import { spawn } from "node:child_process";
import { once } from "node:events";

import { runProcess, which } from "@crustjs/utils/process";

import type { PostScaffoldStep } from "./types.ts";
import { detectPackageManager } from "./detect.ts";

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
 * @param steps - Array of {@link PostScaffoldStep} objects to execute.
 * @param cwd - The working directory for steps (typically the scaffold dest).
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
export async function runSteps(steps: readonly PostScaffoldStep[], cwd: string): Promise<void> {
	for (const step of steps) {
		switch (step.type) {
			case "install":
				await runInstall(cwd);
				break;
			case "git-init":
				await runGitInit(cwd, step.commit);
				break;
			case "open-editor":
				await runOpenEditor(cwd);
				break;
			case "command":
				await runCommand(step.cmd, step.cwd ?? cwd);
				break;
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Step Implementations
// ────────────────────────────────────────────────────────────────────────────

/**
 * Detect the package manager and run its install command.
 */
async function runInstall(cwd: string): Promise<void> {
	const pm = detectPackageManager(cwd);
	const executable = which(pm);
	if (!executable) {
		throw new Error(`Package manager "${pm}" was not found on PATH. Install ${pm} and try again.`);
	}

	const { exitCode } = await runProcess(executable, ["install"], {
		cwd,
		stdio: "inherit",
	});
	if (exitCode !== 0) {
		throw new Error(`"${pm} install" exited with code ${exitCode}`);
	}
}

/**
 * Initialize a git repository. If a commit message is provided,
 * stage all files and create an initial commit.
 */
async function runGitInit(cwd: string, commit?: string): Promise<void> {
	const git = which("git");
	if (!git) {
		throw new Error('"git" was not found on PATH. Install Git and try again.');
	}

	await spawnChecked(git, ["init"], cwd, "git init");

	if (commit) {
		await ensureGitIdentity(cwd, git);
		await spawnChecked(git, ["add", "."], cwd, "git add");
		await spawnChecked(git, ["commit", "-m", commit], cwd, "git commit");
	}
}

/**
 * Open the project directory in the user's preferred editor.
 *
 * Checks `$EDITOR` first, then falls back to `code` (VS Code).
 * Does not throw if the editor is not found — logs a warning instead.
 */
async function runOpenEditor(cwd: string): Promise<void> {
	const editor = process.env.EDITOR || "code";

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
			console.warn(`Warning: could not open editor "${editor}" (exit code ${raceResult.code})`);
		}
	} catch {
		console.warn(`Warning: could not open editor "${editor}"`);
	}
}

/** Run an arbitrary command string through the platform shell. */
async function runCommand(cmd: string, cwd: string): Promise<void> {
	const { exitCode } = await runProcess(cmd, [], { cwd, shell: true, stdio: "inherit" });
	if (exitCode !== 0) {
		throw new Error(`Command "${cmd}" exited with code ${exitCode}`);
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Ensure git `user.name` and `user.email` are configured locally.
 *
 * CI environments often lack global git config, which causes `git commit`
 * to fail. This sets sensible local-repo defaults only when the values
 * are not already set at any level (local, global, system).
 */
async function ensureGitIdentity(cwd: string, git: string): Promise<void> {
	if (!(await hasGitConfig(git, "user.name", cwd))) {
		await spawnChecked(git, ["config", "user.name", "Crust"], cwd, "git config user.name");
	}
	if (!(await hasGitConfig(git, "user.email", cwd))) {
		await spawnChecked(
			git,
			["config", "user.email", "crust@scaffolded.project"],
			cwd,
			"git config user.email",
		);
	}
}

/** Probe a git config key; non-zero exit means it is unset. */
async function hasGitConfig(git: string, key: string, cwd: string): Promise<boolean> {
	const { exitCode } = await runProcess(git, ["config", key], {
		cwd,
		stdio: "collect",
		stdout: "ignore",
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
): Promise<void> {
	const { exitCode, stderr } = await runProcess(command, args, {
		cwd,
		stdio: "collect",
		stdout: "ignore",
	});
	if (exitCode !== 0) {
		throw new Error(
			`"${label}" failed with exit code ${exitCode}${stderr ? `: ${stderr.trim()}` : ""}`,
		);
	}
}
