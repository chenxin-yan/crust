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
	| { readonly type: "install" }
	/**
	 * Add packages to `package.json` using the detected package manager's
	 * `add` command, resolving `@latest` to the current semver range (e.g.
	 * `^1.2.3`) and installing them in one shot.
	 *
	 * Each entry is a BARE package name (e.g. `"@crustjs/core"`). The step
	 * appends `@latest` itself when invoking the underlying command. Use
	 * `dependencies` for regular deps and `devDependencies` for dev deps.
	 * Packages are batched per dep-kind — at most two spawns are issued.
	 * If both lists are empty or omitted, the step is a no-op.
	 */
	| {
			readonly type: "add";
			readonly dependencies?: readonly string[];
			readonly devDependencies?: readonly string[];
	  }
	| { readonly type: "git-init"; readonly commit?: string }
	| { readonly type: "open-editor" }
	/**
	 * Bun Shell command string.
	 *
	 * Cross-platform shell syntax like redirection and `exit` is supported
	 * without depending on a system `sh` executable.
	 */
	| { readonly type: "command"; readonly cmd: string; readonly cwd?: string };
