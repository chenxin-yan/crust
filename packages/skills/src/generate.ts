import { randomUUID } from "node:crypto";
import { lstat, mkdir, readlink, rename, rm, stat, symlink, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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

function isNotFound(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (isNotFound(error)) return false;
		throw error;
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
	expectedSourceDir: string,
): Promise<LinkInspection> {
	let entry;
	try {
		entry = await lstat(outputDir);
	} catch (error) {
		if (isNotFound(error)) return { status: "absent" };
		throw error;
	}
	if (!entry.isSymbolicLink()) return { status: "conflict" };

	let target: string;
	try {
		target = await readlink(outputDir);
	} catch (error) {
		if (isNotFound(error)) return { status: "absent" };
		throw error;
	}
	if (!isOwnedSkillLink(target, name)) return { status: "conflict" };
	const resolvedTarget = resolve(dirname(outputDir), target);
	const resolves = await pathExists(resolvedTarget);
	const correct = resolvedTarget === resolve(expectedSourceDir);
	if (resolves && !correct) return { status: "conflict" };
	return { status: "owned", resolves, correct };
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

async function replaceWithSkillLink(target: string, outputDir: string): Promise<void> {
	const parent = dirname(outputDir);
	const staged = join(parent, `.crust-skill-${randomUUID()}`);
	const backup = join(parent, `.crust-skill-backup-${randomUUID()}`);
	await createSkillLink(target, staged);
	let backedUp = false;
	try {
		try {
			await rename(outputDir, backup);
			backedUp = true;
		} catch (error) {
			if (!isNotFound(error)) throw error;
		}
		try {
			await rename(staged, outputDir);
		} catch (error) {
			if (backedUp) {
				try {
					await rename(backup, outputDir);
				} catch (rollbackError) {
					const placementDetail = error instanceof Error ? ` ${error.message}` : "";
					const rollbackDetail = rollbackError instanceof Error ? ` ${rollbackError.message}` : "";
					throw new Error(
						`Could not place skill symlink or restore the original entry. Backup path: "${backup}".${placementDetail}${rollbackDetail}`,
						{ cause: rollbackError },
					);
				}
			}
			throw error;
		}
		if (backedUp) await rm(backup, { recursive: true, force: true });
	} finally {
		await rm(staged, { recursive: true, force: true });
	}
}

function containsPath(parent: string, child: string): boolean {
	const path = relative(parent, child);
	return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

/** Links one packaged skill source into the requested agent directories. */
export async function installSkill(options: InstallSkillOptions): Promise<InstallSkillResult> {
	const sourceDir = resolveSourceDir(options.sourceDir);
	const source = await readSkillFrontmatter(sourceDir);
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
	const groups = groupAgentsByOutputDir(agents, scope, source.name);
	for (const outputDir of groups.keys()) {
		if (containsPath(outputDir, sourceDir)) {
			throw new Error(
				`Skill output directory "${outputDir}" contains packaged source "${sourceDir}".`,
			);
		}
	}

	for (const [outputDir, groupedAgents] of groups) {
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
			const target = skillLinkTarget(sourceDir, outputDir, scope);
			if (inspection.status === "absent") await createSkillLink(target, outputDir);
			else await replaceWithSkillLink(target, outputDir);
		}

		for (const agent of groupedAgents) {
			results.push({
				agent,
				outputDir,
				status,
			});
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
	const expectedSourceDir = resolveSourceDir(options.sourceDir);

	for (const [outputDir, groupedAgents] of groupAgentsByOutputDir(agents, scope, options.name)) {
		const inspection = await inspectLink(outputDir, options.name, expectedSourceDir);
		let removed = inspection.status === "owned";
		if (removed) {
			try {
				await unlink(outputDir);
			} catch (error) {
				if (isNotFound(error)) removed = false;
				else throw error;
			}
		}
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
