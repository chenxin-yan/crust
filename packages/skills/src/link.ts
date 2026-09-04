import { dirname, relative } from "node:path";

import type { Scope } from "./types.ts";

/** Returns whether a symlink target carries Crust's skill ownership signature. */
export function isOwnedSkillLink(target: string, name: string): boolean {
	const segments = target.replaceAll("\\", "/").split("/").filter(Boolean);
	return segments.at(-2) === "skills" && segments.at(-1) === name;
}

export function skillLinkTarget(sourceDir: string, outputDir: string, scope: Scope): string {
	return scope === "project" ? relative(dirname(outputDir), sourceDir) : sourceDir;
}
