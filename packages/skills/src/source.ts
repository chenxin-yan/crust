import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSourceDir } from "@crustjs/utils/source";

import { probeFrontmatter } from "./bundle.ts";
import { isErrnoException } from "./errno.ts";

export class SkillSourceUnavailableError extends Error {
	override readonly name = "SkillSourceUnavailableError";
}

function directoryPath(path: string): string | null {
	try {
		return statSync(path).isDirectory() ? path : null;
	} catch {
		// ENOENT/EACCES: an absent or unreadable candidate is not a source root; the
		// caller falls through to the next candidate or a clear unavailable error.
		return null;
	}
}

function fallbackName(source: string | URL): string {
	if (source instanceof URL) return basename(fileURLToPath(source));
	return isAbsolute(source) ? basename(source) : source;
}

/**
 * Resolves a logical packaged skill-source root. When the package path is
 * unavailable, falls back to the executable directory: absolute and URL
 * sources by their basename, relative sources by the same relative path.
 */
export function resolveSkillSource(source: string | URL): string {
	if (source instanceof URL && source.protocol !== "file:") {
		// A wrong-protocol URL is a definition error, not a missing asset; validating
		// before resolution keeps it out of the catch below so it is never classified
		// as "unavailable" and silently degrades the extension.
		throw new Error(`Skill source URL must use file: protocol, got "${source.protocol}".`);
	}
	let primary: string | undefined;
	try {
		primary = resolveSourceDir(source);
	} catch {
		// Relative paths may not have a package entrypoint in compiled executables.
	}
	if (primary) {
		const resolved = directoryPath(primary);
		if (resolved) return resolved;
	}

	const fallback = join(dirname(process.execPath), fallbackName(source));
	const resolvedFallback = directoryPath(fallback);
	if (resolvedFallback) return resolvedFallback;

	throw new SkillSourceUnavailableError(
		`Could not resolve skill source${primary ? ` at "${primary}"` : ""} or executable-relative fallback "${fallback}".`,
	);
}

export interface PackagedSkill {
	readonly sourceDir: string;
	readonly name: string;
	readonly description: string;
}

export function readSkillFrontmatter(
	sourceDir: string,
): Pick<PackagedSkill, "name" | "description"> {
	let content: string;
	try {
		content = readFileSync(join(sourceDir, "SKILL.md"), "utf8");
	} catch (error) {
		// ENOENT: the directory is not a skill; anything else (EACCES, EISDIR) is unexpected.
		if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
		throw new Error(`Skill source directory "${sourceDir}" is missing SKILL.md.`, { cause: error });
	}
	const frontmatter = probeFrontmatter(content);
	if (!frontmatter.name || !frontmatter.description) {
		throw new Error(
			`Skill source directory "${sourceDir}" requires name and description in SKILL.md frontmatter.`,
		);
	}
	return { name: frontmatter.name, description: frontmatter.description };
}

/** Reads every self-describing skill directory in a packaged skill source. */
export function loadPackagedSkills(source: string | URL): readonly PackagedSkill[] {
	const root = resolveSkillSource(source);
	const skills: PackagedSkill[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const sourceDir = join(root, entry.name);
		// Cruft directories (__MACOSX, editor droppings) must not take down every
		// valid skill; only a directory that claims to be a skill is validated.
		if (!existsSync(join(sourceDir, "SKILL.md"))) continue;
		const frontmatter = readSkillFrontmatter(sourceDir);
		if (frontmatter.name !== entry.name) {
			throw new Error(
				`Skill source directory "${sourceDir}" declares name "${frontmatter.name}" in SKILL.md.`,
			);
		}
		skills.push({ sourceDir, name: frontmatter.name, description: frontmatter.description });
	}
	if (skills.length === 0) {
		throw new Error(`Skill source "${root}" does not contain any skill directories.`);
	}
	return skills.sort((a, b) => a.name.localeCompare(b.name));
}
