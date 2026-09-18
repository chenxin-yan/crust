import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { CommandSnapshot } from "@crustjs/core";

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
export async function writeSkills({
	app,
	...options
}: WriteSkillsOptions): Promise<readonly string[]> {
	return await writeSkillSource(await app?.snapshot(), options);
}

/** Renders skills from a Command Snapshot prepared in this or another process. */
export async function writeSkillsFromSnapshot(
	snapshot: CommandSnapshot,
	options: Omit<WriteSkillsOptions, "app">,
): Promise<readonly string[]> {
	return await writeSkillSource(snapshot, options);
}

async function writeSkillSource(
	snapshot: CommandSnapshot | undefined,
	options: Omit<WriteSkillsOptions, "app">,
): Promise<readonly string[]> {
	const outDir = resolve(options.outDir);
	if (basename(outDir) !== "skills") {
		throw new Error(`Skill source outDir "${outDir}" must be named "skills".`);
	}
	const files = await renderSkills(snapshot, options);
	for (const file of files) {
		const filePath = join(outDir, file.path);
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, file.content);
	}
	return files.map((file) => file.path);
}

/**
 * Renders generated and authored skills as `<skill>/<file>` paths relative to a
 * `skills` directory, without writing them.
 */
export async function renderSkills(
	snapshot: CommandSnapshot | undefined,
	options: Omit<WriteSkillsOptions, "app" | "outDir">,
): Promise<readonly RenderedFile[]> {
	if (snapshot === undefined && (options.extras?.length ?? 0) === 0) {
		throw new Error("Nothing to write: provide an app or at least one extra skill directory.");
	}

	const skills = new Map<string, readonly RenderedFile[]>();
	const authoredNames = new Set<string>();

	for (const sourceDir of options.extras ?? []) {
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

	return [...skills].flatMap(([name, files]) =>
		files.map((file) => ({ path: join(name, file.path), content: file.content })),
	);
}

function validateSkillName(name: string): void {
	if (!isValidSkillName(name)) {
		throw new Error(
			`Invalid skill name "${name}": must be 1–64 lowercase alphanumeric characters and hyphens, no leading/trailing/consecutive hyphens.`,
		);
	}
}
