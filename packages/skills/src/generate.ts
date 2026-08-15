import { cp, lstat, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import { resolveSourceDir } from "@crustjs/utils/source";

import {
	ALL_AGENTS,
	detectInstalledAgents,
	getUniversalAgents,
	resolveAgentPath,
} from "./agents.ts";
import { SkillConflictError } from "./errors.ts";
import { isValidSkillName } from "./skill-name.ts";
import type {
	AgentResult,
	AgentTarget,
	InstallSkillOptions,
	InstallSkillResult,
	Scope,
	SkillStatusOptions,
	SkillStatusResult,
	UninstallSkillOptions,
	UninstallSkillResult,
} from "./types.ts";
import {
	type InstalledManifestStatus,
	inspectInstalledManifest,
	readInstalledManifest,
} from "./version.ts";

export { isValidSkillName } from "./skill-name.ts";

function groupAgentsByOutputDir(
	agents: readonly AgentTarget[],
	scope: Scope,
	name: string,
): Map<string, AgentTarget[]> {
	const groups = new Map<string, AgentTarget[]>();
	for (const agent of agents) {
		const outputDir = resolveAgentPath(agent, scope, name);
		const existing = groups.get(outputDir);
		if (existing) existing.push(agent);
		else groups.set(outputDir, [agent]);
	}
	return groups;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

function malformedDetails(inspection: InstalledManifestStatus) {
	if (inspection.status !== "malformed") return undefined;
	return inspection.rawKind === undefined
		? { reason: inspection.reason }
		: { reason: inspection.reason, rawKind: inspection.rawKind };
}

async function listFiles(dir: string, prefix = ""): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) files.push(...(await listFiles(join(dir, entry.name), relative)));
		else if (entry.isFile()) files.push(relative);
	}
	return files.sort();
}

/** Copies one packaged skill source into the requested agent directories. */
export async function installSkill(options: InstallSkillOptions): Promise<InstallSkillResult> {
	const sourceDir = resolveSourceDir(options.sourceDir);
	const sourceInspection = await inspectInstalledManifest(sourceDir);
	if (sourceInspection.status !== "ok") {
		throw new Error(
			`Skill source "${sourceDir}" has no valid crust.json (${sourceInspection.status === "absent" ? "missing" : sourceInspection.reason}).`,
		);
	}
	const source = sourceInspection.manifest;
	if (!isValidSkillName(source.name)) {
		throw new Error(`Skill source "${sourceDir}" declares invalid name "${source.name}".`);
	}
	if (!(await pathExists(join(sourceDir, "SKILL.md")))) {
		throw new Error(`Skill source "${sourceDir}" is missing SKILL.md.`);
	}

	const agents = options.agents ?? [...getUniversalAgents(), ...(await detectInstalledAgents())];
	const scope = options.scope ?? "global";
	const files = await listFiles(sourceDir);
	const results: AgentResult[] = [];

	for (const [outputDir, groupedAgents] of groupAgentsByOutputDir(agents, scope, source.name)) {
		const primaryAgent = groupedAgents[0]!;
		const exists = await pathExists(outputDir);
		const installedInspection = await inspectInstalledManifest(outputDir);
		const installed = installedInspection.status === "ok" ? installedInspection.manifest : null;

		if (
			exists &&
			(installed === null || installed.name !== source.name || installed.kind !== source.kind) &&
			options.force !== true
		) {
			throw new SkillConflictError({
				agent: primaryAgent,
				outputDir,
				manifestMalformed: malformedDetails(installedInspection),
				...(installed?.kind !== undefined && installed.kind !== source.kind
					? { kindMismatch: { existing: installed.kind, attempted: source.kind } }
					: {}),
			});
		}

		const status = !exists
			? "installed"
			: installed?.version === source.version && options.force !== true
				? "up-to-date"
				: "updated";
		if (status !== "up-to-date") {
			// Stage the copy next to the target so an interrupted install (this runs in the
			// auto-update preRun hook) never leaves a partial skill directory behind.
			const staging = `${outputDir}.staging`;
			try {
				await rm(staging, { recursive: true, force: true });
				await cp(sourceDir, staging, { recursive: true });
				await rm(outputDir, { recursive: true, force: true });
				await rename(staging, outputDir);
			} finally {
				await rm(staging, { recursive: true, force: true });
			}
		}

		for (const agent of groupedAgents) {
			results.push({
				agent,
				outputDir,
				files: status === "up-to-date" ? [] : files,
				status,
				previousVersion: status === "updated" ? installed?.version : undefined,
			});
		}
	}

	return { agents: results };
}

/** Removes only agent-directory copies owned by the named skill. */
export async function uninstallSkill(
	options: UninstallSkillOptions,
): Promise<UninstallSkillResult> {
	const agents = options.agents ?? [...ALL_AGENTS];
	const scope = options.scope ?? "global";
	const results: UninstallSkillResult["agents"] = [];

	for (const [outputDir, groupedAgents] of groupAgentsByOutputDir(agents, scope, options.name)) {
		const manifest = await readInstalledManifest(outputDir);
		const removed = manifest?.name === options.name;
		if (removed) await rm(outputDir, { recursive: true, force: true });
		for (const agent of groupedAgents) {
			results.push({ agent, outputDir, status: removed ? "removed" : "not-found" });
		}
	}
	return { agents: results };
}

/** Reports agent-directory copies owned by the named skill. */
export async function getSkillStatus(options: SkillStatusOptions): Promise<SkillStatusResult> {
	const agents = options.agents ?? [...ALL_AGENTS];
	const scope = options.scope ?? "global";
	const results: SkillStatusResult["agents"] = [];

	for (const [outputDir, groupedAgents] of groupAgentsByOutputDir(agents, scope, options.name)) {
		const manifest = await readInstalledManifest(outputDir);
		const installed = manifest?.name === options.name;
		for (const agent of groupedAgents) {
			results.push({
				agent,
				outputDir,
				installed,
				version: installed ? manifest.version : undefined,
			});
		}
	}
	return { agents: results };
}
