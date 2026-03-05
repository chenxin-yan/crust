// ────────────────────────────────────────────────────────────────────────────
// Orchestration — install, uninstall, and status operations for agent skills
// ────────────────────────────────────────────────────────────────────────────

import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveAgentPath } from "./agents.ts";
import { SkillConflictError } from "./errors.ts";
import { buildManifest } from "./manifest.ts";
import { renderSkill } from "./render.ts";
import type {
	AgentResult,
	GenerateOptions,
	GenerateResult,
	InstallStatus,
	RenderedFile,
	SkillMeta,
	StatusOptions,
	StatusResult,
	UninstallOptions,
	UninstallResult,
} from "./types.ts";
import { CRUST_MANIFEST, readInstalledVersion } from "./version.ts";

// ────────────────────────────────────────────────────────────────────────────
// Naming — resolveSkillName and validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Agent Skills spec name pattern: 1–64 lowercase alphanumeric characters and
 * hyphens. Must not start or end with `-`, and must not contain consecutive `--`.
 */
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Validates a resolved skill name against the Agent Skills specification.
 *
 * @param name - The resolved skill name to validate (already has `use-` prefix)
 * @returns `true` if valid, `false` otherwise
 */
export function isValidSkillName(name: string): boolean {
	return name.length >= 1 && name.length <= 64 && SKILL_NAME_PATTERN.test(name);
}

/**
 * Resolves the canonical skill name by applying the `use-` prefix.
 *
 * All generated output (directory names, crust.json metadata, SKILL.md content)
 * uses the resolved name. Consumers pass the raw CLI name (e.g. `"my-cli"`),
 * and this function returns the prefixed form (e.g. `"use-my-cli"`).
 *
 * @param name - The raw CLI tool name
 * @returns The prefixed skill name
 *
 * @example
 * ```ts
 * resolveSkillName("my-cli"); // "use-my-cli"
 * ```
 */
