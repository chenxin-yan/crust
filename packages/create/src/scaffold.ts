import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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

/**
 * Find the nearest directory containing `package.json`.
 */
function findNearestPackageRoot(startPath: string): string | null {
	let current = resolve(startPath);

	if (existsSync(current) && !statSync(current).isDirectory()) {
		current = dirname(current);
	}

	while (true) {
		if (existsSync(join(current, "package.json"))) {
			return current;
		}

		const parent = dirname(current);
		if (parent === current) {
			return null;
		}

		current = parent;
	}
}

/**
 * Resolve the template directory from a string path or file URL.
 */
function resolveTemplateDir(template: string | URL): string {
	if (template instanceof URL) {
		if (template.protocol !== "file:") {
			throw new Error(
				`Template URL must use file: protocol, got "${template.protocol}".`,
			);
		}

		return fileURLToPath(template);
	}

	if (isAbsolute(template)) {
		return resolve(template);
	}

	const entrypoint = process.argv[1];
	if (!entrypoint) {
		throw new Error(
			`Could not resolve relative template path "${template}" because process.argv[1] is not set. Pass an absolute path or a file: URL template.`,
		);
	}

	const packageRoot = findNearestPackageRoot(resolve(entrypoint));
	if (!packageRoot) {
		throw new Error(
			`Could not resolve relative template path "${template}" from entrypoint "${entrypoint}" because no package.json was found in its parent directories. Pass an absolute path or a file: URL template.`,
		);
	}

	return resolve(packageRoot, template);
}

/**
 * Convert template input to a readable string for diagnostics.
 */
function formatTemplateInput(template: string | URL): string {
	return typeof template === "string" ? template : template.href;
}

// ────────────────────────────────────────────────────────────────────────────
// Core Scaffold Function
// ────────────────────────────────────────────────────────────────────────────

/**
 * Copy a template directory to a destination, applying variable interpolation
 * and dotfile renaming.
 *
 * Template resolution:
 * - `string` absolute paths are used as-is
 * - `string` relative paths resolve from the nearest package root of `process.argv[1]`
 * - `URL` templates must be `file:` URLs (for module-relative templates)
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
 *   template: new URL("../templates/base", import.meta.url),
 *   dest: "./my-project",
 *   context: { name: "my-app", description: "A cool CLI" },
 * });
 *
 * console.log("Created files:", result.files);
 * ```
 */
export async function scaffold(
	options: ScaffoldOptions,
): Promise<ScaffoldResult> {
	const { template, dest, context, conflict = "abort" } = options;

	const templateDir = resolveTemplateDir(template);
	const destDir = resolve(dest);

	if (!existsSync(templateDir)) {
		throw new Error(
			`Template directory "${templateDir}" does not exist (from template: "${formatTemplateInput(template)}").`,
		);
	}

	if (!statSync(templateDir).isDirectory()) {
		throw new Error(
			`Template path "${templateDir}" is not a directory (from template: "${formatTemplateInput(template)}").`,
		);
	}

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
