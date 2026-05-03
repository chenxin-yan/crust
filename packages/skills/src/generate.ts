// ────────────────────────────────────────────────────────────────────────────
// Orchestration — install, uninstall, and status operations for agent skills
// ────────────────────────────────────────────────────────────────────────────

import {
	lstat,
	mkdir,
	readlink,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	ALL_AGENTS,
	detectInstalledAgents,
	getUniversalAgents,
	resolveAgentPath,
	resolveCanonicalSkillPath,
} from "./agents.ts";
import { SkillConflictError } from "./errors.ts";
import { buildManifest } from "./manifest.ts";
import { renderSkill } from "./render.ts";
import type {
	AgentResult,
	AgentTarget,
	GenerateOptions,
	GenerateResult,
	InstallStatus,
	RenderedFile,
	Scope,
	SkillInstallMode,
	SkillMeta,
	StatusOptions,
	StatusResult,
	UninstallOptions,
	UninstallResult,
} from "./types.ts";
import { CRUST_MANIFEST, readInstalledVersion } from "./version.ts";

const DEFAULT_INSTALL_MODE: SkillInstallMode = "auto";

// ────────────────────────────────────────────────────────────────────────────
// Default agent resolution
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the agent list for `generateSkill` when the caller omits `agents`.
 *
 * Returns the union of universal agents and additional agents whose CLI is
 * detected on `PATH`. This matches the previous “manual” call-site recipe
 * shown in docs and keeps install behavior driven by what's actually
 * available on the current machine.
 *
 * `provided !== undefined` is checked instead of truthiness so that an
 * explicit empty array (`agents: []`) continues to mean “do nothing” — only
 * a missing/undefined field triggers the default.
 *
 * **Note:** Triggering the default performs filesystem I/O via
 * `detectInstalledAgents()` to probe `PATH`.
 */
async function resolveGenerateAgents(
	provided: AgentTarget[] | undefined,
): Promise<AgentTarget[]> {
	if (provided !== undefined) return provided;
	return [...getUniversalAgents(), ...(await detectInstalledAgents())];
}

/**
 * Resolves the agent list for `uninstallSkill` and `skillStatus` when the
 * caller omits `agents`.
 *
 * Returns every supported agent so the operation can sweep all known install
 * paths regardless of what is currently on `PATH`. This avoids cross-machine
 * drift (an additional agent installed on machine A would otherwise be
 * skipped on machine B if its CLI is not present), and matches how
 * canonical-store cleanup already iterates `ALL_AGENTS`.
 *
 * No filesystem I/O is performed during resolution — the entrypoints already
 * stat each per-agent path.
 *
 * `provided !== undefined` is checked instead of truthiness so that an
 * explicit empty array (`agents: []`) continues to mean “do nothing”.
 */
function resolveAllAgentTargets(
	provided: AgentTarget[] | undefined,
): AgentTarget[] {
	if (provided !== undefined) return provided;
	return [...ALL_AGENTS];
}

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
 * @param name - The resolved skill name to validate
 * @returns `true` if valid, `false` otherwise
 */
export function isValidSkillName(name: string): boolean {
	return name.length >= 1 && name.length <= 64 && SKILL_NAME_PATTERN.test(name);
}

/**
 * Resolves the canonical current skill name.
 *
 * All generated output (directory names, crust.json metadata, SKILL.md content)
 * uses the resolved name directly. Consumers pass the raw CLI name
 * (e.g. `"my-cli"`), and this function returns that same canonical name.
 *
 * @param name - The raw CLI tool name
 * @returns The canonical skill name
 *
 * @example
 * ```ts
 * resolveSkillName("my-cli"); // "my-cli"
 * ```
 */
export function resolveSkillName(name: string): string {
	return name;
}

