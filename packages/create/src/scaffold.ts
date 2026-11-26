import {
	accessSync,
	chmodSync,
	closeSync,
	constants,
	fchmodSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	type Stats,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

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
 * collisions with conventional directory names like `__tests__` or `__mocks__`,
 * and a file named only `_` or `_.` is left unchanged, since `.` and `..` are no file names.
 * Only the filename is renamed — parent directories are left unchanged.
 *
 * @param relativePath - The file path relative to the copied directory.
 * @returns The path with the leading `_` replaced by `.` in the filename.
 */
function renameDotfile(relativePath: string): string {
	const dir = dirname(relativePath);
	const base = relativePath.slice(dir === "." ? 0 : dir.length + 1);

	if (base !== "_" && base !== "_." && base.startsWith("_") && !base.startsWith("__")) {
		const renamed = `.${base.slice(1)}`;
		return dir === "." ? renamed : join(dir, renamed);
	}

	return relativePath;
}

/** Whether a path relative to the destination is `.git` or inside it, in any letter case. */
function isGitPath(relPath: string): boolean {
	return relPath.split(sep)[0]!.toLowerCase() === ".git";
}

/** A `write` key as a path relative to the destination, refused outside it. */
function writeKeyPath(destDir: string, key: string): string {
	const target = resolve(destDir, key);
	const relPath = relative(destDir, target);
	if (isAbsolute(key) || relPath === "" || !isWithin(destDir, target)) {
		throw new Error(`write: ${JSON.stringify(key)} is not a path inside the new project.`);
	}
	return relPath;
}

/**
 * Reject a destination path that cannot be written as planned.
 *
 * Walks every existing component of `relPath` below `realDestDir`, so an ancestor directory
 * link is caught before `mkdir` would create anything through it, and a dangling file link is
 * caught before `write` would create its target. A link must resolve inside the destination and
 * outside its `.git`; the walk goes on from its target, so a path through a link cannot reach
 * `.git` either, whether or not it exists. With `keepsExisting` (nothing is deleted first), an existing ancestor must
 * be a directory and the file itself must not be one. Components that do not exist yet are
 * created fresh by the caller.
 */
function assertDestinationWritable(
	realDestDir: string,
	relPath: string,
	keepsExisting: boolean,
): void {
	if (realpathSync(realDestDir) !== realDestDir) {
		throw new Error(`Destination root "${realDestDir}" was redirected outside the destination.`);
	}
	const segments = relPath.split(sep);
	let current = realDestDir;
	for (const [index, segment] of segments.entries()) {
		current = join(current, segment);
		if (isGitPath(relative(realDestDir, current))) {
			throw new Error(`Destination path "${current}" is inside .git.`);
		}
		let stat: Stats;
		try {
			stat = lstatSync(current);
		} catch (error) {
			if (isErrnoException(error) && error.code === "ENOENT") {
				return;
			}
			throw error;
		}
		if (stat.isSymbolicLink()) {
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
			if (isGitPath(relative(realDestDir, target))) {
				throw new Error(`Destination path "${current}" is a symlink into .git.`);
			}
			stat = statSync(target);
			current = target;
		}
		const isFile = index === segments.length - 1;
		if (stat.isDirectory() === isFile) {
			// Without keepsExisting, `replace` deletes this component before writing.
			if (!keepsExisting) return;
			throw new Error(
				`Destination path "${current}" is ${isFile ? "a directory" : "not a directory"}, so "${relPath}" cannot be written.`,
			);
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Core Scaffold Function
// ────────────────────────────────────────────────────────────────────────────

/**
 * Write a new project: `copy` a directory exactly (bytes and permission bits), then `write` files
 * from code. `write` comes after `copy`, so a `write` entry wins over a copied file at the same
 * path.
 *
 * `copy` resolution:
 * - `string` paths resolve from the current working directory, exactly like `dest`
 * - `URL` values must be `file:` URLs; use `new URL("../templates/base", import.meta.url)`
 *   for a directory shipped inside the generator package
 *
 * Every check runs before anything is deleted or written, and in a dry run.
 *
 * @param options - Scaffold configuration.
 * @returns Every written file path (or, with `dryRun`, every path that would be written),
 *   relative to the destination directory, sorted.
 * @throws When the directory to copy cannot be resolved, does not exist, or is not a directory.
 * @throws When there is nothing to write: the directory to copy is empty and `write` has no
 *   entries.
 * @throws When `dest` is empty, or a `write` key is absolute or leaves the destination.
 * @throws When a planned file is inside `.git`, two planned files differ only in letter case, or
 *   one planned file is the directory of another in any letter case.
 * @throws When a file to copy cannot be read.
 * @throws When `dest` exists and is not a directory.
 * @throws When `conflict` is `"abort"` and the destination holds anything besides `.git`.
 * @throws When `conflict` is `"replace"` and the directory to copy and the destination contain each
 *   other, or the destination is a filesystem root.
 * @throws When an existing destination file or ancestor directory is a symlink that
 *   resolves outside the destination (or to a missing target) or into its `.git`, regardless of
 *   `conflict`. A `dest` that is itself a symlink is followed once: its target is the destination.
 * @throws When `conflict` is `"overwrite"` and an existing directory stands where a file goes, or
 *   an existing file where a directory goes.
 *
 * @example
 * ```ts
 * import { scaffold } from "@crustjs/create";
 *
 * const result = await scaffold({
 *   copy: new URL("../templates/base", import.meta.url),
 *   dest: "./my-project",
 *   write: { "README.md": "# my-app\n" },
 * });
 *
 * console.log("Created files:", result.files);
 * ```
 */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
	const { copy, dest, write = {}, conflict = "abort", dryRun = false } = options;
	const destDir = resolvePathLike(dest);
	const copyDir = copy === undefined ? undefined : resolvePathLike(copy);

	// Each destination path maps to the file it copies, the text written from code, or both: then
	// the text wins and the copied file's mode is kept.
	const plan = new Map<string, { source?: string; text?: string }>();
	if (copyDir !== undefined) {
		const copyStat = statSync(copyDir, { throwIfNoEntry: false });
		if (!copyStat) {
			throw new Error(
				`Directory "${copyDir}" to copy does not exist (from copy: "${String(copy)}").`,
			);
		}
		if (!copyStat.isDirectory()) {
			throw new Error(
				`Path "${copyDir}" to copy is not a directory (from copy: "${String(copy)}").`,
			);
		}
		// Names, not Dirents: Yarn PnP's zip filesystem reports Dirent.parentPath as ".", which would
		// make every copied file resolve outside the destination. Descending only into what lstat
		// calls a directory skips symlinked files and directories alike.
		const walk = (relDir: string): void => {
			for (const name of readdirSync(join(copyDir, relDir))) {
				const relFromCopyDir = join(relDir, name);
				const source = join(copyDir, relFromCopyDir);
				const stat = lstatSync(source);
				if (stat.isDirectory()) walk(relFromCopyDir);
				else if (stat.isFile()) plan.set(renameDotfile(relFromCopyDir), { source });
			}
		};
		walk("");
	}
	for (const [key, text] of Object.entries(write)) {
		const relPath = writeKeyPath(destDir, key);
		plan.set(relPath, { ...plan.get(relPath), text });
	}
	if (plan.size === 0) {
		throw new Error(
			"Nothing to scaffold: the directory to copy has no files and `write` has no entries.",
		);
	}
	// Paths are compared in any letter case, as for .git, so the project fits a case-insensitive
	// filesystem.
	const folded = new Map<string, string>();
	for (const [relPath, { source, text }] of plan) {
		const other = folded.get(relPath.toLowerCase());
		if (other !== undefined) {
			throw new Error(`"${other}" and "${relPath}" differ only in letter case.`);
		}
		folded.set(relPath.toLowerCase(), relPath);
		if (source !== undefined && text === undefined) accessSync(source, constants.R_OK);
	}
	for (const relPath of plan.keys()) {
		if (isGitPath(relPath)) {
			throw new Error(`"${relPath}" is inside .git.`);
		}
		for (let dir = dirname(relPath); dir !== "."; dir = dirname(dir)) {
			const file = folded.get(dir.toLowerCase());
			if (file !== undefined) {
				throw new Error(`"${file}" cannot be both a file and the directory of "${relPath}".`);
			}
		}
	}

	const destStat = statSync(destDir, { throwIfNoEntry: false });
	if (destStat && !destStat.isDirectory()) {
		throw new Error(`Destination "${destDir}" exists and is not a directory.`);
	}
	const existing = destStat ? readdirSync(destDir).filter((name) => !isGitPath(name)) : [];
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
		if (conflict === "replace" && parse(realDestDir).root === realDestDir) {
			throw new Error(
				`Destination "${destDir}" is a filesystem root, and conflict: "replace" would delete everything in it.`,
			);
		}
		if (conflict === "replace" && copyDir !== undefined) {
			const realCopyDir = realpathSync(copyDir);
			if (isWithin(realDestDir, realCopyDir) || isWithin(realCopyDir, realDestDir)) {
				throw new Error(
					`Directory "${copyDir}" to copy and destination "${destDir}" overlap, and conflict: "replace" would delete files to copy before copying them.`,
				);
			}
		}
		for (const relPath of relPaths) {
			assertDestinationWritable(realDestDir, relPath, conflict !== "replace");
		}
	}
	if (dryRun) return { files: relPaths };

	// Every source is read before the first write: where the copied directory and the destination
	// overlap, a written file can be the source of a later one.
	const copies = relPaths.map((relPath) => {
		const { source, text } = plan.get(relPath)!;
		return {
			relPath,
			mode: source === undefined ? undefined : statSync(source).mode & 0o777,
			content: text ?? readFileSync(source!),
		};
	});
	if (conflict === "replace") {
		for (const name of existing) rmSync(join(destDir, name), { recursive: true, force: true });
	}
	mkdirSync(destDir, { recursive: true });
	const realDestDir = realpathSync(destDir);
	for (const { relPath, mode, content } of copies) {
		const destFilePath = join(realDestDir, relPath);
		mkdirSync(dirname(destFilePath), { recursive: true });
		// A file an earlier layer copied read-only is still replaced: opening it for writing needs the write bit.
		const old = statSync(destFilePath, { throwIfNoEntry: false });
		if (old && !(old.mode & 0o200)) chmodSync(destFilePath, old.mode | 0o200);
		if (mode === undefined) {
			writeFileSync(destFilePath, content);
			continue;
		}
		// Permission bits go on before the bytes, so a private file is never readable by others.
		const fd = openSync(destFilePath, "w", mode);
		try {
			fchmodSync(fd, mode);
			writeFileSync(fd, content);
		} finally {
			closeSync(fd);
		}
	}

	return { files: relPaths };
}
