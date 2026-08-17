import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

import type { CommandSnapshot } from "@crustjs/core";

import { loadBundleFiles } from "./bundle.ts";
import { SkillSourceConflictError } from "./errors.ts";
import { buildManifest } from "./manifest.ts";
import { renderSkill } from "./render.ts";
import { isValidSkillName } from "./skill-name.ts";
import type { RenderedFile, SkillMeta } from "./types.ts";

/** Options for rendering an application's skill source. */
export interface WriteSkillsOptions {
	/** `skills` directory that receives one subdirectory per skill. */
	readonly outDir: string;
	/** Version recorded in the generated skill's SKILL.md metadata. Omitted when absent. */
	readonly version?: string;
	/** Generated skill name. Defaults to the root command name. */
	readonly name?: string;
	/** Generated skill description. Defaults to the root command description. */
	readonly description?: string;
	/** Hand-authored skill directories included alongside the generated skill. */
	readonly extras?: readonly string[];
}

/**
 * Renders an application's generated and authored skills into a package-ready skill source.
 */
export async function writeSkills(
	app: { snapshot(): Promise<CommandSnapshot> },
	options: WriteSkillsOptions,
): Promise<void> {
	const snapshot = await app.snapshot();
	const generatedMeta: SkillMeta = {
		name: options.name ?? snapshot.meta.name,
		description: options.description ?? snapshot.meta.description ?? "",
		version: options.version,
	};
	validateSkillName(generatedMeta.name);
	if (generatedMeta.description.trim() === "") {
		throw new Error(
			`Skill "${generatedMeta.name}" requires a description for SKILL.md frontmatter.`,
		);
	}

	const outDir = resolve(options.outDir);
	if (basename(outDir) !== "skills") {
		throw new Error(`Skill source outDir "${outDir}" must be named "skills".`);
	}

	const skills = new Map<string, readonly RenderedFile[]>([
		[generatedMeta.name, renderSkill(buildManifest(snapshot), generatedMeta)],
	]);

	for (const sourceDir of options.extras ?? []) {
		const bundle = await loadBundleFiles(sourceDir);
		validateSkillName(bundle.frontmatter.name);
		if (skills.has(bundle.frontmatter.name)) {
			throw new SkillSourceConflictError(bundle.frontmatter.name);
		}
		skills.set(bundle.frontmatter.name, bundle.files);
	}

	const cwd = resolve(".");
	// outDir is replaced wholesale below; refuse targets that would delete the caller's project.
	if (outDir === dirname(outDir) || outDir === cwd || cwd.startsWith(outDir + sep)) {
		throw new Error(
			`Refusing to replace "${outDir}": outDir must be a dedicated directory, not the filesystem root, the working directory, or an ancestor of it.`,
		);
	}
	await rm(outDir, { recursive: true, force: true });
	for (const [name, files] of skills) {
		await writeFiles(join(outDir, name), files);
	}
}

function validateSkillName(name: string): void {
	if (!isValidSkillName(name)) {
		throw new Error(
			`Invalid skill name "${name}": must be 1–64 lowercase alphanumeric characters and hyphens, no leading/trailing/consecutive hyphens.`,
		);
	}
}

async function writeFiles(baseDir: string, files: readonly RenderedFile[]): Promise<void> {
	for (const file of files) {
		const filePath = join(baseDir, file.path);
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, file.content);
	}
}
