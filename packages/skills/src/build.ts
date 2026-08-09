import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { CommandSnapshot } from "@crustjs/core";

import { loadBundleFiles } from "./bundle.ts";
import { isValidSkillName } from "./generate.ts";
import { buildManifest } from "./manifest.ts";
import { renderDistributionMetadata } from "./metadata.ts";
import { renderSkill } from "./render.ts";
import type { RenderedFile, SkillKind, SkillMeta } from "./types.ts";

/** Options for rendering an application's skill source. */
export interface WriteSkillsOptions {
	/** Directory that receives one subdirectory per skill. */
	readonly outDir: string;
	/** Version recorded in every skill's `crust.json`. */
	readonly version: string;
	/** Generated skill name. Defaults to the root command name. */
	readonly name?: string;
	/** Generated skill description. Defaults to the root command description. */
	readonly description?: string;
	/** Hand-authored skill bundle directories to include. */
	readonly bundles?: readonly string[];
}

interface PreparedSkill {
	readonly meta: SkillMeta;
	readonly kind: SkillKind;
	readonly files: readonly RenderedFile[];
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

	const skills: PreparedSkill[] = [
		{
			meta: generatedMeta,
			kind: "generated",
			files: renderSkill(buildManifest(snapshot), generatedMeta),
		},
	];

	for (const sourceDir of options.bundles ?? []) {
		const bundle = await loadBundleFiles(sourceDir);
		validateSkillName(bundle.frontmatter.name);
		skills.push({
			meta: {
				name: bundle.frontmatter.name,
				description: bundle.frontmatter.description,
				version: options.version,
			},
			kind: "bundle",
			files: bundle.files,
		});
	}

	const names = new Set<string>();
	for (const skill of skills) {
		if (names.has(skill.meta.name)) {
			throw new Error(
				`Skill source name conflict: "${skill.meta.name}" is declared more than once.`,
			);
		}
		names.add(skill.meta.name);
	}

	const outDir = resolve(options.outDir);
	for (const skill of skills) {
		const skillDir = join(outDir, skill.meta.name);
		await rm(skillDir, { recursive: true, force: true });
		await writeFiles(skillDir, [
			...skill.files,
			renderDistributionMetadata(skill.meta, skill.kind),
		]);
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
	for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
		const filePath = join(baseDir, file.path);
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, file.content);
	}
}
