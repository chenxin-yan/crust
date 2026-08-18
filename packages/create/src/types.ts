// ────────────────────────────────────────────────────────────────────────────
// Scaffold Options & Result
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for the {@link scaffold} function.
 *
 * @example
 * ```ts
 * const options: ScaffoldOptions = {
 *   template: new URL("../templates/base", import.meta.url),
 *   dest: "./my-project",
 *   context: { name: "my-app", description: "A cool CLI" },
 *   conflict: "abort",
 * };
 * ```
 */
export interface ScaffoldOptions {
	/**
	 * Template directory source.
	 *
	 * - `string` absolute path: used as-is
	 * - `string` relative path: resolved from the nearest package root of `process.argv[1]`
	 * - `URL`: must be a `file:` URL (for module-relative templates)
	 */
	readonly template: string | URL;

	/** Absolute or relative path to the destination directory. */
	readonly dest: string;

	/**
	 * Variables to interpolate into template file contents.
	 * Keys map to `{{key}}` placeholders in template files.
	 */
	readonly context: Record<string, string>;

	/**
	 * How to handle an existing non-empty destination directory.
	 *
	 * - `"abort"` — throw an error (default)
	 * - `"overwrite"` — proceed and overwrite existing files
	 *
	 * @default "abort"
	 */
	readonly conflict?: "abort" | "overwrite";
}

/**
 * Result returned by the {@link scaffold} function.
 */
export interface ScaffoldResult {
	/** List of all written file paths, relative to the destination directory. */
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
	/** Detect the package manager and install dependencies. */
	| { readonly type: "install" }
	/** Initialize Git and optionally create a commit containing all files. */
	| { readonly type: "git-init"; readonly commit?: string }
	/** Open the project in `$EDITOR` or VS Code; does not fail when no editor is found. */
	| { readonly type: "open-editor" }
	/**
	 * Run a command string through the platform shell (`sh` on POSIX,
	 * `cmd.exe` on Windows), so shell syntax is platform-dependent.
	 */
	| { readonly type: "command"; readonly cmd: string; readonly cwd?: string };
