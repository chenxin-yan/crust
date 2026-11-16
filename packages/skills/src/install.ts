import { lstat, mkdir, readlink, realpath, rm, stat, symlink, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { isErrnoException } from "@crustjs/utils/error";
import { resolveSourceDir } from "@crustjs/utils/source";

import {
	type AgentTarget,
	detectInstalledAgents,
	getScopeAgents,
	resolveAgentPath,
	type Scope,
} from "./agents.ts";
import { SkillConflictError } from "./errors.ts";
import {
	isOwnedSkillLink,
	resolveEffectiveScope,
	sharedSkillsDir,
	skillLinkTarget,
} from "./link.ts";
import { isValidSkillName } from "./skill-name.ts";
import { readSkillFrontmatter } from "./source.ts";
import type {
	AgentResult,
	InstallStatus,
	InstallSkillOptions,
	InstallSkillResult,
	SkillLinkStatus,
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

/** Compares real paths, so a link that reaches the source through another link (`.agents/skills`) counts. */
async function isSamePath(a: string, b: string): Promise<boolean> {
	try {
		return (await realpath(a)) === (await realpath(b));
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
		correct: expectedSourceDir === undefined || (await isSamePath(outputDir, expectedSourceDir)),
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

/** Links `outputDir` to `target` unless it already leads to `sourceDir`; a conflict throws unless forced. */
async function linkEntry(opts: {
	outputDir: string;
	target: string;
	sourceDir: string;
	name: string;
	scope: Scope;
	force: boolean;
	/** Absent for the shared link. */
	agent?: AgentTarget;
}): Promise<InstallStatus> {
	const { outputDir, sourceDir, name, scope, agent } = opts;
	const inspection = await inspectLink(outputDir, name, sourceDir);
	if (inspection.status === "conflict" && !opts.force) {
		throw new SkillConflictError(agent ? { agent, outputDir } : { outputDir });
	}
	if (inspection.status === "owned" && inspection.resolves && inspection.correct) {
		return "up-to-date";
	}
	if (inspection.status !== "absent") await rm(outputDir, { recursive: true, force: true });
	await createSkillLink(skillLinkTarget(opts.target, outputDir, scope), outputDir);
	return inspection.status === "absent" ? "installed" : "repaired";
}

/**
 * Links one packaged skill source into the shared `.agents/skills` folder, then links the
 * requested agents' own folders to that shared link.
 */
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

	const scope = resolveEffectiveScope(options.scope ?? "global");
	const force = options.force === true;
	const link = { sourceDir, name: source.name, scope, force };
	const sharedDir = join(sharedSkillsDir(scope), source.name);
	const shared = {
		outputDir: sharedDir,
		scope,
		status: await linkEntry({ ...link, outputDir: sharedDir, target: sourceDir }),
	};
	const agents = options.agents ?? (await detectInstalledAgents());
	const results: AgentResult[] = [];

	for (const [outputDir, groupedAgents] of groupAgentsByOutputDir(agents, scope, source.name)) {
		const status =
			outputDir === sharedDir
				? shared.status
				: await linkEntry({ ...link, outputDir, target: sharedDir, agent: groupedAgents[0]! });
		for (const agent of groupedAgents) {
			results.push({ agent, outputDir, scope, status });
		}
	}

	return { shared, agents: results };
}

/** Unlinks only agent-directory entries carrying the requested skill's ownership signature. */
export async function uninstallSkill(
	options: UninstallSkillOptions,
): Promise<UninstallSkillResult> {
	const scope = resolveEffectiveScope(options.scope ?? "global");
	const agents = options.agents ?? getScopeAgents(scope);
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

function linkStatus(inspection: LinkInspection): SkillLinkStatus {
	if (inspection.status !== "owned") return inspection.status;
	return inspection.resolves && inspection.correct ? "linked" : "dangling";
}

/** Reports ownership and health. Only ENOENT is missing; other filesystem errors reject. */
export async function getSkillStatus(options: SkillStatusOptions): Promise<SkillStatusResult> {
	const scope = resolveEffectiveScope(options.scope ?? "global");
	const agents = options.agents ?? getScopeAgents(scope);
	const expectedSourceDir = resolveSourceDir(options.sourceDir);
	const results: SkillStatusResult["agents"] = [];

	for (const [outputDir, groupedAgents] of groupAgentsByOutputDir(agents, scope, options.name)) {
		const status = linkStatus(await inspectLink(outputDir, options.name, expectedSourceDir));
		for (const agent of groupedAgents) results.push({ agent, outputDir, scope, status });
	}
	return { agents: results };
}

/**
 * Status of the shared `.agents/skills/<name>` link alone; reads no agent folders.
 *
 * @internal
 */
export async function getSharedSkillStatus(
	options: Omit<SkillStatusOptions, "agents">,
): Promise<{ outputDir: string; scope: Scope; status: SkillLinkStatus }> {
	const scope = resolveEffectiveScope(options.scope ?? "global");
	const outputDir = join(sharedSkillsDir(scope), options.name);
	const inspection = await inspectLink(
		outputDir,
		options.name,
		resolveSourceDir(options.sourceDir),
	);
	return { outputDir, scope, status: linkStatus(inspection) };
}