// TODO:(v0.1.0) Remove legacy `use-*` skill name compatibility after the
// migration window for `use-<cli>` -> `<cli>` installs ends.
function resolveLegacySkillName(name: string): string {
	return name.startsWith("use-") ? name : `use-${name}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — generateSkill
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generates and installs agent skill bundles from a Crust command tree.
 *
 * The generator renders the bundle once into a canonical Crust store
 * (`.crust/skills` project scope, `~/.crust/skills` global scope), then
 * installs into agent-specific output paths using the configured install mode
 * (`auto`, `symlink`, `copy`).
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
		scope = "global",
		clean = true,
		force = false,
		installMode = DEFAULT_INSTALL_MODE,
	} = options;
	const agents = await resolveGenerateAgents(options.agents);

	// Resolve the canonical current name — do not mutate the caller's meta object
	const resolvedName = resolveSkillName(meta.name);
	const legacyResolvedName = resolveLegacySkillName(meta.name);

	// Validate resolved name against Agent Skills spec
	if (!isValidSkillName(resolvedName)) {
		throw new Error(
			`Invalid skill name "${resolvedName}": must be 1–64 lowercase ` +
				`alphanumeric characters and hyphens, no leading/trailing/consecutive ` +
				`hyphens. Pattern: ${SKILL_NAME_PATTERN.source}`,
		);
	}

	const primaryAgent = agents[0];
	if (!primaryAgent) {
		return { agents: [] };
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
	const allFilePaths = allFiles.map((file) => file.path);
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

	const canonicalOutputDir = resolveCanonicalSkillPath(
		scope,
		resolvedMeta.name,
	);
	const legacyCanonicalOutputDir = resolveCanonicalSkillPath(
		scope,
		legacyResolvedName,
	);
	const installStates = new Map<string, InstallLocationState>();
	for (const [outputDir, groupedAgents] of groups) {
		const groupedPrimaryAgent = groupedAgents[0];
		if (!groupedPrimaryAgent) {
			continue;
		}

		installStates.set(
			outputDir,
			await inspectInstallLocation({
				outputDir,
				legacyOutputDir: resolveAgentPath(
					groupedPrimaryAgent,
					scope,
					legacyResolvedName,
				),
				canonicalOutputDir,
				legacyCanonicalOutputDir,
			}),
		);
	}
	const canonicalVersion = await readInstalledVersion(canonicalOutputDir);
	const canonicalExists = (
		await inspectInstallPath(canonicalOutputDir, canonicalOutputDir)
	).exists;
	if (canonicalExists && canonicalVersion === null && !force) {
		throw new SkillConflictError({
			agent: primaryAgent,
			outputDir: canonicalOutputDir,
		});
	}

	// Compared against the pre-write snapshot. When true, all agents in the
	// loop below report "updated" (even symlinks with `pathChanged = false`)
	// because the canonical content they point to has changed.
	const canonicalChanged = canonicalVersion !== resolvedMeta.version;
	if (canonicalChanged) {
		if (clean) {
			await cleanDirectory(canonicalOutputDir);
		}

		await writeFiles(canonicalOutputDir, allFiles);
	}

	const results: AgentResult[] = [];

	for (const [outputDir, groupedAgents] of groups) {
		const groupedPrimaryAgent = groupedAgents[0];
		if (!groupedPrimaryAgent) {
			continue;
		}

		const state = installStates.get(outputDir);
		if (!state) {
			continue;
		}

		if (
			state.current.inspection.exists &&
			!state.current.isCrustManaged &&
			!force
		) {
			throw new SkillConflictError({
				agent: groupedPrimaryAgent,
				outputDir,
			});
		}

		const pathChanged = await ensureAgentInstallPath({
			outputDir,
			canonicalOutputDir,
			allFiles,
			clean,
			installMode,
			inspection: state.current.inspection,
			installedVersion: state.preferredVersion,
			currentVersion: resolvedMeta.version,
		});
		const legacyRemoved = await removeLegacyManagedPath(state);

		const status = computeInstallStatus({
			installedVersion: state.preferredVersion,
			currentVersion: resolvedMeta.version,
			canonicalChanged,
			pathChanged:
				pathChanged || legacyRemoved || state.preferredOutputDir !== outputDir,
		});

		for (const agent of groupedAgents) {
			results.push({
				agent,
				outputDir,
				files: status === "up-to-date" ? [] : allFilePaths,
				status,
				previousVersion:
					status === "updated"
						? (state.preferredVersion ?? undefined)
						: undefined,
			});
		}
	}

	{
		const legacyCanonicalVersion = await readInstalledVersion(
			legacyCanonicalOutputDir,
		);
		if (
			legacyCanonicalOutputDir !== canonicalOutputDir &&
			legacyCanonicalVersion !== null &&
			!(await hasAnyInstalledAgentPath(legacyResolvedName, scope))
		) {
			await rm(legacyCanonicalOutputDir, { recursive: true, force: true });
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
	const { name, scope = "global" } = options;
	const agents = resolveAllAgentTargets(options.agents);
	const resolvedName = resolveSkillName(name);
	const legacyResolvedName = resolveLegacySkillName(name);
	const canonicalOutputDir = resolveCanonicalSkillPath(scope, resolvedName);
	const legacyCanonicalOutputDir = resolveCanonicalSkillPath(
		scope,
		legacyResolvedName,
	);
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
		const groupedPrimaryAgent = groupedAgents[0];
		if (!groupedPrimaryAgent) {
			continue;
		}
		const legacyOutputDir = resolveAgentPath(
			groupedPrimaryAgent,
			scope,
			legacyResolvedName,
		);
		const state = await inspectInstallLocation({
			outputDir,
			legacyOutputDir,
			canonicalOutputDir,
			legacyCanonicalOutputDir,
		});

		const currentRemoved = await removeManagedPath(state.current);
		const legacyRemoved =
			state.legacy.outputDir !== state.current.outputDir
				? await removeManagedPath(state.legacy)
				: false;
		const removed = currentRemoved || legacyRemoved;
		const removedOutputDir = currentRemoved
			? outputDir
			: legacyRemoved
				? legacyOutputDir
				: outputDir;

		for (const agent of groupedAgents) {
			results.push({
				agent,
				outputDir: removedOutputDir,
				status: removed ? "removed" : "not-found",
			});
		}
	}

	{
		const canonicalVersion = await readInstalledVersion(canonicalOutputDir);
		if (
			canonicalVersion !== null &&
			!(await hasAnyInstalledAgentPath(resolvedName, scope))
		) {
			await rm(canonicalOutputDir, { recursive: true, force: true });
		}
	}
	{
		const legacyCanonicalVersion = await readInstalledVersion(
			legacyCanonicalOutputDir,
		);
		if (
			legacyCanonicalOutputDir !== canonicalOutputDir &&
			legacyCanonicalVersion !== null &&
			!(await hasAnyInstalledAgentPath(legacyResolvedName, scope))
		) {
			await rm(legacyCanonicalOutputDir, { recursive: true, force: true });
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
	const { name, scope = "global" } = options;
	const agents = resolveAllAgentTargets(options.agents);
	const resolvedName = resolveSkillName(name);
	const legacyResolvedName = resolveLegacySkillName(name);
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
		const groupedPrimaryAgent = groupedAgents[0];
		if (!groupedPrimaryAgent) {
			continue;
		}
		const legacyOutputDir = resolveAgentPath(
			groupedPrimaryAgent,
			scope,
			legacyResolvedName,
		);
		const canonicalOutputDir = resolveCanonicalSkillPath(scope, resolvedName);
		const legacyCanonicalOutputDir = resolveCanonicalSkillPath(
			scope,
			legacyResolvedName,
		);
		const state = await inspectInstallLocation({
			outputDir,
			legacyOutputDir,
			canonicalOutputDir,
			legacyCanonicalOutputDir,
		});
		const statusOutputDir = state.preferredOutputDir ?? outputDir;
		const version = state.preferredVersion;
		for (const agent of groupedAgents) {
			results.push({
				agent,
				outputDir: statusOutputDir,
				installed: version !== null,
				version: version ?? undefined,
			});
		}
	}

	return { agents: results };
}

interface InstallPathInspection {
	readonly exists: boolean;
	readonly isSymlink: boolean;
	readonly pointsToCanonical: boolean;
}

interface ManagedPathState {
	readonly outputDir: string;
	readonly version: string | null;
	readonly inspection: InstallPathInspection;
	readonly isCrustManaged: boolean;
}

interface InstallLocationState {
	readonly current: ManagedPathState;
	readonly legacy: ManagedPathState;
	readonly preferredVersion: string | null;
	readonly preferredOutputDir: string | null;
}

interface EnsureAgentInstallPathOptions {
	readonly outputDir: string;
	readonly canonicalOutputDir: string;
	readonly allFiles: RenderedFile[];
	readonly clean: boolean;
	readonly installMode: SkillInstallMode;
	readonly inspection: InstallPathInspection;
	readonly installedVersion: string | null;
	readonly currentVersion: string;
}

interface ComputeInstallStatusOptions {
	readonly installedVersion: string | null;
	readonly currentVersion: string;
	readonly canonicalChanged: boolean;
	readonly pathChanged: boolean;
}

function computeInstallStatus(
	options: ComputeInstallStatusOptions,
): InstallStatus {
	const { installedVersion, currentVersion, canonicalChanged, pathChanged } =
		options;

	if (installedVersion === null) {
		return "installed";
	}

	if (
		installedVersion === currentVersion &&
		!canonicalChanged &&
		!pathChanged
	) {
		return "up-to-date";
	}

	return "updated";
}

async function ensureAgentInstallPath(
	options: EnsureAgentInstallPathOptions,
): Promise<boolean> {
	const {
		outputDir,
		canonicalOutputDir,
		allFiles,
		clean,
		installMode,
		inspection,
		installedVersion,
		currentVersion,
	} = options;

	if (installMode === "copy") {
		return ensureCopyInstallPath({
			outputDir,
			allFiles,
			clean,
			inspection,
			installedVersion,
			currentVersion,
		});
	}

	try {
		return await ensureSymlinkInstallPath({
			outputDir,
			canonicalOutputDir,
			inspection,
		});
	} catch (err) {
		if (installMode === "symlink") {
			throw new Error(
				`Failed to create symlink at "${outputDir}" (installMode: symlink).`,
				{ cause: err },
			);
		}

		const fallbackInspection = await inspectInstallPath(
			outputDir,
			canonicalOutputDir,
		);

		return ensureCopyInstallPath({
			outputDir,
			allFiles,
			clean,
			inspection: fallbackInspection,
			installedVersion,
			currentVersion,
		});
	}
}

interface EnsureCopyInstallPathOptions {
	readonly outputDir: string;
	readonly allFiles: RenderedFile[];
	readonly clean: boolean;
	readonly inspection: InstallPathInspection;
	readonly installedVersion: string | null;
	readonly currentVersion: string;
}

async function ensureCopyInstallPath(
	options: EnsureCopyInstallPathOptions,
): Promise<boolean> {
	const {
		outputDir,
		allFiles,
		clean,
		inspection,
		installedVersion,
		currentVersion,
	} = options;

	const needsWrite =
		!inspection.exists ||
		inspection.isSymlink ||
		installedVersion !== currentVersion;
	if (!needsWrite) {
		return false;
	}

	if (inspection.isSymlink || clean) {
		await cleanDirectory(outputDir);
	}

	await writeFiles(outputDir, allFiles);
	return true;
}

interface EnsureSymlinkInstallPathOptions {
	readonly outputDir: string;
	readonly canonicalOutputDir: string;
	readonly inspection: InstallPathInspection;
}

async function ensureSymlinkInstallPath(
	options: EnsureSymlinkInstallPathOptions,
): Promise<boolean> {
	const { outputDir, canonicalOutputDir, inspection } = options;

	if (
		inspection.exists &&
		inspection.isSymlink &&
		inspection.pointsToCanonical
	) {
		return false;
	}

	if (inspection.exists) {
		await cleanDirectory(outputDir);
	}

	await createDirectorySymlink(canonicalOutputDir, outputDir);
	return true;
}

async function inspectInstallPath(
	outputDir: string,
	canonicalOutputDir: string,
): Promise<InstallPathInspection> {
	let stats: Awaited<ReturnType<typeof lstat>> | undefined;
	try {
		stats = await lstat(outputDir);
	} catch {
		return {
			exists: false,
			isSymlink: false,
			pointsToCanonical: false,
		};
	}

	// Detect Windows junctions: lstat reports isDirectory() but readlink succeeds
	const isJunction =
		process.platform === "win32" &&
		stats.isDirectory() &&
		(await safeReadlink(outputDir)) !== null;
	const isSymlink = stats.isSymbolicLink() || isJunction;
	if (!isSymlink) {
		return {
			exists: true,
			isSymlink: false,
			pointsToCanonical: false,
		};
	}

	const [outputRealPath, canonicalRealPath, linkTarget] = await Promise.all([
		safeRealpath(outputDir),
		safeRealpath(canonicalOutputDir),
		safeReadlink(outputDir),
	]);

	const resolvedMatch =
		outputRealPath !== null &&
		canonicalRealPath !== null &&
		outputRealPath === canonicalRealPath;
	// Also check the raw link target so dangling symlinks created by Crust
	// are still recognised as Crust-managed.
	// NOTE: For project scope, canonicalOutputDir is rooted at process.cwd().
	// If the project is re-run from a different working directory, this
	// comparison will fail and the symlink won't be recognised as Crust-managed.
	const rawTargetMatch = linkTarget === canonicalOutputDir;

	return {
		exists: true,
		isSymlink: true,
		pointsToCanonical: resolvedMatch || rawTargetMatch,
	};
}

async function inspectManagedPath(
	outputDir: string,
	canonicalOutputDir: string,
): Promise<ManagedPathState> {
	const [version, inspection] = await Promise.all([
		readInstalledVersion(outputDir),
		inspectInstallPath(outputDir, canonicalOutputDir),
	]);
	const isCrustManaged =
		version !== null ||
		(inspection.exists && inspection.isSymlink && inspection.pointsToCanonical);

	return {
		outputDir,
		version,
		inspection,
		isCrustManaged,
	};
}

interface InspectInstallLocationOptions {
	readonly outputDir: string;
	readonly legacyOutputDir: string;
	readonly canonicalOutputDir: string;
	readonly legacyCanonicalOutputDir: string;
}

async function inspectInstallLocation(
	options: InspectInstallLocationOptions,
): Promise<InstallLocationState> {
	const {
		outputDir,
		legacyOutputDir,
		canonicalOutputDir,
		legacyCanonicalOutputDir,
	} = options;

	const current = await inspectManagedPath(outputDir, canonicalOutputDir);
	const legacy =
		legacyOutputDir === outputDir
			? current
			: await inspectManagedPath(legacyOutputDir, legacyCanonicalOutputDir);

	if (current.isCrustManaged) {
		return {
			current,
			legacy,
			preferredVersion: current.version,
			preferredOutputDir: current.outputDir,
		};
	}

	if (legacy.isCrustManaged) {
		return {
			current,
			legacy,
			preferredVersion: legacy.version,
			preferredOutputDir: legacy.outputDir,
		};
	}

	return {
		current,
		legacy,
		preferredVersion: null,
		preferredOutputDir: null,
	};
}

async function removeManagedPath(state: ManagedPathState): Promise<boolean> {
	if (!state.isCrustManaged || !state.inspection.exists) {
		return false;
	}

	await rm(state.outputDir, { recursive: true, force: true });
	return true;
}

async function removeLegacyManagedPath(
	state: InstallLocationState,
): Promise<boolean> {
	if (state.legacy.outputDir === state.current.outputDir) {
		return false;
	}

	return removeManagedPath(state.legacy);
}

async function safeRealpath(path: string): Promise<string | null> {
	try {
		return await realpath(path);
	} catch {
		return null;
	}
}

async function safeReadlink(path: string): Promise<string | null> {
	try {
		return await readlink(path);
	} catch {
		return null;
	}
}

async function createDirectorySymlink(
	targetDir: string,
	symlinkPath: string,
): Promise<void> {
	await mkdir(dirname(symlinkPath), { recursive: true });
	const linkType = process.platform === "win32" ? "junction" : "dir";
	await symlink(targetDir, symlinkPath, linkType);
}

/**
 * Checks whether any agent path still has an installed skill bundle.
 *
 * Probes every possible output directory across **all** known agents (not just
 * the subset passed to `uninstallSkill`), so the canonical store is only
 * removed when truly nothing remains. Paths are deduplicated because universal
 * agents share a single directory — probing it once is sufficient.
 *
 * Works for both symlink and copy installs: symlink removal makes
 * `readInstalledVersion` return `null` (target unreachable), and copy removal
 * deletes the `crust.json` directly.
 */
async function hasAnyInstalledAgentPath(
	name: string,
	scope: Scope,
): Promise<boolean> {
	const uniquePaths = new Set<string>();
	for (const agent of ALL_AGENTS) {
		uniquePaths.add(resolveAgentPath(agent, scope, name));
	}

	for (const outputDir of uniquePaths) {
		if ((await readInstalledVersion(outputDir)) !== null) {
			return true;
		}
	}

	return false;
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
	const obj: Record<string, unknown> = {
		name: meta.name,
		description: meta.description,
		version: meta.version,
	};

	return [
		{
			path: CRUST_MANIFEST,
			content: `${JSON.stringify(obj, null, "\t")}\n`,
		},
	];
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
