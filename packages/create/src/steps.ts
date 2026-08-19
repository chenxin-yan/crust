import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { text } from "node:stream/consumers";

import { which } from "@crustjs/utils/process";

import type { PostScaffoldStep } from "./types.ts";
import { detectPackageManager } from "./utils.ts";

/**
 * Whether spawning this executable requires `shell: true`.
 *
 * On Windows, package managers resolve to `.cmd`/`.bat` shims, which Node
 * refuses to spawn directly since the CVE-2024-27980 hardening (throws
 * EINVAL). Safe here because all callers pass fixed literal args.
 */
function needsShell(executable: string): boolean {
	return /\.(cmd|bat)$/i.test(executable);
}

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
	const executable = which(pm);
	if (!executable) {
		throw new Error(`Package manager "${pm}" was not found on PATH. Install ${pm} and try again.`);
	}

	// Under shell mode, pass the bare pm name so cmd.exe resolves it — the
	// resolved path may contain spaces, which an unquoted shell string breaks.
	const shell = needsShell(executable);
	const proc = spawn(shell ? pm : executable, ["install"], { cwd, stdio: "inherit", shell });
	const [exitCode] = await once(proc, "close");
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

	await spawnChecked([git, "init"], cwd, "git init");

	if (commit) {
		// Ensure git identity is configured for the commit.
		// CI environments often lack global user.name/user.email config,
		// so we set local defaults if they are missing.
		await ensureGitIdentity(cwd, git);
		await spawnChecked([git, "add", "."], cwd, "git add");
		await spawnChecked([git, "commit", "-m", commit], cwd, "git commit");
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
		// Don't wait for the editor to close — it may be a GUI process
		// Just check that it started without immediately failing
		// Use a short race to detect spawn failures
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
	const proc = spawn(cmd, { cwd, shell: true, stdio: "inherit" });
	const [exitCode] = await once(proc, "close");
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
	const hasName = spawnSync(git, ["config", "user.name"], { cwd }).status === 0;
	const hasEmail = spawnSync(git, ["config", "user.email"], { cwd }).status === 0;

	if (!hasName) {
		await spawnChecked([git, "config", "user.name", "Crust"], cwd, "git config user.name");
	}
	if (!hasEmail) {
		await spawnChecked(
			[git, "config", "user.email", "crust@scaffolded.project"],
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
	const [stderr, [exitCode]] = await Promise.all([text(proc.stderr), once(proc, "close")]);
	if (exitCode !== 0) {
		throw new Error(
			`"${label}" failed with exit code ${exitCode}${stderr ? `: ${stderr.trim()}` : ""}`,
		);
	}
}
