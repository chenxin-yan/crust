import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isErrnoException } from "@crustjs/utils/error";

import { probeFrontmatter, requireSkillFrontmatter } from "./bundle.ts";

/** The packaged skills root is missing or holds no skills: the CLI has not been built yet. */
export class SkillSourceUnavailableError extends Error {
	override readonly name = "SkillSourceUnavailableError";
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
	return requireSkillFrontmatter(
		probeFrontmatter(content),
		`Skill source directory "${sourceDir}"`,
	);
}

/**
 * Reads every self-describing skill directory under `root`, the absolute
 * packaged skills directory (normally `resolveArtifactDir("skills")`).
 */
export function loadPackagedSkills(root: string): readonly PackagedSkill[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch (error) {
		// ENOENT/ENOTDIR: not built yet; help and auto-repair degrade on this typed
		// error. Anything else (EACCES) is a real read failure and surfaces as-is.
		if (!isErrnoException(error) || (error.code !== "ENOENT" && error.code !== "ENOTDIR")) {
			throw error;
		}
		throw new SkillSourceUnavailableError(
			`Packaged skills not found at "${root}". Run \`crust build\` first.`,
			{ cause: error },
		);
	}
	const skills: PackagedSkill[] = [];
	for (const entry of entries) {
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
		throw new SkillSourceUnavailableError(
			`Packaged skills at "${root}" do not contain any skill directories. Run \`crust build\` first.`,
		);
	}
	return skills.sort((a, b) => a.name.localeCompare(b.name));
}
