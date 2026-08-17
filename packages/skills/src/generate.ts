import { lstat, mkdir, readlink, rm, stat, symlink, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { resolveSourceDir } from "@crustjs/utils/source";

import {
	ALL_AGENTS,
	detectInstalledAgents,
	getUniversalAgents,
	resolveAgentPath,
} from "./agents.ts";
import { SkillConflictError } from "./errors.ts";
import { isOwnedSkillLink, skillLinkTarget } from "./link.ts";
import { isValidSkillName } from "./skill-name.ts";
import { readSkillFrontmatter } from "./source.ts";
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
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

type LinkInspection =
	| { readonly status: "absent" }
	| { readonly status: "conflict" }
	| {
			readonly status: "owned";
			readonly resolves: boolean;
			readonly correct: boolean;
	  };

async function inspectLink(
	outputDir: string,
	name: string,
	expectedSourceDir?: string,
): Promise<LinkInspection> {
	let entry;
	try {
		entry = await lstat(outputDir);
	} catch {
		return { status: "absent" };
	}
	if (!entry.isSymbolicLink()) return { status: "conflict" };

	const target = await readlink(outputDir);
	if (!isOwnedSkillLink(target, name)) return { status: "conflict" };
	return {
		status: "owned",
		resolves: await pathExists(resolve(dirname(outputDir), target)),
		correct:
			expectedSourceDir === undefined ||
			resolve(dirname(outputDir), target) === resolve(expectedSourceDir),
	};
}

async function removeEntry(outputDir: string): Promise<void> {
	const entry = await lstat(outputDir);
	if (entry.isSymbolicLink()) await unlink(outputDir);
	else await rm(outputDir, { recursive: true, force: true });
}

async function createSkillLink(target: string, outputDir: string): Promise<void> {
	await mkdir(dirname(outputDir), { recursive: true });
	try {
		await symlink(target, outputDir, "dir");
	} catch (error) {
		const detail = error instanceof Error ? ` ${error.message}` : "";
		throw new Error(
			`Could not create skill symlink "${outputDir}" -> "${target}".${detail} If permission was denied, enable symlink permission for this environment and try again.`,
			{ cause: error },
		);
	}
}

/** Links one packaged skill source into the requested agent directories. */
export async function installSkill(options: InstallSkillOptions): Promise<InstallSkillResult> {
	const sourceDir = resolveSourceDir(options.sourceDir);
	const source = readSkillFrontmatter(sourceDir);
	if (!isValidSkillName(source.name)) {
		throw new Error(`Skill source "${sourceDir}" declares invalid name "${source.name}".`);
	}
	if (!isOwnedSkillLink(sourceDir, source.name)) {
		throw new Error(
			`Skill source directory "${sourceDir}" must be named "skills/${source.name}" to support ownership-safe links.`,
		);
	}

	const agents = options.agents ?? [...getUniversalAgents(), ...(await detectInstalledAgents())];
	const scope = options.scope ?? "global";
	const results: AgentResult[] = [];

	for (const [outputDir, groupedAgents] of groupAgentsByOutputDir(agents, scope, source.name)) {
		const inspection = await inspectLink(outputDir, source.name, sourceDir);
		if (inspection.status === "conflict" && options.force !== true) {
			throw new SkillConflictError({ agent: groupedAgents[0]!, outputDir });
		}

		const upToDate =
			inspection.status === "owned" &&
			inspection.resolves &&
			inspection.correct &&
			options.force !== true;
		const status = upToDate
			? "up-to-date"
			: inspection.status === "absent"
				? "installed"
				: "repaired";

		if (!upToDate) {
			if (inspection.status !== "absent") await removeEntry(outputDir);
			await createSkillLink(skillLinkTarget(sourceDir, outputDir, scope), outputDir);
		}

		for (const agent of groupedAgents) {
			results.push({ agent, outputDir, status });
		}
	}

	return { agents: results };
}

/** Unlinks only agent-directory entries carrying the requested skill's ownership signature. */
export async function uninstallSkill(
	options: UninstallSkillOptions,
): Promise<UninstallSkillResult> {
	const agents = options.agents ?? [...ALL_AGENTS];
	const scope = options.scope ?? "global";
	const results: UninstallSkillResult["agents"] = [];

	for (const [outputDir, groupedAgents] of groupAgentsByOutputDir(agents, scope, options.name)) {
		const inspection = await inspectLink(outputDir, options.name);
		const removed = inspection.status === "owned";
		if (removed) await unlink(outputDir);
		for (const agent of groupedAgents) {
			results.push({ agent, outputDir, status: removed ? "removed" : "not-found" });
		}
	}
	return { agents: results };
}

/** Reports the ownership and health of each requested agent-directory entry. */
export async function getSkillStatus(options: SkillStatusOptions): Promise<SkillStatusResult> {
	const agents = options.agents ?? [...ALL_AGENTS];
	const scope = options.scope ?? "global";
	const expectedSourceDir = resolveSourceDir(options.sourceDir);
	const results: SkillStatusResult["agents"] = [];

	for (const [outputDir, groupedAgents] of groupAgentsByOutputDir(agents, scope, options.name)) {
		const inspection = await inspectLink(outputDir, options.name, expectedSourceDir);
		const status =
			inspection.status === "owned"
				? inspection.resolves && inspection.correct
					? "linked"
					: "dangling"
				: inspection.status;
		for (const agent of groupedAgents) results.push({ agent, outputDir, status });
	}
	return { agents: results };
}
