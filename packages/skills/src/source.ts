import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSourceDir } from "@crustjs/utils/source";

import { probeFrontmatter } from "./bundle.ts";

export class SkillSourceUnavailableError extends Error {
	override readonly name = "SkillSourceUnavailableError";
}

async function directoryPath(path: string): Promise<string | null> {
	try {
		return (await stat(path)).isDirectory() ? path : null;
	} catch {
		return null;
	}
}

function fallbackName(source: string | URL): string {
	if (source instanceof URL) {
		if (source.protocol !== "file:") {
			throw new SkillSourceUnavailableError(
				`Skill source URL must use file: protocol, got "${source.protocol}".`,
			);
		}
		return basename(fileURLToPath(source));
	}
	return isAbsolute(source) ? basename(source) : source;
}

/** Resolves a packaged source root; compiled distributions must stage its basename beside the executable. */
export async function resolveSkillSource(source: string | URL): Promise<string> {
	let primary: string | undefined;
	try {
		primary = resolveSourceDir(source);
	} catch {
		// Relative paths may not have a package entrypoint in compiled executables.
	}
	if (primary) {
		const resolved = await directoryPath(primary);
		if (resolved) return resolved;
	}

	const fallback = join(dirname(process.execPath), fallbackName(source));
	const resolvedFallback = await directoryPath(fallback);
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

export async function readSkillFrontmatter(sourceDir: string): Promise<{
	readonly name: string;
	readonly description: string;
}> {
	let content: string;
	try {
		content = await readFile(join(sourceDir, "SKILL.md"), "utf8");
	} catch {
		throw new Error(`Skill source directory "${sourceDir}" is missing SKILL.md.`);
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
export async function loadPackagedSkills(source: string | URL): Promise<readonly PackagedSkill[]> {
	const root = await resolveSkillSource(source);
	const skills: PackagedSkill[] = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const sourceDir = join(root, entry.name);
		const frontmatter = await readSkillFrontmatter(sourceDir);
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
