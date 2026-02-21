// ────────────────────────────────────────────────────────────────────────────
// Scaffold Options & Result
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for the {@link scaffold} function.
 *
 * @example
 * ```ts
 * const options: ScaffoldOptions = {
 *   template: "../templates/base",
 *   dest: "./my-project",
 *   importMeta: import.meta.url,
 *   context: { name: "my-app", description: "A cool CLI" },
 *   conflict: "abort",
 * };
 * ```
 */
export interface ScaffoldOptions {
	/** Relative path to the template directory (resolved against `importMeta`). */
	readonly template: string;

	/** Absolute or relative path to the destination directory. */
	readonly dest: string;

	/**
	 * The `import.meta.url` of the calling module.
	 * Used to resolve the template path relative to the caller.
	 */
	readonly importMeta: string;

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
	| { readonly type: "git-init"; readonly commit?: string }
	| { readonly type: "open-editor" }
	| { readonly type: "command"; readonly cmd: string; readonly cwd?: string };
