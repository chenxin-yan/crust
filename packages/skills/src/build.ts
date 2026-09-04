import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { CommandSnapshot } from "@crustjs/core";
import { isWithin } from "@crustjs/utils/path";
import { resolveSourceDir } from "@crustjs/utils/source";

import { loadBundleFiles, requireSkillFrontmatter } from "./bundle.ts";
import { SkillSourceConflictError } from "./errors.ts";
import { buildManifest } from "./manifest.ts";
import { renderSkill } from "./render.ts";
import { isValidSkillName } from "./skill-name.ts";
import type { RenderedFile, SkillMeta } from "./types.ts";

/** Options for rendering a skill source. */
export interface WriteSkillsOptions {
	/** Application whose command tree is rendered into a generated skill. Omit to write only `extras`. */
	readonly app?: { snapshot(): Promise<CommandSnapshot> };
	/** `skills` directory that receives one subdirectory per skill. */
	readonly outDir: string;
	/** Version recorded in the generated skill's SKILL.md metadata. Omitted when absent. */
	readonly version?: string;
	/** Generated skill name. Defaults to the root command name. */
	readonly name?: string;
	/** Generated skill description. Defaults to the root command description. */
	readonly description?: string;
	/** Hand-authored skill directories included alongside the generated skill. */
	readonly extras?: readonly (string | URL)[];
}

/**
 * Renders generated and authored skills into a package-ready skill source.
 */
export async function writeSkills({ app, ...options }: WriteSkillsOptions): Promise<void> {
	await writeSkillSource(await app?.snapshot(), options);
}

/** Renders skills from a Command Snapshot prepared in this or another process. */
export async function writeSkillsFromSnapshot(
	snapshot: CommandSnapshot,
	options: Omit<WriteSkillsOptions, "app">,
): Promise<void> {
	await writeSkillSource(snapshot, options);
}

async function writeSkillSource(
	snapshot: CommandSnapshot | undefined,
	options: Omit<WriteSkillsOptions, "app">,
): Promise<void> {
	if (snapshot === undefined && (options.extras?.length ?? 0) === 0) {
		throw new Error("Nothing to write: provide an app or at least one extra skill directory.");
	}
	const outDir = resolve(options.outDir);
	if (basename(outDir) !== "skills") {
		throw new Error(`Skill source outDir "${outDir}" must be named "skills".`);
	}

	const skills = new Map<string, readonly RenderedFile[]>();
	const authoredNames = new Set<string>();

	for (const sourceDir of options.extras ?? []) {
		const resolved = resolveSourceDir(sourceDir);
		// outDir is replaced wholesale below; an extra nested inside it would be destroyed.
		if (isWithin(outDir, resolved)) {
			throw new Error(
				`Extra skill directory "${resolved}" is inside outDir "${outDir}", which is replaced on every build. Move authored skills outside the build output.`,
			);
		}
		const bundle = await loadBundleFiles(sourceDir);
		validateSkillName(bundle.frontmatter.name);
		if (authoredNames.has(bundle.frontmatter.name)) {
			throw new SkillSourceConflictError(bundle.frontmatter.name);
		}
		authoredNames.add(bundle.frontmatter.name);
		skills.set(bundle.frontmatter.name, bundle.files);
	}

	if (snapshot) {
		const generatedMeta: SkillMeta = {
			name: options.name ?? snapshot.meta.name,
			description: options.description ?? snapshot.meta.description ?? "",
			version: options.version,
		};
		// An authored skill may intentionally replace the same-named generated command skill;
		// a replaced skill is neither validated nor rendered.
		if (!authoredNames.has(generatedMeta.name)) {
			validateSkillName(generatedMeta.name);
			requireSkillFrontmatter(generatedMeta, `Skill "${generatedMeta.name}"`);
			skills.set(generatedMeta.name, renderSkill(buildManifest(snapshot), generatedMeta));
		}
	}

	const cwd = resolve(".");
	// outDir is replaced wholesale below; refuse targets that would delete the caller's project.
	if (outDir === dirname(outDir) || isWithin(outDir, cwd)) {
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
