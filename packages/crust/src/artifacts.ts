import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { isWithin } from "@crustjs/utils/path";

/**
 * `crust.include` directories normalized to cwd-relative POSIX names. They are
 * staged exactly like Extension artifacts.
 */
export function collectIncludeDirs(
	cwd: string,
	stageDir: string,
	include: readonly string[],
	artifactNames: readonly string[],
): string[] {
	const names = [...artifactNames];
	const includeDirs: string[] = [];
	for (const entry of include) {
		const dir = resolve(cwd, entry);
		const name = relative(cwd, dir);
		if (isAbsolute(entry) || name === "" || !isWithin(cwd, dir)) {
			throw new Error(
				`package.json crust.include entry ${JSON.stringify(entry)} must be a directory inside the project root ${cwd}.`,
			);
		}
		if (!existsSync(dir) || !statSync(dir).isDirectory()) {
			throw new Error(
				`package.json crust.include entry ${JSON.stringify(entry)} is not a directory: ${dir}`,
			);
		}
		// The lexical check above passes a symlink to anywhere, and the staged copy
		// dereferences every symlink it meets, so the directory and everything
		// reachable inside it must really live inside the project too.
		assertResolvesInsideProject(cwd, entry, dir);
		// The build wipes stageDir first, and copying a directory into itself fails midway.
		if (isWithin(stageDir, dir) || isWithin(dir, stageDir)) {
			throw new Error(
				`package.json crust.include entry ${JSON.stringify(entry)} overlaps the build output directory ${stageDir}, which crust build replaces.`,
			);
		}
		// Staged names are compared case-folded: on a case-insensitive destination
		// `Bin` or `Assets` addresses the same directory as `bin` or `assets`.
		if (name.toLowerCase().split(sep)[0] === "bin") {
			throw new Error(
				`package.json crust.include entry ${JSON.stringify(entry)} conflicts with the generated npm bin directory.\n  Include a directory with a different top-level name.`,
			);
		}
		const posixName = name.replaceAll(sep, "/");
		const key = posixName.toLowerCase();
		// A nested include under an artifact name (or vice versa) would silently merge into it.
		const overlap = names.find((staged) => {
			const stagedKey = staged.toLowerCase();
			return (
				stagedKey === key || stagedKey.startsWith(`${key}/`) || key.startsWith(`${stagedKey}/`)
			);
		});
		if (overlap !== undefined) {
			throw new Error(
				`package.json crust.include entry ${JSON.stringify(entry)} overlaps "${overlap}", which is already staged (duplicate include or Extension artifact directory).`,
			);
		}
		names.push(posixName);
		includeDirs.push(posixName);
	}
	return includeDirs;
}

/**
 * Walks `dir` the way the dereferencing copy will (through symlinked
 * directories) and rejects any path whose real location leaves the project.
 */
function assertResolvesInsideProject(cwd: string, entry: string, dir: string): void {
	const realCwd = realpathSync(cwd);
	const seen = new Set<string>();
	const walk = (path: string): void => {
		const real = realpathSync(path);
		if (!isWithin(realCwd, real)) {
			throw new Error(
				`package.json crust.include entry ${JSON.stringify(entry)} resolves outside the project root: ${relative(cwd, path)} -> ${real}`,
			);
		}
		// A symlink back to an ancestor would otherwise recurse forever.
		if (seen.has(real) || !statSync(path).isDirectory()) return;
		seen.add(real);
		for (const child of readdirSync(path)) walk(join(path, child));
	};
	walk(dir);
}

export type ArtifactOwner = { command: string; directory: boolean; path: string };

/**
 * Copies one entry's Extension build hook output into the shared artifact
 * directory. Identically spelled directories merge; case-only directory aliases
 * and a file or file/directory mismatch at a path
 * another entry already produced is an error, so no entry's hooks can replace
 * another's output. `owners` tracks case-folded POSIX-relative paths across
 * entries, including directories so file/ancestor conflicts are portable.
 */
export function mergeEntryArtifacts(
	entryOutDir: string,
	artifactDir: string,
	command: string,
	owners: Map<string, ArtifactOwner>,
): void {
	const merge = (relativeDir: string): void => {
		for (const dirent of readdirSync(join(entryOutDir, relativeDir), { withFileTypes: true })) {
			const relativePath = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name;
			if (!dirent.isDirectory() && !dirent.isFile()) {
				throw new Error(
					`Build artifact "${relativePath}" from bin ${JSON.stringify(command)} must use regular files and directories, not symlinks or other file types.`,
				);
			}
			const source = join(entryOutDir, relativePath);
			const destination = join(artifactDir, relativePath);
			const key = relativePath.toLowerCase();
			const owner = owners.get(key);
			const existing = lstatSync(destination, { throwIfNoEntry: false });
			if (
				(owner && !(dirent.isDirectory() && owner.directory && owner.path === relativePath)) ||
				(existing && !(dirent.isDirectory() && existing.isDirectory()))
			) {
				throw new Error(
					`Build artifact "${relativePath}" is written by both bin ${JSON.stringify(owner?.command ?? "an earlier bin")} and ${JSON.stringify(command)}.\n  Extension build hooks of different commands must write distinct paths under ${artifactDir}.`,
				);
			}
			if (!owner) owners.set(key, { command, directory: dirent.isDirectory(), path: relativePath });
			if (dirent.isDirectory()) {
				mkdirSync(destination, { recursive: true });
				merge(relativePath);
			} else {
				mkdirSync(dirname(destination), { recursive: true });
				copyFileSync(source, destination);
			}
		}
	};
	const root = lstatSync(entryOutDir, { throwIfNoEntry: false });
	if (root === undefined) return;
	if (!root.isDirectory()) {
		throw new Error(
			`Build artifact directory for bin ${JSON.stringify(command)} must be a directory, not a symlink or other file type: ${entryOutDir}`,
		);
	}
	merge("");
}

type CollectedArtifacts = { names: string[]; manPages: string[] };

export function collectArtifacts(artifactOutDir: string | undefined): CollectedArtifacts {
	if (!artifactOutDir || !existsSync(artifactOutDir)) {
		return { names: [], manPages: [] };
	}

	// Hooks own unique top-level directories; loose files are ignored. Staged
	// builds clear previous output before hooks run.
	const names = readdirSync(artifactOutDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	// Staged packages generate their own bin/ (resolver + platform binaries); a
	// hook artifact named bin (in any case, for case-insensitive destinations)
	// would merge into it and could overwrite them.
	const binName = names.find((name) => name.toLowerCase() === "bin");
	if (binName !== undefined) {
		throw new Error(
			`Artifact directory "${binName}" in ${artifactOutDir} conflicts with the generated npm bin directory.\n  Emit build artifacts under a different top-level name.`,
		);
	}
	const manPages = names.includes("man")
		? readdirSync(join(artifactOutDir, "man"), { withFileTypes: true })
				.filter((entry) => entry.isFile())
				.map((entry) => entry.name)
				.sort()
		: [];

	return { names, manPages };
}
