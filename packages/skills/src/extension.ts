import { dirname, join, relative } from "node:path";

import {
	type BuildArtifacts,
	type CommandDefinition,
	type ExtensionBuildContext,
	type ExtensionFactory,
	type ExtensionId,
	type InvocationIO,
	defineCommand,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import { spinner } from "@crustjs/progress";
import { confirm, multiselect, select } from "@crustjs/prompts";
import { bold, dim, yellow } from "@crustjs/style";
import { resolveArtifactDir } from "@crustjs/utils/artifacts";
import { isWithin } from "@crustjs/utils/path";

import {
	AGENT_LABELS,
	detectInstalledAgents,
	getAdditionalAgents,
	getUniversalAgents,
	resolveEffectiveScope,
} from "./agents.ts";
import type { AgentTarget, Scope } from "./agents.ts";
import { SkillConflictError } from "./errors.ts";
import {
	getSkillStatus,
	groupAgentsByOutputDir,
	installSkill,
	uninstallSkill,
} from "./generate.ts";
import { SkillSourceUnavailableError, loadPackagedSkills, type PackagedSkill } from "./source.ts";
import type { InstallSkillResult, SkillOptions, SkillStatusResult } from "./types.ts";

export const SKILLS: ExtensionId = defineExtensionId("crust:skills");

const DEFAULT_SKILL_COMMAND_NAME = "skills";
const SKILLS_SECTION_TITLE = "Agent skills";
const DEFAULT_SKILL_SCOPE = "global";
const SKILLS_ARTIFACT = "skills";
const UNIVERSAL_GROUP = "__universal__";

type SkillIO = Pick<InvocationIO, "stdout" | "stderr">;

async function resolveScope(rawScope: Scope | undefined, options: SkillOptions): Promise<Scope> {
	if (rawScope) return rawScope;
	if (options.defaultScope) return options.defaultScope;
	return select<Scope>({
		message: "Select scope",
		choices: [
			{ label: "Project", value: "project" },
			{ label: "Global", value: "global" },
		],
		default: DEFAULT_SKILL_SCOPE,
	});
}

function formatAgentLabels(agents: readonly AgentTarget[]): string[] {
	const universal = new Set(getUniversalAgents());
	const labels = agents.some((agent) => universal.has(agent)) ? ["Universal"] : [];
	for (const agent of agents) {
		if (!universal.has(agent)) labels.push(AGENT_LABELS[agent]);
	}
	return labels;
}

async function repairInstalledSkill(
	packagedSkill: PackagedSkill,
	scope: Scope,
	io: SkillIO,
	report = false,
): Promise<void> {
	const status = await getSkillStatus({
		name: packagedSkill.name,
		sourceDir: packagedSkill.sourceDir,
		scope,
	});
	const effectiveScope = status.agents[0]?.scope ?? scope;
	for (const outputDir of new Set(
		status.agents.filter((entry) => entry.status === "conflict").map((entry) => entry.outputDir),
	)) {
		io.stderr(
			yellow(
				`Skill conflict [${packagedSkill.name}]: "${outputDir}" is not owned by this skill. Skipping link repair.`,
			),
		);
	}
	const stale = status.agents.filter((entry) => entry.status === "dangling");
	if (stale.length === 0) {
		if (report) io.stdout(dim(`No repairs needed [${packagedSkill.name}] (${effectiveScope}).`));
		return;
	}

	try {
		const result = await installSkill({
			sourceDir: packagedSkill.sourceDir,
			agents: stale.map((entry) => entry.agent),
			scope,
		});
		const labels = formatAgentLabels(result.agents.map((entry) => entry.agent));
		if (report && labels.length > 0) {
			io.stdout(
				`\n${bold(`Repaired "${packagedSkill.name}" for ${labels.join(", ")} (${effectiveScope})`)}`,
			);
		}
	} catch (error) {
		// The entry may change hands between the status check and install (TOCTOU).
		if (!(error instanceof SkillConflictError)) throw error;
		io.stderr(
			yellow(
				`Skill conflict [${packagedSkill.name}]: "${error.details.outputDir}" is not owned by this skill. Skipping link repair.`,
			),
		);
	}
}

async function autoRepairSkills(options: SkillOptions, io: SkillIO): Promise<void> {
	let skills: readonly PackagedSkill[];
	try {
		skills = loadPackagedSkills(resolveArtifactDir(SKILLS_ARTIFACT));
	} catch (error) {
		// A missing or invalid packaged asset must not prevent unrelated CLI commands
		// from running; the explicit skill command surfaces the same failure loudly.
		if (!(error instanceof SkillSourceUnavailableError)) {
			io.stderr(
				yellow(
					`Skipping skill link repair: ${error instanceof Error ? error.message : String(error)}`,
				),
			);
		}
		return;
	}
	const configuredScopes: Scope[] = options.defaultScope
		? [options.defaultScope]
		: ["project", "global"];
	const scopes = [...new Set(configuredScopes.map(resolveEffectiveScope))];
	for (const packagedSkill of skills) {
		for (const scope of scopes) {
			try {
				await repairInstalledSkill(packagedSkill, scope, io);
			} catch (error) {
				// Filesystem errors during background repair must not abort the user's
				// unrelated command; the explicit skill command surfaces them loudly.
				io.stderr(
					yellow(
						`Skipping skill link repair [${packagedSkill.name}]: ${error instanceof Error ? error.message : String(error)}`,
					),
				);
			}
		}
	}
}

function formatSkillDocumentation(commandName: string, appName: string): string {
	try {
		return loadPackagedSkills(resolveArtifactDir(SKILLS_ARTIFACT))
			.map((packagedSkill) => {
				// Relativizing across unrelated roots yields ../ chains that still spell
				// out the absolute path; keep the absolute form when outside the cwd.
				const sourcePath = isWithin(process.cwd(), packagedSkill.sourceDir)
					? relative(process.cwd(), packagedSkill.sourceDir) || "."
					: packagedSkill.sourceDir;
				return `${packagedSkill.name} — ${packagedSkill.description}\n  Source: ${sourcePath}`;
			})
			.join("\n\n");
	} catch (error) {
		// A missing or invalid packaged asset degrades the advertisement instead of
		// failing help, matching the auto-update hook's recovery behavior.
		if (error instanceof SkillSourceUnavailableError) {
			return `${error.message} Then run \`${appName} ${commandName}\` to link packaged skills into an agent directory.`;
		}
		// No warn here: the preRun repair hook already surfaces the underlying
		// message once per invocation, and the explicit skill command fails loudly.
		return `Packaged skills could not be read. Run \`${appName} ${commandName}\` for details.`;
	}
}

async function buildSkills(
	options: SkillOptions,
	context: ExtensionBuildContext,
): Promise<BuildArtifacts> {
	const { renderSkills } = await import("./build.ts");
	const files = await renderSkills(options.generated === false ? undefined : context.snapshot, {
		version: context.snapshot.meta.version,
		name: options.name,
		description: options.description,
		extras: options.extras,
	});
	return files.map((file) => ({ path: join(SKILLS_ARTIFACT, file.path), content: file.content }));
}

// Configurable command names require an open command namespace.
export const skill: ExtensionFactory<
	[options: SkillOptions],
	{},
	[],
	[],
	readonly CommandDefinition<any, any, any, any>[]
> = defineExtension(SKILLS).factory((extension, options) => {
	const commandName = options.command ?? DEFAULT_SKILL_COMMAND_NAME;
	return (
		extension
			.add(buildSkillCommand(commandName, options))
			.preRun(async (context) => {
				if (context.commandPath[1] === commandName || options.autoUpdate === false) return;
				await autoRepairSkills(options, context);
			})
			// Skills are loaded when a snapshot is prepared, not at construction, so
			// help and man pages reflect the packaged directory as it exists at render time.
			.sections((snapshot) => [
				{
					command: [],
					title: SKILLS_SECTION_TITLE,
					body: formatSkillDocumentation(commandName, snapshot.meta.name),
					except: [SKILLS],
				},
			])
			.build((context) => buildSkills(options, context))
	);
});

type SkillStatusEntry = SkillStatusResult["agents"][number];
type SkillStatusMap = ReadonlyMap<AgentTarget, SkillStatusEntry>;

function installedAgents(statusMap: SkillStatusMap): AgentTarget[] {
	return [...statusMap.values()].flatMap((entry) =>
		entry.status === "linked" || entry.status === "dangling" ? [entry.agent] : [],
	);
}

async function loadStatuses(scope: Scope): Promise<Map<PackagedSkill, SkillStatusMap>> {
	const statuses = new Map<PackagedSkill, SkillStatusMap>();
	for (const packagedSkill of loadPackagedSkills(resolveArtifactDir(SKILLS_ARTIFACT))) {
		const status = await getSkillStatus({
			name: packagedSkill.name,
			sourceDir: packagedSkill.sourceDir,
			scope,
		});
		statuses.set(packagedSkill, new Map(status.agents.map((entry) => [entry.agent, entry])));
	}
	return statuses;
}

async function selectSkills(
	message: string,
	skills: readonly PackagedSkill[],
	defaults?: readonly PackagedSkill[],
): Promise<PackagedSkill[]> {
	const names = await multiselect({
		message,
		choices: skills.map((packagedSkill) => ({
			label: packagedSkill.name,
			value: packagedSkill.name,
			hint: packagedSkill.description,
		})),
		default: defaults?.map((packagedSkill) => packagedSkill.name),
		required: false,
	});
	return skills.filter((packagedSkill) => names.includes(packagedSkill.name));
}

function reportAgentDirs(
	io: SkillIO,
	entries: readonly { agent: AgentTarget; outputDir: string }[],
): void {
	// Agents sharing one directory (e.g. Universal + Antigravity) report as one line.
	for (const [outputDir, group] of Map.groupBy(entries, (entry) => entry.outputDir)) {
		const labels = formatAgentLabels(group.map((entry) => entry.agent));
		io.stdout(dim(`  ${labels.join(", ")} → ${outputDir}`));
	}
}

async function installSkills(opts: {
	scope: Scope;
	installAll: boolean;
	io: SkillIO;
}): Promise<void> {
	const { installAll, io } = opts;
	const effectiveScope = resolveEffectiveScope(opts.scope);
	const statuses = await loadStatuses(effectiveScope);
	let skills = [...statuses.keys()];
	if (skills.length === 0) return;
	if (!installAll && skills.length > 1) {
		const installedSkills = skills.filter(
			(packagedSkill) => installedAgents(statuses.get(packagedSkill)!).length > 0,
		);
		skills = await selectSkills(
			"Select skills to install",
			skills,
			installedSkills.length > 0 ? installedSkills : skills,
		);
		if (skills.length === 0) {
			io.stdout(dim("No skills selected."));
			return;
		}
	}

	const detected = new Set(await detectInstalledAgents());
	const universal = getUniversalAgents();
	const installed = new Set(
		skills.flatMap((packagedSkill) => installedAgents(statuses.get(packagedSkill)!)),
	);
	const additional = getAdditionalAgents().filter(
		(agent) => detected.has(agent) || installed.has(agent),
	);
	// Every skill links into the same per-agent skills root; hint the shared root.
	const rootHint = (agent: AgentTarget) => {
		const outputDir = statuses.get(skills[0]!)?.get(agent)?.outputDir;
		return outputDir ? dirname(outputDir) : "path unavailable";
	};
	const choices: Array<{
		label: string;
		value: AgentTarget | typeof UNIVERSAL_GROUP;
		hint: string;
	}> = [];
	if (universal.length > 0) {
		choices.push({ label: "Universal", value: UNIVERSAL_GROUP, hint: rootHint(universal[0]!) });
	}
	for (const agent of additional) {
		choices.push({ label: AGENT_LABELS[agent], value: agent, hint: rootHint(agent) });
	}

	let selected: AgentTarget[];
	if (installAll) selected = [...universal, ...additional];
	else {
		const defaults: Array<AgentTarget | typeof UNIVERSAL_GROUP> = additional.filter((agent) =>
			installed.has(agent),
		);
		if (universal.length > 0 && universal.every((agent) => installed.has(agent))) {
			defaults.unshift(UNIVERSAL_GROUP);
		}
		const values = await multiselect({
			message: "Select agents to install for",
			choices,
			default: defaults,
			required: false,
		});
		selected = values.filter((value): value is AgentTarget => value !== UNIVERSAL_GROUP);
		if (values.includes(UNIVERSAL_GROUP)) selected.push(...universal);
	}

	for (const packagedSkill of skills) {
		await installSelectedAgents({
			packagedSkill,
			statusMap: statuses.get(packagedSkill)!,
			selected,
			scope: effectiveScope,
			installAll,
			io,
		});
	}
}

/** Additive only: links or repairs selected agents; unselected links are left untouched. */
async function installSelectedAgents(opts: {
	packagedSkill: PackagedSkill;
	statusMap: SkillStatusMap;
	selected: readonly AgentTarget[];
	scope: Scope;
	installAll: boolean;
	io: SkillIO;
}): Promise<void> {
	const { packagedSkill, statusMap, selected, scope, installAll, io } = opts;
	const toInstall = selected.filter((agent) => statusMap.get(agent)?.status !== "linked");
	if (toInstall.length === 0) {
		io.stdout(dim(`No changes [${packagedSkill.name}].`));
		return;
	}

	const groups = groupAgentsByOutputDir(toInstall, scope, packagedSkill.name);
	const linked: InstallSkillResult["agents"] = [];
	for (const agents of groups.values()) {
		const runInstall = (force?: boolean) =>
			installSkill({
				sourceDir: packagedSkill.sourceDir,
				agents,
				scope,
				force,
			});
		try {
			const result = await spinner({
				message: `Installing skill [${packagedSkill.name}]...`,
				task: () => runInstall(),
			});
			linked.push(...result.agents);
		} catch (error) {
			if (!(error instanceof SkillConflictError)) throw error;
			const label = formatAgentLabels(agents).join(", ");
			const skipped = `Skipped ${label} [${packagedSkill.name}]: directory is not owned by this skill.`;
			if (installAll) {
				io.stderr(yellow(skipped));
				continue;
			}
			const overwrite = await confirm({
				message: `"${error.details.outputDir}" is not owned by "${packagedSkill.name}". Overwrite?`,
				default: false,
			});
			if (!overwrite) {
				io.stdout(dim(skipped));
				continue;
			}
			const result = await runInstall(true);
			linked.push(...result.agents);
		}
	}
	if (linked.length > 0) {
		io.stdout(`\n${bold(`Installed "${packagedSkill.name}"`)}`);
		reportAgentDirs(io, linked);
	}
}

async function uninstallSkills(opts: {
	scope: Scope;
	removeAll: boolean;
	io: SkillIO;
}): Promise<void> {
	const { removeAll, io } = opts;
	const effectiveScope = resolveEffectiveScope(opts.scope);
	const statuses = await loadStatuses(effectiveScope);
	const installedSkills = [...statuses].flatMap(([packagedSkill, statusMap]) =>
		installedAgents(statusMap).length > 0 ? [packagedSkill] : [],
	);
	if (installedSkills.length === 0) {
		io.stdout(dim(`No installed skills (${effectiveScope}).`));
		return;
	}
	// No default: a preselected list would let a non-TTY run (which answers with
	// the default) remove every skill without --all.
	const skills = removeAll
		? installedSkills
		: await selectSkills("Select skills to uninstall", installedSkills);
	if (skills.length === 0) {
		io.stdout(dim("No skills selected."));
		return;
	}
	for (const packagedSkill of skills) {
		const result = await spinner({
			message: `Removing skill [${packagedSkill.name}]...`,
			task: () => uninstallSkill({ name: packagedSkill.name, scope: effectiveScope }),
		});
		const removed = result.agents.filter((entry) => entry.status === "removed");
		if (removed.length === 0) continue;
		io.stdout(`\n${bold(`Removed "${packagedSkill.name}"`)}`);
		reportAgentDirs(io, removed);
	}
}

const SCOPE_FLAG = {
	name: "scope",
	type: "string",
	choices: ["project", "global"],
	description: "Skill scope (project or global)",
} as const;

const INSTALL_FLAGS = [
	SCOPE_FLAG,
	{
		name: "all",
		type: "boolean",
		description:
			"Install for every detected agent and every agent already holding a packaged skill, non-interactively",
	},
] as const;

type SkillActionContext = SkillIO & { flags: { scope?: Scope; all?: boolean } };

function buildSkillCommand(commandName: string, options: SkillOptions) {
	const install = async (context: SkillActionContext) => {
		const installAll = context.flags.all === true;
		const scope = installAll
			? (context.flags.scope ?? options.defaultScope ?? DEFAULT_SKILL_SCOPE)
			: await resolveScope(context.flags.scope, options);
		await installSkills({ scope, installAll, io: context });
	};
	return defineCommand(
		commandName,
		{
			description: "Manage agent skill installations (shorthand for `install`)",
			aliases: commandName === DEFAULT_SKILL_COMMAND_NAME ? ["skill"] : [],
		},
		(command) =>
			command
				.flags(...INSTALL_FLAGS)
				.add(
					defineCommand(
						"install",
						{
							description:
								"Link packaged skills into agent directories; never removes existing links",
						},
						(sub) => sub.flags(...INSTALL_FLAGS).action(install),
					),
				)
				.add(
					defineCommand("uninstall", { description: "Remove installed skill links" }, (sub) =>
						sub
							.flags(SCOPE_FLAG, {
								name: "all",
								type: "boolean",
								description: "Uninstall every installed skill non-interactively",
							})
							.action(async (context) => {
								const removeAll = context.flags.all === true;
								const scope = removeAll
									? (context.flags.scope ?? options.defaultScope ?? DEFAULT_SKILL_SCOPE)
									: await resolveScope(context.flags.scope, options);
								await uninstallSkills({ scope, removeAll, io: context });
							}),
					),
				)
				.add(
					defineCommand("repair", { description: "Repair installed skill links" }, (sub) =>
						sub.flags(SCOPE_FLAG).action(async (context) => {
							const scope = await resolveScope(context.flags.scope, options);
							for (const packagedSkill of loadPackagedSkills(resolveArtifactDir(SKILLS_ARTIFACT))) {
								await repairInstalledSkill(packagedSkill, scope, context, true);
							}
						}),
					),
				)
				.action(install),
	);
}
