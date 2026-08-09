import { readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSourceDir } from "@crustjs/utils/source";

import { readInstalledManifestSync } from "./version.ts";

export class SkillSourceUnavailableError extends Error {
	override readonly name = "SkillSourceUnavailableError";
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

function directoryPathSync(path: string): string | null {
	try {
		return statSync(path).isDirectory() ? realpathSync(path) : null;
	} catch {
		return null;
	}
}

/** Resolves a packaged skill-source root synchronously for snapshot-time documentation. */
export function resolveSkillSourceSync(source: string | URL): string {
	let primary: string | undefined;
	try {
		primary = resolveSourceDir(source);
	} catch {
		// Relative paths may not have a package entrypoint in compiled executables.
	}
	if (primary) {
		const resolved = directoryPathSync(primary);
		if (resolved) return resolved;
	}

	const fallback = join(dirname(process.execPath), fallbackName(source));
	const resolvedFallback = directoryPathSync(fallback);
	if (resolvedFallback) return resolvedFallback;

	throw new SkillSourceUnavailableError(
		`Could not resolve skill source${primary ? ` at "${primary}"` : ""} or executable-relative fallback "${fallback}".`,
	);
}

/** Resolves a packaged skill-source root, including compiled executable staging. */
export async function resolveSkillSource(source: string | URL): Promise<string> {
	return resolveSkillSourceSync(source);
}

export interface PackagedSkill {
	readonly sourceDir: string;
	readonly name: string;
	readonly description: string;
	readonly version: string;
}

/** Reads every self-describing skill directory synchronously for snapshot-time documentation. */
export function loadPackagedSkillsSync(source: string | URL): readonly PackagedSkill[] {
	const root = resolveSkillSourceSync(source);
	const skills: PackagedSkill[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const sourceDir = join(root, entry.name);
		const manifest = readInstalledManifestSync(sourceDir);
		if (!manifest) {
			throw new Error(`Skill source directory "${sourceDir}" has no valid crust.json.`);
		}
		if (manifest.name !== entry.name) {
			throw new Error(
				`Skill source directory "${sourceDir}" declares name "${manifest.name}" in crust.json.`,
			);
		}
		skills.push({
			sourceDir,
			name: manifest.name,
			description: manifest.description,
			version: manifest.version,
		});
	}
	if (skills.length === 0) {
		throw new Error(`Skill source "${root}" does not contain any skill directories.`);
	}
	return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** Reads every self-describing skill directory in a packaged skill source. */
export async function loadPackagedSkills(source: string | URL): Promise<readonly PackagedSkill[]> {
	return loadPackagedSkillsSync(source);
}
