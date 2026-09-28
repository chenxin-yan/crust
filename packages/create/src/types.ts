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
	 * - `URL`: `file:` URL. Use `new URL("../templates/base", import.meta.url)` for
	 *   templates shipped inside the generator package; the module URL anchors the path.
	 * - `string`: filesystem path resolved from the current working directory, like `dest`
	 */
	readonly template: string | URL;

	/** Absolute or relative path to the destination directory. */
	readonly dest: string;

	/**
	 * Variables to interpolate into template file contents.
	 * Keys map to `{{key}}` placeholders in template files, or are passed to `render`.
	 */
	readonly context: Record<string, string>;

	/**
	 * Custom renderer for text file contents, replacing the built-in `{{key}}`
	 * interpolation (the output is not interpolated again). Called once per text
	 * file with its contents and `context`; a returned promise is awaited.
	 * Binary files are copied without calling it. Thrown or rejected errors
	 * propagate from `scaffold()`; files written earlier in the call remain.
	 * Templates run through the renderer as trusted code.
	 *
	 * @default interpolate
	 */
	readonly render?: (source: string, context: Record<string, string>) => string | Promise<string>;

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
	 * Run a command string through the platform shell (`/bin/sh` on POSIX,
	 * `cmd.exe` on Windows). Shell syntax such as redirection follows the
	 * host shell's semantics, which differ across platforms.
	 */
	| { readonly type: "command"; readonly cmd: string; readonly cwd?: string };
