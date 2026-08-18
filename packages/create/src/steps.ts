import { spawn, spawnSync } from "node:child_process";

import { $ } from "bun";

import type { PostScaffoldStep } from "./types.ts";
import { detectPackageManager } from "./utils.ts";

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
export async function runSteps(steps: PostScaffoldStep[], cwd: string): Promise<void> {
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
	const proc = spawn(pm, ["install"], { cwd, stdio: "inherit" });
	const exitCode = await exitCodeOf(proc);
	if (exitCode !== 0) {
		throw new Error(`"${pm} install" exited with code ${exitCode}`);
	}
}

/**
 * Initialize a git repository. If a commit message is provided,
 * stage all files and create an initial commit.
 */
async function runGitInit(cwd: string, commit?: string): Promise<void> {
	await spawnChecked(["git", "init"], cwd, "git init");

	if (commit) {
		// Ensure git identity is configured for the commit.
		// CI environments often lack global user.name/user.email config,
		// so we set local defaults if they are missing.
		await ensureGitIdentity(cwd);
		await spawnChecked(["git", "add", "."], cwd, "git add");
		await spawnChecked(["git", "commit", "-m", commit], cwd, "git commit");
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
		const proc = spawn(editor, [cwd], { stdio: "ignore" });
		// Don't wait for the editor to close — it may be a GUI process
		// Just check that it started without immediately failing
		// Use a short race to detect spawn failures
		const raceResult = await Promise.race([
			exitCodeOf(proc).then((code) => ({ kind: "exited" as const, code })),
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

/**
 * Run an arbitrary Bun Shell command string.
 *
 * Bun Shell is cross-platform and does not depend on `/bin/sh`,
 * so shell features like redirection work on Windows as well.
 */
async function runCommand(cmd: string, cwd: string): Promise<void> {
	const result = await $`${{ raw: cmd }}`.cwd(cwd).nothrow();
	const exitCode = result.exitCode;
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
async function ensureGitIdentity(cwd: string): Promise<void> {
	const hasName = spawnSync("git", ["config", "user.name"], { cwd }).status === 0;
	const hasEmail = spawnSync("git", ["config", "user.email"], { cwd }).status === 0;

	if (!hasName) {
		await spawnChecked(["git", "config", "user.name", "Crust"], cwd, "git config user.name");
	}
	if (!hasEmail) {
		await spawnChecked(
			["git", "config", "user.email", "crust@scaffolded.project"],
			cwd,
			"git config user.email",
		);
	}
}

/**
 * Spawn a process and throw a descriptive error if it exits non-zero.
 */
async function spawnChecked(cmd: string[], cwd: string, label: string): Promise<void> {
	const proc = spawn(cmd[0]!, cmd.slice(1), { cwd, stdio: ["ignore", "ignore", "pipe"] });
	let stderr = "";
	proc.stderr.on("data", (chunk) => (stderr += chunk));
	const exitCode = await exitCodeOf(proc);
	if (exitCode !== 0) {
		throw new Error(
			`"${label}" failed with exit code ${exitCode}${stderr ? `: ${stderr.trim()}` : ""}`,
		);
	}
}

function exitCodeOf(proc: ReturnType<typeof spawn>): Promise<number> {
	return new Promise((resolve, reject) => {
		proc.once("error", reject);
		proc.once("close", (code) => resolve(code ?? 1));
	});
}
