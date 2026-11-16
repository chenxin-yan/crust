import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

import type { Scope } from "./agents.ts";

/** Returns whether a symlink target carries Crust's skill ownership signature. */
export function isOwnedSkillLink(target: string, name: string): boolean {
	const segments = target.replaceAll("\\", "/").split("/").filter(Boolean);
	return segments.at(-2) === "skills" && segments.at(-1) === name;
}

export function skillLinkTarget(sourceDir: string, outputDir: string, scope: Scope): string {
	return scope === "project" ? relative(dirname(outputDir), sourceDir) : sourceDir;
}

/** @internal */
export function resolveEffectiveScope(scope: Scope): Scope {
	return scope === "project" && process.cwd() === homedir() ? "global" : scope;
}

/**
 * The shared `.agents/skills` folder: it holds the only link to the packaged skill, and
 * agents with a folder of their own link to it.
 *
 * @internal
 */
export function sharedSkillsDir(scope: Scope): string {
	return join(scope === "project" ? process.cwd() : homedir(), ".agents", "skills");
}
