import {
	chmodSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { isErrnoException } from "@crustjs/utils/error";
import { isWithin, resolvePathLike } from "@crustjs/utils/path";

import type { ScaffoldOptions, ScaffoldResult } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Rename dotfile convention: a single leading `_` in the filename becomes `.`.
 *
 * For example, `_gitignore` becomes `.gitignore`.
 * Files starting with `__` (double underscore) are left unchanged to avoid
 * collisions with conventional directory names like `__tests__` or `__mocks__`.
 * Only the filename is renamed — parent directories are left unchanged.
 *
 * @param relativePath - The file path relative to the template root.
 * @returns The path with the leading `_` replaced by `.` in the filename.
 */
function renameDotfile(relativePath: string): string {
	const dir = dirname(relativePath);
	const base = relativePath.slice(dir === "." ? 0 : dir.length + 1);

	if (base.startsWith("_") && !base.startsWith("__")) {
		const renamed = `.${base.slice(1)}`;
		return dir === "." ? renamed : join(dir, renamed);
	}

	return relativePath;
}

/** A `files` key as a path relative to the destination, refused outside it or inside `.git`. */
function filesKeyPath(destDir: string, key: string): string {
	const target = resolve(destDir, key);
	const relPath = relative(destDir, target);
	if (isAbsolute(key) || relPath === "" || !isWithin(destDir, target)) {
		throw new Error(`files: ${JSON.stringify(key)} is not a path inside the new project.`);
	}
	if (relPath.split(sep)[0]!.toLowerCase() === ".git") {
		throw new Error(`files: ${JSON.stringify(key)} is inside .git.`);
	}
	return relPath;
}

/**
 * Reject a destination path whose existing components include a symlink
 * resolving outside the canonical destination root.
 *
 * Walks every component of `relPath` below `realDestDir`, so an ancestor
 * directory link is caught before `mkdir` would create anything through it,
 * and a dangling file link is caught before `write` would create its target.
 * Components that do not exist yet are created fresh by the caller.
 */
function assertDestinationContained(realDestDir: string, relPath: string): void {
	if (realpathSync(realDestDir) !== realDestDir) {
		throw new Error(`Destination root "${realDestDir}" was redirected outside the destination.`);
	}
	let current = realDestDir;
	for (const segment of relPath.split(sep)) {
		current = join(current, segment);
		let isLink: boolean;
		try {
			isLink = lstatSync(current).isSymbolicLink();
		} catch (error) {
			if (isErrnoException(error) && error.code === "ENOENT") {
				return;
			}
			throw error;
		}
		if (!isLink) {
			continue;
		}
		let target: string | undefined;
		try {
			target = realpathSync(current);
		} catch {
			// Dangling link: writing through it would create the target wherever it points.
		}
		if (target === undefined || !isWithin(realDestDir, target)) {
			throw new Error(
				`Destination path "${current}" is a symlink${target === undefined ? " to a missing target" : ` to "${target}"`} outside the destination "${realDestDir}". Remove the link or choose another destination.`,
			);
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Core Scaffold Function
// ────────────────────────────────────────────────────────────────────────────

/**
 * Write a new project: copy the `template` directory exactly (bytes and file modes), then write
 * `files` from code. A `files` entry wins over the template file at the same path.
 *
 * Template resolution:
 * - `string` paths resolve from the current working directory, exactly like `dest`
 * - `URL` templates must be `file:` URLs; use `new URL("../templates/base", import.meta.url)`
 *   for templates shipped inside the generator package
 *
 * Every check runs before anything is deleted or written, and in a dry run.
 *
 * @param options - Scaffold configuration.
 * @returns Every written file path (or, with `dryRun`, every path that would be written),
 *   relative to the destination directory, sorted.
 * @throws When the template source cannot be resolved, does not exist, or is not a directory.
 * @throws When there is nothing to write: the template is empty and `files` has no entries.
 * @throws When a `files` key is absolute, leaves the destination, or is inside `.git`.
 * @throws When `dest` exists and is not a directory.
 * @throws When `conflict` is `"abort"` and the destination holds anything besides `.git`.
 * @throws When an existing destination file or ancestor directory is a symlink that
 *   resolves outside the destination (or to a missing target), regardless of `conflict`.
 *   A `dest` that is itself a symlink is followed once: its target is the destination.
 *
 * @example
 * ```ts
 * import { scaffold } from "@crustjs/create";
 *
 * const result = await scaffold({
 *   template: new URL("../templates/base", import.meta.url),
 *   dest: "./my-project",
 *   files: { "README.md": "# my-app\n" },
 * });
 *
 * console.log("Created files:", result.files);
 * ```
 */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
	const { template, dest, files = {}, conflict = "abort", dryRun = false } = options;
	const destDir = resolve(dest);

	// Each destination path maps to the template file it copies, the text written from code, or
	// both: then the text wins and the template file's mode is kept.
	const plan = new Map<string, { source?: string; text?: string }>();
	if (template !== undefined) {
		const templateDir = resolvePathLike(template);
		const templateStat = statSync(templateDir, { throwIfNoEntry: false });
		if (!templateStat) {
			throw new Error(
				`Template directory "${templateDir}" does not exist (from template: "${String(template)}").`,
			);
		}
		if (!templateStat.isDirectory()) {
			throw new Error(
				`Template path "${templateDir}" is not a directory (from template: "${String(template)}").`,
			);
		}
		// Relative string listing, not Dirents: Yarn PnP's zip filesystem reports Dirent.parentPath
		// as ".", which would make every template file resolve outside the destination.
		// lstat keeps symlinks excluded.
		for (const relFromTemplate of readdirSync(templateDir, { recursive: true, encoding: "utf8" })) {
			const source = join(templateDir, relFromTemplate);
			if (lstatSync(source).isFile()) plan.set(renameDotfile(relFromTemplate), { source });
		}
	}
	for (const [key, text] of Object.entries(files)) {
		const relPath = filesKeyPath(destDir, key);
		plan.set(relPath, { ...plan.get(relPath), text });
	}
	if (plan.size === 0) {
		throw new Error("Nothing to scaffold: the template has no files and `files` has no entries.");
	}

	const destStat = statSync(destDir, { throwIfNoEntry: false });
	if (destStat && !destStat.isDirectory()) {
		throw new Error(`Destination "${destDir}" exists and is not a directory.`);
	}
	const existing = destStat ? readdirSync(destDir).filter((name) => name !== ".git") : [];
	if (conflict === "abort" && existing.length > 0) {
		throw new Error(
			`Destination directory "${destDir}" already exists and is non-empty. Use conflict: "overwrite" or "replace" to proceed.`,
		);
	}

	// The chosen root is canonicalized once (an intentionally symlinked `dest` is followed);
	// everything below it must stay inside that canonical directory. A destination that does
	// not exist yet has no links to check.
	const relPaths = [...plan.keys()].sort();
	if (destStat) {
		const realDestDir = realpathSync(destDir);
		for (const relPath of relPaths) assertDestinationContained(realDestDir, relPath);
	}
	if (dryRun) return { files: relPaths };

	if (conflict === "replace") {
		for (const name of existing) rmSync(join(destDir, name), { recursive: true, force: true });
	}
	mkdirSync(destDir, { recursive: true });
	const realDestDir = realpathSync(destDir);
	for (const relPath of relPaths) {
		const { source, text } = plan.get(relPath)!;
		const destFilePath = join(realDestDir, relPath);
		mkdirSync(dirname(destFilePath), { recursive: true });
		writeFileSync(destFilePath, text ?? readFileSync(source!));
		if (source !== undefined) chmodSync(destFilePath, statSync(source).mode & 0o777);
	}

	return { files: relPaths };
}
