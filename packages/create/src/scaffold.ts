import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { interpolate } from "./interpolate.ts";
import { isBinary } from "./isBinary.ts";
import type { ScaffoldOptions, ScaffoldResult } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Recursively collect all file paths under a directory.
 *
 * @param dir - The directory to walk.
 * @returns An array of absolute file paths.
 */
function walkDir(dir: string): string[] {
	const files: string[] = [];
	const entries = readdirSync(dir);

	for (const entry of entries) {
		const fullPath = join(dir, entry);
		const stat = statSync(fullPath);

		if (stat.isDirectory()) {
			files.push(...walkDir(fullPath));
		} else {
			files.push(fullPath);
		}
	}

	return files;
}

/**
 * Rename dotfile convention: leading `_` in the filename becomes `.`.
 *
 * For example, `_gitignore` becomes `.gitignore`.
 * Only the filename is renamed — parent directories are left unchanged.
 *
 * @param relativePath - The file path relative to the template root.
 * @returns The path with the leading `_` replaced by `.` in the filename.
 */
function renameDotfile(relativePath: string): string {
	const dir = dirname(relativePath);
	const base = relativePath.slice(dir === "." ? 0 : dir.length + 1);

	if (base.startsWith("_")) {
		const renamed = `.${base.slice(1)}`;
		return dir === "." ? renamed : join(dir, renamed);
	}

	return relativePath;
}

/**
 * Check whether a directory exists and is non-empty.
 */
function isNonEmptyDir(dirPath: string): boolean {
	if (!existsSync(dirPath)) {
		return false;
	}
	const stat = statSync(dirPath);
	if (!stat.isDirectory()) {
		return false;
	}
	const entries = readdirSync(dirPath);
	return entries.length > 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Core Scaffold Function
// ────────────────────────────────────────────────────────────────────────────

/**
 * Copy a template directory to a destination, applying variable interpolation
 * and dotfile renaming.
 *
 * Templates are resolved relative to the calling module's `import.meta.url`,
 * so templates bundled inside published npm packages resolve correctly
 * regardless of install location.
 *
 * Call `scaffold()` multiple times to layer/compose templates — for example,
 * a base template followed by a TypeScript-specific overlay.
 *
 * @param options - Scaffold configuration.
 * @returns The list of all written file paths, relative to the destination directory.
 * @throws When `conflict` is `"abort"` and the destination is a non-empty directory.
 *
 * @example
 * ```ts
 * import { scaffold } from "@crustjs/create";
 *
 * const result = await scaffold({
 *   template: "../templates/base",
 *   dest: "./my-project",
 *   importMeta: import.meta.url,
 *   context: { name: "my-app", description: "A cool CLI" },
 * });
 *
 * console.log("Created files:", result.files);
 * ```
 */
export async function scaffold(
	options: ScaffoldOptions,
): Promise<ScaffoldResult> {
	const { template, dest, importMeta, context, conflict = "abort" } = options;

	// Resolve the template directory relative to the caller's import.meta.url
	const templateDir = fileURLToPath(new URL(template, importMeta));
	const destDir = resolve(dest);

	// Conflict resolution
	if (conflict === "abort" && isNonEmptyDir(destDir)) {
		throw new Error(
			`Destination directory "${destDir}" already exists and is non-empty. Use conflict: "overwrite" to proceed.`,
		);
	}

	// Collect all files from template directory
	const templateFiles = walkDir(templateDir);
	const writtenFiles: string[] = [];

	for (const absolutePath of templateFiles) {
		// Compute relative path from template root
		const relFromTemplate = relative(templateDir, absolutePath);

		// Apply dotfile renaming convention
		const destRelPath = renameDotfile(relFromTemplate);
		const destFilePath = join(destDir, destRelPath);

		// Ensure parent directory exists
		mkdirSync(dirname(destFilePath), { recursive: true });

		// Read source file
		const buffer = readFileSync(absolutePath);

		if (isBinary(buffer)) {
			// Binary files are copied as-is
			writeFileSync(destFilePath, buffer);
		} else {
			// Text files get interpolation applied
			const content = buffer.toString("utf-8");
			const interpolated = interpolate(content, context);
			writeFileSync(destFilePath, interpolated, "utf-8");
		}

		writtenFiles.push(destRelPath);
	}

	return { files: writtenFiles };
}
