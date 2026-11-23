import type { PackageManager } from "@crustjs/utils/package-manager";

// ────────────────────────────────────────────────────────────────────────────
// Scaffold Options & Result
// ────────────────────────────────────────────────────────────────────────────

/**
 * Files written from code: each key is a path in the new project, `/`-separated, and each value
 * is the file's text.
 */
export type ScaffoldFiles = Readonly<Record<string, string>>;

/**
 * Options for the {@link scaffold} function. At least one of `template` and `files` is required.
 *
 * @example
 * ```ts
 * const options: ScaffoldOptions = {
 *   template: new URL("../templates/base", import.meta.url),
 *   dest: "./my-project",
 *   files: { "README.md": "# my-app\n" },
 * };
 * ```
 */
export type ScaffoldOptions = (
	| {
			/**
			 * A directory copied exactly: every file's bytes and permission bits. A file named with a single
			 * leading `_` is written with a `.` instead (`_gitignore` becomes `.gitignore`).
			 *
			 * - `string`: filesystem path; a relative one resolves against the working directory, like
			 *   `dest`. For templates shipped with a CLI built by `crust build`, pass
			 *   `artifactPath("templates/base")`.
			 * - `URL`: `file:` URL, such as `new URL("../templates/base", import.meta.url)` in a
			 *   package that is published unbundled.
			 */
			readonly template: string | URL;
			/**
			 * Files written from code. A key that names a template file replaces its content and keeps
			 * its permission bits. Keys are written as given: no `_` rename.
			 */
			readonly files?: ScaffoldFiles;
	  }
	| { readonly template?: undefined; readonly files: ScaffoldFiles }
) & {
	/** Destination directory, not empty. A relative path resolves against the working directory. */
	readonly dest: string;

	/**
	 * What to do when the destination already holds files. A destination holding only `.git`
	 * counts as empty.
	 *
	 * - `"abort"`: throw before writing (default)
	 * - `"overwrite"`: replace conflicting files and leave the others
	 * - `"replace"`: delete everything but `.git` first
	 *
	 * @default "abort"
	 */
	readonly conflict?: "abort" | "overwrite" | "replace";

	/** Run every check and return the files that would be written, without writing or deleting. */
	readonly dryRun?: boolean;
};

/**
 * Result returned by the {@link scaffold} function.
 */
export interface ScaffoldResult {
	/** Every written file path, relative to the destination directory, sorted. */
	readonly files: readonly string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Post-Scaffold Steps
// ────────────────────────────────────────────────────────────────────────────

/**
 * A declarative step to run after scaffolding completes.
 *
 * Steps are executed sequentially in array order by {@link runSteps}.
 *
 * @example
 * ```ts
 * const steps: PostScaffoldStep[] = [
 *   { type: "install" },
 *   { type: "git-init", commit: "Initial commit" },
 *   { type: "open-editor" },
 * ];
 * ```
 */
export type PostScaffoldStep =
	/**
	 * Install dependencies with `packageManager`, or the one {@link detectPackageManager} finds,
	 * else npm.
	 */
	| { readonly type: "install"; readonly packageManager?: PackageManager }
	/** Initialize Git and optionally create a commit containing all files. */
	| { readonly type: "git-init"; readonly commit?: string }
	/** Open the project in `$EDITOR` or VS Code; does not fail when no editor is found. */
	| { readonly type: "open-editor" }
	/**
	 * Run a command string through the platform shell (`/bin/sh` on POSIX,
	 * `cmd.exe` on Windows). Shell syntax such as redirection follows the
	 * host shell's semantics, which differ across platforms. A relative `cwd`
	 * resolves against the `runSteps` directory.
	 */
	| { readonly type: "command"; readonly cmd: string; readonly cwd?: string };

/** Options for {@link runSteps}. */
export interface RunStepsOptions {
	/**
	 * Receives non-fatal warnings, one line per call, such as an editor that failed to open.
	 * Inside a Crust command, pass the action's `stderr`. Defaults to standard error, written
	 * through the same writer as Core's default `stderr`.
	 */
	readonly stderr?: (text: string) => void;
	/**
	 * Cancels the steps: aborting it terminates the running child process and rejects with
	 * `signal.reason` once it exits, or after 5 seconds and a `SIGKILL`, skipping the remaining
	 * steps. Defaults to the ambient
	 * terminal signal, which inside a Crust command is the invocation's `signal`, so Ctrl-C and
	 * `SIGTERM` cancel `runSteps()` without passing it.
	 */
	readonly signal?: AbortSignal;
}