export function resolveSkillName(name: string): string {
	return name.startsWith("use-") ? name : `use-${name}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — generateSkill
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generates and installs agent skill bundles from a Crust command tree.
 *
 * For each target agent:
 * 1. Resolves the output directory via {@link resolveAgentPath}
 * 2. Checks for conflicts — if the directory exists but has no `crust.json`,
 *    it was not created by Crust and a {@link SkillConflictError} is thrown
 * 3. Checks the installed version — skips if up-to-date
 * 4. Builds a canonical manifest from the command tree
 * 5. Renders markdown files + `crust.json`
 * 6. Writes files to the agent's skill directory
 *
 * @param options - Generation options including command, metadata, agents, and scope
 * @returns Per-agent installation results
 * @throws {SkillConflictError} If the output directory exists but was not created by Crust
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
	const {
		command,
		meta,
		agents,
		scope = "global",
		clean = true,
		force = false,
	} = options;

	// Apply `use-` prefix — do not mutate the caller's meta object
	const resolvedName = resolveSkillName(meta.name);

	// Validate resolved name against Agent Skills spec
	if (!isValidSkillName(resolvedName)) {
		throw new Error(
			`Invalid skill name "${resolvedName}": must be 1–64 lowercase ` +
				`alphanumeric characters and hyphens, no leading/trailing/consecutive ` +
				`hyphens. Pattern: ${SKILL_NAME_PATTERN.source}`,
		);
	}

	const resolvedMeta: SkillMeta = {
		...meta,
		name: resolvedName,
	};

	// Build manifest and render files once (shared across all agents)
	const manifest = buildManifest(command);
	const renderedFiles = renderSkill(manifest, resolvedMeta);
	const metadataFiles = renderDistributionMetadata(resolvedMeta);

	// Combine and sort for deterministic output
	const allFiles = [...renderedFiles, ...metadataFiles].sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	);

	const results: AgentResult[] = [];
	const groups = new Map<string, AgentResult["agent"][]>();
	for (const agent of agents) {
		const outputDir = resolveAgentPath(agent, scope, resolvedMeta.name);
		const existing = groups.get(outputDir);
		if (existing) {
			existing.push(agent);
		} else {
			groups.set(outputDir, [agent]);
		}
	}

	for (const [outputDir, groupedAgents] of groups) {
		const primaryAgent = groupedAgents[0];
		if (!primaryAgent) {
			continue;
		}

		// ── Conflict check ────────────────────────────────────────────
		// If the directory exists but has no crust.json, it was not
		// created by Crust — refuse to overwrite unless force is set.
		const installedVersion = await readInstalledVersion(outputDir);
		if (installedVersion === null) {
			const dirExists = await access(outputDir)
				.then(() => true)
				.catch(() => false);

			if (dirExists && !force) {
				throw new SkillConflictError({ agent: primaryAgent, outputDir });
			}
		}

		// ── Version check ─────────────────────────────────────────────
		const status: InstallStatus =
			installedVersion === null
				? "installed"
				: installedVersion === resolvedMeta.version
					? "up-to-date"
					: "updated";

		if (status === "up-to-date") {
			for (const agent of groupedAgents) {
				results.push({
					agent,
					outputDir,
					files: [],
					status: "up-to-date",
				});
			}
			continue;
		}

		const previousVersion =
			status === "updated" ? (installedVersion ?? undefined) : undefined;

		if (clean) {
			await cleanDirectory(outputDir);
		}

		await writeFiles(outputDir, allFiles);

		for (const agent of groupedAgents) {
			results.push({
				agent,
				outputDir,
				files: allFiles.map((f) => f.path),
				status,
				previousVersion,
			});
		}
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
	const resolvedName = resolveSkillName(name);
	const results: UninstallResult["agents"] = [];
	const groups = new Map<string, AgentResult["agent"][]>();
	for (const agent of agents) {
		const outputDir = resolveAgentPath(agent, scope, resolvedName);
		const existing = groups.get(outputDir);
		if (existing) {
			existing.push(agent);
		} else {
			groups.set(outputDir, [agent]);
		}
	}

	for (const [outputDir, groupedAgents] of groups) {
		const exists = await access(outputDir)
			.then(() => true)
			.catch(() => false);

		if (exists) {
			await rm(outputDir, { recursive: true, force: true });
			for (const agent of groupedAgents) {
				results.push({ agent, outputDir, status: "removed" });
			}
		} else {
			for (const agent of groupedAgents) {
				results.push({ agent, outputDir, status: "not-found" });
			}
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
	const resolvedName = resolveSkillName(name);
	const results: StatusResult["agents"] = [];
	const groups = new Map<string, AgentResult["agent"][]>();
	for (const agent of agents) {
		const outputDir = resolveAgentPath(agent, scope, resolvedName);
		const existing = groups.get(outputDir);
		if (existing) {
			existing.push(agent);
		} else {
			groups.set(outputDir, [agent]);
		}
	}

	for (const [outputDir, groupedAgents] of groups) {
		const version = await readInstalledVersion(outputDir);
		for (const agent of groupedAgents) {
			results.push({
				agent,
				outputDir,
				installed: version !== null,
				version: version ?? undefined,
			});
		}
	}

	return { agents: results };
}

// ────────────────────────────────────────────────────────────────────────────
// Distribution metadata renderers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Renders the Crust-specific metadata file (`crust.json`) that stores
 * version information for subsequent version checks and serves as an
 * ownership marker for conflict detection.
 *
 * @param manifest - The canonical manifest tree
 * @param meta - Skill metadata
 * @returns Array containing the crust.json rendered file
 */
function renderDistributionMetadata(meta: SkillMeta): RenderedFile[] {
	return [
		{
			path: CRUST_MANIFEST,
			content: renderCrustJson(meta),
		},
	];
}

/**
 * Renders `crust.json` — a machine-readable Crust metadata file
 * describing the skill bundle contents.
 *
 * The file is intentionally minimal and deterministic.
 */
function renderCrustJson(meta: SkillMeta): string {
	const obj: Record<string, unknown> = {
		name: meta.name,
		description: meta.description,
		version: meta.version,
	};

	return `${JSON.stringify(obj, null, "\t")}\n`;
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
