import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { isErrnoException } from "@crustjs/utils/error";
import { isWithin } from "@crustjs/utils/path";

import type { ScaffoldOptions, ScaffoldResult } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Replace `{{variable}}` placeholders in a string with values from the context.
 * Unknown placeholders are left unchanged.
 *
 * @param content - The template string containing `{{var}}` placeholders.
 * @param context - A flat map of variable names to replacement values.
 * @returns The interpolated string.
 *
 * @example
 * ```ts
 * interpolate("Hello, {{name}}!", { name: "world" });
 * // => "Hello, world!"
 * ```
 */
export function interpolate(content: string, context: Record<string, string>): string {
	return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
		// Own properties only: `{{toString}}` must not read Object.prototype.
		Object.hasOwn(context, key) ? (context[key] ?? match) : match,
	);
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
 * Reject a destination path whose existing components include a symlink
 * resolving outside the canonical destination root.
 *
 * Walks every component of `relPath` below `realDestDir`, so an ancestor
 * directory link is caught before `mkdir` would create anything through it,
 * and a dangling file link is caught before `write` would create its target.
 * Components that do not exist yet are created fresh by the caller.
 */
function assertDestinationContained(realDestDir: string, relPath: string): void {
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
 * Copy a template directory to a destination, applying variable interpolation
 * and dotfile renaming.
 *
 * Template resolution:
 * - `string` paths resolve from the current working directory, exactly like `dest`
 * - `URL` templates must be `file:` URLs; use `new URL("../templates/base", import.meta.url)`
 *   for templates shipped inside the generator package
 *
 * Call `scaffold()` multiple times to layer/compose templates — for example,
 * a base template followed by a TypeScript-specific overlay.
 *
 * @param options - Scaffold configuration.
 * @returns The list of all written file paths, relative to the destination directory.
 * @throws When the template source cannot be resolved, does not exist, or is not a directory.
 * @throws When `conflict` is `"abort"` and the destination is a non-empty directory.
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
 *   context: { name: "my-app", description: "A cool CLI" },
 * });
 *
 * console.log("Created files:", result.files);
 * ```
 */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
	const { template, dest, context, conflict = "abort" } = options;

	const templateDir = template instanceof URL ? fileURLToPath(template) : resolve(template);
	const destDir = resolve(dest);

	if (!existsSync(templateDir)) {
		throw new Error(
			`Template directory "${templateDir}" does not exist (from template: "${String(template)}").`,
		);
	}

	if (!statSync(templateDir).isDirectory()) {
		throw new Error(
			`Template path "${templateDir}" is not a directory (from template: "${String(template)}").`,
		);
	}

	// Conflict resolution
	if (conflict === "abort" && isNonEmptyDir(destDir)) {
		throw new Error(
			`Destination directory "${destDir}" already exists and is non-empty. Use conflict: "overwrite" to proceed.`,
		);
	}

	// Relative string listing, not Dirents: Yarn PnP's zip filesystem reports Dirent.parentPath
	// as ".", which would make every template file resolve outside the destination.
	// lstat keeps symlinks excluded, matching the former Dirent.isFile() filter.
	const templateFiles = readdirSync(templateDir, { recursive: true, encoding: "utf8" }).filter(
		(relFromTemplate) => lstatSync(join(templateDir, relFromTemplate)).isFile(),
	);

	// The chosen root is canonicalized once (an intentionally symlinked `dest` is
	// followed); everything below it must stay inside that canonical directory.
	// Check every destination path before the first write so an escaping link
	// fails the whole scaffold instead of a partially written tree.
	mkdirSync(destDir, { recursive: true });
	const realDestDir = realpathSync(destDir);
	const plannedFiles = templateFiles.map((relFromTemplate) => ({
		relFromTemplate,
		destRelPath: renameDotfile(relFromTemplate),
	}));
	for (const { destRelPath } of plannedFiles) {
		assertDestinationContained(realDestDir, destRelPath);
	}

	const writtenFiles: string[] = [];

	for (const { relFromTemplate, destRelPath } of plannedFiles) {
		const absolutePath = join(templateDir, relFromTemplate);
		const destFilePath = join(realDestDir, destRelPath);

		// Ensure parent directory exists
		mkdirSync(dirname(destFilePath), { recursive: true });

		// Read source file
		const buffer = readFileSync(absolutePath);

		if (buffer.subarray(0, 8192).includes(0)) {
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
