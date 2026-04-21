import { $ } from "bun";
import type { PostScaffoldStep } from "./types.ts";
import { detectPackageManager, type PackageManager } from "./utils.ts";

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
export async function runSteps(
	steps: PostScaffoldStep[],
	cwd: string,
): Promise<void> {
	for (const step of steps) {
		switch (step.type) {
			case "install":
				await runInstall(cwd);
				break;
			case "add":
				await runAdd(cwd, step.dependencies, step.devDependencies);
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
	const proc = Bun.spawn([pm, "install"], {
		cwd,
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`"${pm} install" exited with code ${exitCode}`);
	}
}

/**
 * Detect the package manager and run its `add` command for the provided
 * package lists.
 *
 * Each entry is a BARE package name — `@latest` is appended here so the
 * package manager resolves the current version and writes a caret range
 * (e.g. `^1.2.3`) into the consumer's `package.json`, rather than leaving
 * a literal `"latest"` tag.
 *
 * - Regular deps and dev deps are added in separate spawns (max two).
 * - Empty / omitted lists are skipped entirely.
 * - If both lists are empty, this is a no-op.
 * - `--exact` / `-E` is intentionally NOT passed: caret ranges are desired.
 */
async function runAdd(
	cwd: string,
	dependencies: readonly string[] = [],
	devDependencies: readonly string[] = [],
): Promise<void> {
	if (dependencies.length === 0 && devDependencies.length === 0) {
		return;
	}

	const pm = detectPackageManager(cwd);

	if (dependencies.length > 0) {
		await spawnAdd(pm, cwd, dependencies, false);
	}
	if (devDependencies.length > 0) {
		await spawnAdd(pm, cwd, devDependencies, true);
	}
}

/**
 * Build and run a single `<pm> add` invocation for one dep-kind.
 */
async function spawnAdd(
	pm: PackageManager,
	cwd: string,
	packages: readonly string[],
	dev: boolean,
): Promise<void> {
	const pinned = packages.map((name) => `${name}@latest`);
	const argv = buildAddArgv(pm, pinned, dev);

	const proc = Bun.spawn(argv, {
		cwd,
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`"${argv.join(" ")}" exited with code ${exitCode}`);
	}
}

/**
 * Map a package manager + dep-kind to the concrete `add` argv.
 */
function buildAddArgv(
	pm: PackageManager,
	pinned: readonly string[],
	dev: boolean,
): string[] {
	switch (pm) {
		case "bun":
			return dev ? ["bun", "add", "-d", ...pinned] : ["bun", "add", ...pinned];
		case "pnpm":
			return dev
				? ["pnpm", "add", "-D", ...pinned]
				: ["pnpm", "add", ...pinned];
		case "yarn":
			return dev
				? ["yarn", "add", "-D", ...pinned]
				: ["yarn", "add", ...pinned];
		case "npm":
			return dev
				? ["npm", "install", "-D", ...pinned]
				: ["npm", "install", ...pinned];
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
		const proc = Bun.spawn([editor, cwd], {
			stdout: "ignore",
			stderr: "ignore",
		});
		// Don't wait for the editor to close — it may be a GUI process
		// Just check that it started without immediately failing
		// Use a short race to detect spawn failures
		const raceResult = await Promise.race([
			proc.exited.then((code) => ({ kind: "exited" as const, code })),
			new Promise<{ kind: "timeout" }>((resolve) =>
				setTimeout(() => resolve({ kind: "timeout" }), 500),
			),
		]);

		// If it exited immediately with a non-zero code, the editor likely wasn't found
		if (raceResult.kind === "exited" && raceResult.code !== 0) {
			console.warn(
				`Warning: could not open editor "${editor}" (exit code ${raceResult.code})`,
			);
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
	const hasName =
		Bun.spawnSync(["git", "config", "user.name"], { cwd }).exitCode === 0;
	const hasEmail =
		Bun.spawnSync(["git", "config", "user.email"], { cwd }).exitCode === 0;

	if (!hasName) {
		await spawnChecked(
			["git", "config", "user.name", "Crust"],
			cwd,
			"git config user.name",
		);
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
async function spawnChecked(
	cmd: string[],
	cwd: string,
	label: string,
): Promise<void> {
	const proc = Bun.spawn(cmd, {
		cwd,
		stdout: "ignore",
		stderr: "pipe",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(
			`"${label}" failed with exit code ${exitCode}${stderr ? `: ${stderr.trim()}` : ""}`,
		);
	}
}
