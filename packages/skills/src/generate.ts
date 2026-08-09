// ────────────────────────────────────────────────────────────────────────────
// Orchestration — install, uninstall, and status operations for agent skills
// ────────────────────────────────────────────────────────────────────────────

import { lstat, mkdir, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
	ALL_AGENTS,
	detectInstalledAgents,
	getUniversalAgents,
	resolveAgentPath,
	resolveCanonicalSkillPath,
} from "./agents.ts";
import type { SkillManifestMalformed } from "./errors.ts";
import { SkillConflictError } from "./errors.ts";
import { buildManifest } from "./manifest.ts";
import { renderDistributionMetadata } from "./metadata.ts";
import { renderSkill } from "./render.ts";
import { SKILL_NAME_PATTERN, isValidSkillName } from "./skill-name.ts";
import type {
	AgentResult,
	AgentTarget,
	GenerateSkillOptions,
	GenerateSkillResult,
	InstallStatus,
	RenderedFile,
	Scope,
	SkillInstallMode,
	SkillKind,
	SkillMeta,
	SkillStatusOptions,
	SkillStatusResult,
	UninstallSkillOptions,
	UninstallSkillResult,
} from "./types.ts";
import {
	type InstalledManifestStatus,
	type InstalledSkillManifest,
	inspectInstalledManifest,
	readInstalledManifest,
} from "./version.ts";

const DEFAULT_INSTALL_MODE: SkillInstallMode = "auto";

function groupAgentsByOutputDir(
	agents: AgentTarget[],
	scope: Scope,
	name: string,
): Map<string, AgentTarget[]> {
	return Map.groupBy(agents, (agent) => resolveAgentPath(agent, scope, name));
}

export { isValidSkillName } from "./skill-name.ts";

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
 * @throws {SkillConflictError} If the output directory conflicts (no `crust.json`, malformed `crust.json`, or kind mismatch) and `force` is not set
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
export async function generateSkill(options: GenerateSkillOptions): Promise<GenerateSkillResult> {
	const {
		command,
		meta,
		scope = "global",
		clean = true,
		force = false,
		installMode = DEFAULT_INSTALL_MODE,
	} = options;
	const agents = options.agents ?? [...getUniversalAgents(), ...(await detectInstalledAgents())];

	if (!isValidSkillName(meta.name)) {
		throw new Error(
			`Invalid skill name "${meta.name}": must be 1–64 lowercase ` +
				`alphanumeric characters and hyphens, no leading/trailing/consecutive ` +
				`hyphens. Pattern: ${SKILL_NAME_PATTERN.source}`,
		);
	}

	if (agents.length === 0) {
		return { agents: [] };
	}

	// Build manifest and render files once (shared across all agents)
	const manifest = buildManifest(command);
	const renderedFiles = renderSkill(manifest, meta);

	return installRenderedSkill({
		files: renderedFiles,
		meta,
		agents,
		scope,
		clean,
		force,
		installMode,
		kind: "generated",
	});
}

// ────────────────────────────────────────────────────────────────────────────
// Internal install core — shared by generateSkill and installSkillBundle
// ────────────────────────────────────────────────────────────────────────────

/**
 * Internal options object for {@link installRenderedSkill}.
 *
 * Carries the resolved metadata, pre-rendered file list (without
 * `crust.json` — the install core appends it based on `kind`), and the
 * options that survive defaults expansion.
 */
interface InstallRenderedSkillOptions {
	/** Caller-rendered files (SKILL.md + supporting markdown / bundle files) */
	readonly files: readonly RenderedFile[];
	/** Resolved skill metadata (name already canonicalized + validated) */
	readonly meta: SkillMeta;
	/** Resolved agent list (already defaults-expanded; may be empty no-op) */
	readonly agents: AgentTarget[];
	readonly scope: Scope;
	readonly clean: boolean;
	readonly force: boolean;
	readonly installMode: SkillInstallMode;
	/** Origin of the bundle being installed */
	readonly kind: SkillKind;
}

/**
 * The shared install pipeline used by both {@link generateSkill} and
 * `installSkillBundle`.
 *
 * Performs:
 * - Append `crust.json` (with the supplied `kind`) to the file list and sort
 * - Group agent targets by output directory
 * - Inspect existing install state
 * - Conflict detection (no `crust.json` OR kind mismatch; `force: true` bypasses)
 * - Write canonical bundle once when content changed
 * - Fan out to per-agent paths via the configured install mode
 * - Compute per-agent {@link InstallStatus}
 *
 * The function does **not** validate the meta name — callers must do that
 * before invoking the core.
 */
