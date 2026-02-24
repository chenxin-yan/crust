// ────────────────────────────────────────────────────────────────────────────
// Markdown renderers — produce distributable skill files from manifest
// ────────────────────────────────────────────────────────────────────────────

import type { ManifestNode, RenderedFile, SkillMeta } from "./types.ts";

/**
 * Renders a complete set of skill files from a manifest tree and metadata.
 *
 * Produces:
 * - `SKILL.md` — entrypoint with frontmatter and lazy-load instructions
 * - `command-index.md` — maps command paths to documentation file paths
 * - `commands/` — per-command markdown files mirroring the command hierarchy
 *
 * @param manifest - The canonical manifest tree from {@link buildManifest}
 * @param meta - Skill metadata for frontmatter and naming
 * @returns Array of rendered files ready for writing
 *
 * @example
 * ```ts
 * import { buildManifest, renderSkill } from "@crustjs/skills";
 *
 * const manifest = buildManifest(rootCommand);
 * const files = renderSkill(manifest, {
 *   name: "my-cli",
 *   description: "My CLI tool",
 * });
 * // files contains RenderedFile[] with paths like "SKILL.md", "commands/serve.md"
 * ```
 */
export function renderSkill(
	_manifest: ManifestNode,
	_meta: SkillMeta,
): RenderedFile[] {
	// TODO: Implement in task 3 — markdown renderers
	throw new Error("renderSkill is not yet implemented");
}
