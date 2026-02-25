// ────────────────────────────────────────────────────────────────────────────
// Orchestration — install, uninstall, and status operations for agent skills
// ────────────────────────────────────────────────────────────────────────────

import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveAgentPath } from "./agents.ts";
import { buildManifest } from "./manifest.ts";
import { renderSkill } from "./render.ts";
import type {
	AgentResult,
	GenerateOptions,
	GenerateResult,
	ManifestNode,
	RenderedFile,
	SkillMeta,
	StatusOptions,
	StatusResult,
	UninstallOptions,
	UninstallResult,
} from "./types.ts";
import { checkVersion, readInstalledVersion } from "./version.ts";

// ────────────────────────────────────────────────────────────────────────────
// Public API — generateSkill
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generates and installs agent skill bundles from a Crust command tree.
 *
 * For each target agent:
 * 1. Resolves the output directory via {@link resolveAgentPath}
 * 2. Checks the installed version — skips if up-to-date
 * 3. Builds a canonical manifest from the command tree
 * 4. Renders markdown files + `manifest.json`
 * 5. Writes files to the agent's skill directory
 *
 * @param options - Generation options including command, metadata, agents, and scope
 * @returns Per-agent installation results
 *
 * @example
 * ```ts
 * import { generateSkill } from "@crustjs/skills";
 * import { rootCommand } from "./commands.ts";
 *
 * const result = await generateSkill({
 *   command: rootCommand,
 *   meta: {
 *     name: "my-cli",
 *     description: "CLI tool for managing widgets",
 *     version: "1.0.0",
 *   },
 *   agents: ["claude-code", "opencode"],
 * });
 *
 * for (const r of result.agents) {
 *   console.log(`${r.agent}: ${r.status} → ${r.outputDir}`);
 * }
 * ```
 */
export async function generateSkill(
	options: GenerateOptions,
): Promise<GenerateResult> {
	const { command, meta, agents, scope = "global", clean = true } = options;

	// Build manifest and render files once (shared across all agents)
	const manifest = buildManifest(command);
	const renderedFiles = renderSkill(manifest, meta);
	const metadataFiles = renderDistributionMetadata(manifest, meta);

	// Combine and sort for deterministic output
	const allFiles = [...renderedFiles, ...metadataFiles].sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	);

	const results: AgentResult[] = [];

	for (const agent of agents) {
		const outputDir = resolveAgentPath(agent, scope, meta.name);
		const { status, installedVersion } = await checkVersion(
			outputDir,
			meta.version,
		);

		if (status === "up-to-date") {
			results.push({
				agent,
				outputDir,
				files: [],
				status: "up-to-date",
			});
			continue;
		}

		const previousVersion =
			status === "updated" ? (installedVersion ?? undefined) : undefined;

		if (clean) {
			await cleanDirectory(outputDir);
		}

		await writeFiles(outputDir, allFiles);

		results.push({
			agent,
			outputDir,
			files: allFiles.map((f) => f.path),
			status,
			previousVersion,
		});
	}

	return { agents: results };
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — uninstallSkill
// ────────────────────────────────────────────────────────────────────────────

/**
 * Removes installed skills from agent directories.
 *
 * @param options - Uninstall options specifying name, agents, and scope
 * @returns Per-agent uninstall results
 */
export async function uninstallSkill(
	options: UninstallOptions,
): Promise<UninstallResult> {
	const { name, agents, scope = "global" } = options;
	const results: UninstallResult["agents"] = [];

	for (const agent of agents) {
		const outputDir = resolveAgentPath(agent, scope, name);

		const exists = await access(outputDir)
			.then(() => true)
			.catch(() => false);

		if (exists) {
			await rm(outputDir, { recursive: true, force: true });
			results.push({ agent, outputDir, status: "removed" });
		} else {
			results.push({ agent, outputDir, status: "not-found" });
		}
	}

	return { agents: results };
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — skillStatus
// ────────────────────────────────────────────────────────────────────────────

/**
 * Checks the installation status of skills across agent directories.
 *
 * @param options - Status options specifying name, agents, and scope
 * @returns Per-agent status results
 */
export async function skillStatus(
	options: StatusOptions,
): Promise<StatusResult> {
	const { name, agents, scope = "global" } = options;
	const results: StatusResult["agents"] = [];

	for (const agent of agents) {
		const outputDir = resolveAgentPath(agent, scope, name);
		const version = await readInstalledVersion(outputDir);

		results.push({
			agent,
			outputDir,
			installed: version !== null,
			version: version ?? undefined,
		});
	}

	return { agents: results };
}

// ────────────────────────────────────────────────────────────────────────────
// Distribution metadata renderers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Renders distribution metadata file (`manifest.json`) that stores
 * version information for subsequent version checks.
 *
 * @param manifest - The canonical manifest tree
 * @param meta - Skill metadata
 * @returns Array containing the manifest.json rendered file
 */
function renderDistributionMetadata(
	manifest: ManifestNode,
	meta: SkillMeta,
): RenderedFile[] {
	return [
		{
			path: "manifest.json",
			content: renderManifestJson(manifest, meta),
		},
	];
}

/**
 * Renders `manifest.json` — a machine-readable distribution manifest
 * describing the skill bundle contents.
 *
 * The manifest is sorted deterministically: top-level keys in a stable
 * order, and the `commands` array sorted alphabetically.
 */
function renderManifestJson(manifest: ManifestNode, meta: SkillMeta): string {
	const commands = collectCommandPaths(manifest);

	const obj: Record<string, unknown> = {
		name: meta.name,
		description: meta.description,
		version: meta.version,
		entrypoint: "SKILL.md",
		commands,
	};

	return `${JSON.stringify(obj, null, "\t")}\n`;
}

/**
 * Collects all command invocation paths from the manifest tree.
 * Used in `manifest.json` to list available commands.
 */
function collectCommandPaths(node: ManifestNode): string[] {
	const paths: string[] = [node.path.join(" ")];
	for (const child of node.children) {
		paths.push(...collectCommandPaths(child));
	}
	return paths;
}

// ────────────────────────────────────────────────────────────────────────────
// File system operations
// ────────────────────────────────────────────────────────────────────────────

/**
 * Removes a directory and all its contents if it exists.
 * Silently succeeds if the directory does not exist.
 */
async function cleanDirectory(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true });
}

/**
 * Writes an array of rendered files to disk under the given base directory.
 *
 * Creates parent directories as needed. Files are written sequentially
 * in sorted order for deterministic behavior.
 */
async function writeFiles(
	baseDir: string,
	files: RenderedFile[],
): Promise<void> {
	// Collect all unique directories first and create them
	const dirs = new Set<string>();
	for (const file of files) {
		const filePath = join(baseDir, file.path);
		const dir = dirname(filePath);
		dirs.add(dir);
	}

	// Sort directories to create parents before children
	const sortedDirs = [...dirs].sort();
	for (const dir of sortedDirs) {
		await mkdir(dir, { recursive: true });
	}

	// Write files sequentially in deterministic order (already sorted by caller)
	for (const file of files) {
		const filePath = join(baseDir, file.path);
		await writeFile(filePath, file.content, "utf-8");
	}
}