async function installRenderedSkill(
	options: InstallRenderedSkillOptions,
): Promise<GenerateSkillResult> {
	const { files, meta, agents, scope, clean, force, installMode, kind } = options;

	const primaryAgent = agents[0];
	if (!primaryAgent) {
		return { agents: [] };
	}

	// Append crust.json (kind-aware) and sort for deterministic output
	const allFiles: RenderedFile[] = [...files, renderDistributionMetadata(meta, kind)].sort(
		(a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
	);
	const allFilePaths = allFiles.map((file) => file.path);

	const groups = groupAgentsByOutputDir(agents, scope, meta.name);

	const canonicalOutputDir = resolveCanonicalSkillPath(scope, meta.name);
	const installStates = new Map<string, ManagedPathState>();
	for (const outputDir of groups.keys()) {
		installStates.set(outputDir, await inspectManagedPath(outputDir, canonicalOutputDir));
	}
	const canonicalInspection = await inspectInstalledManifest(canonicalOutputDir);
	const canonicalManifest =
		canonicalInspection.status === "ok" ? canonicalInspection.manifest : null;
	const canonicalVersion = canonicalManifest?.version ?? null;
	const canonicalExists = (await inspectInstallPath(canonicalOutputDir, canonicalOutputDir)).exists;
	if (canonicalExists && canonicalManifest === null && !force) {
		throw new SkillConflictError({
			agent: primaryAgent,
			outputDir: canonicalOutputDir,
			manifestMalformed: malformedDetails(canonicalInspection),
		});
	}
	if (canonicalManifest !== null && canonicalManifest.kind !== kind && !force) {
		throw new SkillConflictError({
			agent: primaryAgent,
			outputDir: canonicalOutputDir,
			kindMismatch: {
				existing: canonicalManifest.kind,
				attempted: kind,
			},
		});
	}

	// Compared against the pre-write snapshot. When true, all agents in the
	// loop below report "updated" (even symlinks with `pathChanged = false`)
	// because the canonical content they point to has changed. A kind change
	// (e.g. force-overwriting a generated skill with a bundle) also counts as
	// a content change so writes always happen.
	const canonicalKindChanged = canonicalManifest !== null && canonicalManifest.kind !== kind;
	const canonicalChanged = force || canonicalVersion !== meta.version || canonicalKindChanged;
	if (canonicalChanged) {
		if (clean) {
			await rm(canonicalOutputDir, { recursive: true, force: true });
		}

		await writeFiles(canonicalOutputDir, allFiles);
	}

	const results: AgentResult[] = [];

	for (const [outputDir, groupedAgents] of groups) {
		const groupedPrimaryAgent = groupedAgents[0]!;

		const state = installStates.get(outputDir);
		if (!state) {
			continue;
		}

		if (state.inspection.exists && !state.isCrustManaged && !force) {
			// Re-inspect crust.json on the failure path so the error can
			// distinguish "absent" from "present but malformed" (e.g. an
			// unrecognized kind) instead of always reporting "no crust.json
			// found". One extra read on the cold path is acceptable.
			const inspection = await inspectInstalledManifest(outputDir);
			throw new SkillConflictError({
				agent: groupedPrimaryAgent,
				outputDir,
				manifestMalformed: malformedDetails(inspection),
			});
		}

		// Per-agent kind-mismatch guard.
		//
		// The canonical store check above only catches conflicts when the
		// canonical `crust.json` exists with the wrong kind. An agent path can
		// independently hold a `crust.json` with a different kind — e.g. when a
		// previous install's canonical was deleted manually but the agent copy
		// remained. Reject those without `force` so the public collision
		// contract holds end-to-end (not just at the canonical store).
		if (state.manifest !== null && state.manifest.kind !== kind && !force) {
			throw new SkillConflictError({
				agent: groupedPrimaryAgent,
				outputDir,
				kindMismatch: {
					existing: state.manifest.kind,
					attempted: kind,
				},
			});
		}

		const pathChanged = await ensureAgentInstallPath({
			outputDir,
			canonicalOutputDir,
			allFiles,
			clean,
			installMode,
			inspection: state.inspection,
			installedVersion: state.version,
			currentVersion: meta.version,
			force,
			// Per-output-path kind. Compared with the target `kind` so a
			// `force` kind switch at the same version still rewrites copy-mode
			// agent paths (the version-only `needsWrite` check would otherwise
			// leave a stale per-agent `crust.json`, trapping the next non-force
			// call in `SkillConflictError`). Symlink mode is unaffected because
			// `canonicalChanged` already triggered a canonical rewrite above.
			installedKind: state.manifest?.kind ?? null,
			currentKind: kind,
		});

		const status = computeInstallStatus({
			installedVersion: state.version,
			currentVersion: meta.version,
			canonicalChanged,
			pathChanged,
		});

		for (const agent of groupedAgents) {
			results.push({
				agent,
				outputDir,
				files: status === "up-to-date" ? [] : allFilePaths,
				status,
				previousVersion: status === "updated" ? (state.version ?? undefined) : undefined,
			});
		}
	}

	return { agents: results };
}

export { installRenderedSkill };

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
	options: UninstallSkillOptions,
): Promise<UninstallSkillResult> {
	const { name, scope = "global" } = options;
	const agents = options.agents ?? [...ALL_AGENTS];
	const canonicalOutputDir = resolveCanonicalSkillPath(scope, name);
	const results: UninstallSkillResult["agents"] = [];
	const groups = groupAgentsByOutputDir(agents, scope, name);

	for (const [outputDir, groupedAgents] of groups) {
		const state = await inspectManagedPath(outputDir, canonicalOutputDir);
		const removed = await removeManagedPath(state);

		for (const agent of groupedAgents) {
			results.push({
				agent,
				outputDir,
				status: removed ? "removed" : "not-found",
			});
		}
	}

	const canonicalManifest = await readInstalledManifest(canonicalOutputDir);
	if (canonicalManifest !== null && !(await hasAnyInstalledAgentPath(name, scope))) {
		await rm(canonicalOutputDir, { recursive: true, force: true });
	}

	return { agents: results };
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — getSkillStatus
// ────────────────────────────────────────────────────────────────────────────

/**
 * Checks the installation status of skills across agent directories.
 *
 * @param options - Status options specifying name, agents, and scope
 * @returns Per-agent status results
 */
export async function getSkillStatus(options: SkillStatusOptions): Promise<SkillStatusResult> {
	const { name, scope = "global" } = options;
	const agents = options.agents ?? [...ALL_AGENTS];
	const results: SkillStatusResult["agents"] = [];
	const groups = groupAgentsByOutputDir(agents, scope, name);

	for (const [outputDir, groupedAgents] of groups) {
		const canonicalOutputDir = resolveCanonicalSkillPath(scope, name);
		const state = await inspectManagedPath(outputDir, canonicalOutputDir);
		const version = state.version;
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

interface InstallPathInspection {
	readonly exists: boolean;
	readonly isSymlink: boolean;
	readonly pointsToCanonical: boolean;
}

interface ManagedPathState {
	readonly outputDir: string;
	readonly version: string | null;
	/** Full manifest from `crust.json`, or `null` if absent/malformed/symlink-only. */
	readonly manifest: InstalledSkillManifest | null;
	readonly inspection: InstallPathInspection;
	readonly isCrustManaged: boolean;
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
	readonly force: boolean;
	readonly installedKind: SkillKind | null;
	readonly currentKind: SkillKind;
}

interface ComputeInstallStatusOptions {
	readonly installedVersion: string | null;
	readonly currentVersion: string;
	readonly canonicalChanged: boolean;
	readonly pathChanged: boolean;
}

/**
 * Translates an {@link InstalledManifestStatus} into the
 * `manifestMalformed` shape carried by {@link SkillConflictError}.
 *
 * Returns `undefined` for `"ok"` and `"absent"` results so the conflict
 * error keeps its original "no crust.json found" message in those cases;
 * returns a populated descriptor only when `crust.json` is present but
 * unparseable / has an unrecognized `kind`.
 */
function malformedDetails(inspection: InstalledManifestStatus): SkillManifestMalformed | undefined {
	if (inspection.status !== "malformed") {
		return undefined;
	}
	return inspection.rawKind !== undefined
		? { reason: inspection.reason, rawKind: inspection.rawKind }
		: { reason: inspection.reason };
}

function computeInstallStatus(options: ComputeInstallStatusOptions): InstallStatus {
	const { installedVersion, currentVersion, canonicalChanged, pathChanged } = options;

	if (installedVersion === null) {
		return "installed";
	}

	if (installedVersion === currentVersion && !canonicalChanged && !pathChanged) {
		return "up-to-date";
	}

	return "updated";
}

async function ensureAgentInstallPath(options: EnsureAgentInstallPathOptions): Promise<boolean> {
	const {
		outputDir,
		canonicalOutputDir,
		allFiles,
		clean,
		installMode,
		inspection,
		installedVersion,
		currentVersion,
		force,
		installedKind,
		currentKind,
	} = options;

	if (installMode === "copy") {
		return ensureCopyInstallPath({
			outputDir,
			allFiles,
			clean,
			inspection,
			installedVersion,
			currentVersion,
			force,
			installedKind,
			currentKind,
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
			throw new Error(`Failed to create symlink at "${outputDir}" (installMode: symlink).`, {
				cause: err,
			});
		}

		const fallbackInspection = await inspectInstallPath(outputDir, canonicalOutputDir);

		return ensureCopyInstallPath({
			outputDir,
			allFiles,
			clean,
			inspection: fallbackInspection,
			installedVersion,
			currentVersion,
			force,
			installedKind,
			currentKind,
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
	readonly force: boolean;
	readonly installedKind: SkillKind | null;
	readonly currentKind: SkillKind;
}

async function ensureCopyInstallPath(options: EnsureCopyInstallPathOptions): Promise<boolean> {
	const {
		outputDir,
		allFiles,
		clean,
		inspection,
		installedVersion,
		currentVersion,
		force,
		installedKind,
		currentKind,
	} = options;

	// `installedKind !== currentKind` covers force-kind-switch at the same
	// version: without it the version-only check below would skip the rewrite
	// and the per-agent `crust.json` would retain the previous kind. The check
	// is per output path (not derived from `canonicalChanged`) so partial
	// states — e.g. a stale agent copy left behind by an earlier bug, or one
	// agent fresh while another is stale — are repaired on the next `force`.
	const kindChanged = installedKind !== null && installedKind !== currentKind;
	const needsWrite =
		force ||
		!inspection.exists ||
		inspection.isSymlink ||
		installedVersion !== currentVersion ||
		kindChanged;
	if (!needsWrite) {
		return false;
	}

	if (inspection.isSymlink || clean) {
		await rm(outputDir, { recursive: true, force: true });
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

	if (inspection.exists && inspection.isSymlink && inspection.pointsToCanonical) {
		return false;
	}

	if (inspection.exists) {
		await rm(outputDir, { recursive: true, force: true });
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
		process.platform === "win32" && stats.isDirectory() && (await safeReadlink(outputDir)) !== null;
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
		outputRealPath !== null && canonicalRealPath !== null && outputRealPath === canonicalRealPath;
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
	const [manifest, inspection] = await Promise.all([
		readInstalledManifest(outputDir),
		inspectInstallPath(outputDir, canonicalOutputDir),
	]);
	const version = manifest?.version ?? null;
	const isCrustManaged =
		version !== null || (inspection.exists && inspection.isSymlink && inspection.pointsToCanonical);

	return {
		outputDir,
		version,
		manifest,
		inspection,
		isCrustManaged,
	};
}

async function removeManagedPath(state: ManagedPathState): Promise<boolean> {
	if (!state.isCrustManaged || !state.inspection.exists) {
		return false;
	}

	await rm(state.outputDir, { recursive: true, force: true });
	return true;
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

async function createDirectorySymlink(targetDir: string, symlinkPath: string): Promise<void> {
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
 * `readInstalledManifest` return `null` (target unreachable), and copy removal
 * deletes the `crust.json` directly.
 */
async function hasAnyInstalledAgentPath(name: string, scope: Scope): Promise<boolean> {
	const uniquePaths = new Set<string>();
	for (const agent of ALL_AGENTS) {
		uniquePaths.add(resolveAgentPath(agent, scope, name));
	}

	for (const outputDir of uniquePaths) {
		if ((await readInstalledManifest(outputDir)) !== null) {
			return true;
		}
	}

	return false;
}

// ────────────────────────────────────────────────────────────────────────────
// File system operations
// ────────────────────────────────────────────────────────────────────────────

/**
 * Writes an array of rendered files to disk under the given base directory.
 *
 * Creates parent directories as needed. Files are written sequentially
 * in sorted order for deterministic behavior.
 */
async function writeFiles(baseDir: string, files: RenderedFile[]): Promise<void> {
	for (const file of files) {
		const filePath = join(baseDir, file.path);
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, file.content);
	}
}
