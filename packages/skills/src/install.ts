import { lstat, mkdir, readlink, rm, stat, symlink, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { isErrnoException } from "@crustjs/utils/error";
import { resolveSourceDir } from "@crustjs/utils/source";

import {
	ALL_AGENTS,
	type AgentTarget,
	detectInstalledAgents,
	getUniversalAgents,
	resolveAgentPath,
	resolveEffectiveScope,
	type Scope,
} from "./agents.ts";
import { SkillConflictError } from "./errors.ts";
import { isOwnedSkillLink, skillLinkTarget } from "./link.ts";
import { isValidSkillName } from "./skill-name.ts";
import { readSkillFrontmatter } from "./source.ts";
import type {
	AgentResult,
	InstallSkillOptions,
	InstallSkillResult,
	SkillStatusOptions,
	SkillStatusResult,
	UninstallSkillOptions,
	UninstallSkillResult,
} from "./types.ts";

/** @internal */
export function groupAgentsByOutputDir(
	agents: readonly AgentTarget[],
	scope: Scope,
	name: string,
): Map<string, AgentTarget[]> {
	return Map.groupBy(agents, (agent) => resolveAgentPath(agent, scope, name));
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
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
	} catch (error) {
		if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
		return { status: "absent" };
	}
	if (!entry.isSymbolicLink()) return { status: "conflict" };

	const target = await readlink(outputDir);
	if (!isOwnedSkillLink(target, name)) return { status: "conflict" };
	const resolvedTarget = resolve(dirname(outputDir), target);
	return {
		status: "owned",
		resolves: await pathExists(resolvedTarget),
		correct: expectedSourceDir === undefined || resolvedTarget === resolve(expectedSourceDir),
	};
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
	const scope = resolveEffectiveScope(options.scope ?? "global");
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
			if (inspection.status !== "absent") await rm(outputDir, { recursive: true, force: true });
			await createSkillLink(skillLinkTarget(sourceDir, outputDir, scope), outputDir);
		}

		for (const agent of groupedAgents) {
			results.push({ agent, outputDir, scope, status });
		}
	}

	return { agents: results };
}

/** Unlinks only agent-directory entries carrying the requested skill's ownership signature. */
export async function uninstallSkill(
	options: UninstallSkillOptions,
): Promise<UninstallSkillResult> {
	const agents = options.agents ?? [...ALL_AGENTS];
	const scope = resolveEffectiveScope(options.scope ?? "global");
	const results: UninstallSkillResult["agents"] = [];

	for (const [outputDir, groupedAgents] of groupAgentsByOutputDir(agents, scope, options.name)) {
		const inspection = await inspectLink(outputDir, options.name);
		const removed = inspection.status === "owned";
		if (removed) await unlink(outputDir);
		for (const agent of groupedAgents) {
			results.push({ agent, outputDir, scope, status: removed ? "removed" : "not-found" });
		}
	}
	return { agents: results };
}

/** Reports ownership and health. Only ENOENT is missing; other filesystem errors reject. */
export async function getSkillStatus(options: SkillStatusOptions): Promise<SkillStatusResult> {
	const agents = options.agents ?? [...ALL_AGENTS];
	const scope = resolveEffectiveScope(options.scope ?? "global");
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
		for (const agent of groupedAgents) results.push({ agent, outputDir, scope, status });
	}
	return { agents: results };
}
