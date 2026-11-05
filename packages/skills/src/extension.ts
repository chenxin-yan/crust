import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import {
	type BuildArtifacts,
	type CommandDefinition,
	type CommandShape,
	type Extension,
	type ExtensionBuildContext,
	type ExtensionFactory,
	type ExtensionId,
	type InvocationIO,
	defineCommand,
	defineExtension,
} from "@crustjs/core";
// @crustjs/prompts and @crustjs/progress load inside the `skills` command so other commands skip their import cost.
import { bold, dim, yellow } from "@crustjs/style";
import { isSourceRun, resolveArtifactDir } from "@crustjs/utils/artifacts";
import { isWithin } from "@crustjs/utils/path";

import {
	AGENT_LABELS,
	detectInstalledAgents,
	getAdditionalAgents,
	getUniversalAgents,
	resolveEffectiveScope,
} from "./agents.ts";
import type { AgentTarget, Scope } from "./agents.ts";
import { renderSkills } from "./build.ts";
import { SkillConflictError } from "./errors.ts";
import { SKILLS } from "./id.ts";
import { getSkillStatus, groupAgentsByOutputDir, installSkill, uninstallSkill } from "./install.ts";
import { SkillSourceUnavailableError, loadPackagedSkills, type PackagedSkill } from "./source.ts";
import type { InstallSkillResult, SkillOptions, SkillStatusResult } from "./types.ts";

const DEFAULT_SKILL_COMMAND_NAME = "skills";
const SKILLS_SECTION_TITLE = "Agent skills";
const DEFAULT_SKILL_SCOPE = "global";
const SKILLS_ARTIFACT = "skills";
const UNIVERSAL_GROUP = "__universal__";

type SkillIO = Pick<InvocationIO, "stdout" | "stderr">;

/** `--all` runs never prompt; they fall back to the default scope instead. */
async function resolveScope(
	rawScope: Scope | undefined,
	options: SkillOptions,
	nonInteractive = false,
): Promise<Scope> {
	const scope = rawScope ?? options.defaultScope;
	if (scope) return scope;
	if (nonInteractive) return DEFAULT_SKILL_SCOPE;
	const { select } = await import("@crustjs/prompts");
	return select<Scope>({
		message: "Select scope",
		choices: [
			{ label: "Project", value: "project" },
			{ label: "Global", value: "global" },
		],
		default: DEFAULT_SKILL_SCOPE,
	});
}

function loadArtifactSkills(): readonly PackagedSkill[] {
	return loadPackagedSkills(resolveArtifactDir(SKILLS_ARTIFACT));
}

function conflictWarning(name: string, outputDir: string): string {
	return yellow(
		`Skill conflict [${name}]: "${outputDir}" is not owned by this skill. Skipping link repair.`,
	);
}

function formatAgentLabels(agents: readonly AgentTarget[]): string[] {
	const universal = new Set(getUniversalAgents());
	const labels = agents.some((agent) => universal.has(agent)) ? ["Universal"] : [];
	for (const agent of agents) {
		if (!universal.has(agent)) labels.push(AGENT_LABELS[agent]);
	}
	return labels;
}

/**
 * `explicit` is the `repair` command: it reports and re-points every stale owned link.
 * Background repair fixes only links whose target is gone; a link to another live
 * installed copy is left alone so two copies of the CLI do not take it from each other.
 */
async function repairInstalledSkill(
	packagedSkill: PackagedSkill,
	scope: Scope,
	io: SkillIO,
	explicit = false,
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
		io.stderr(conflictWarning(packagedSkill.name, outputDir));
	}
	const stale = status.agents.filter(
		(entry) => entry.status === "dangling" && (explicit || !existsSync(entry.outputDir)),
	);
	if (stale.length === 0) {
		if (explicit) io.stdout(dim(`No repairs needed [${packagedSkill.name}] (${effectiveScope}).`));
		return;
	}

	try {
		const result = await installSkill({
			sourceDir: packagedSkill.sourceDir,
			agents: stale.map((entry) => entry.agent),
			scope,
		});
		const labels = formatAgentLabels(result.agents.map((entry) => entry.agent));
		if (explicit && labels.length > 0) {
			io.stdout(
				`\n${bold(`Repaired "${packagedSkill.name}" for ${labels.join(", ")} (${effectiveScope})`)}`,
			);
		}
	} catch (error) {
		// The entry may change hands between the status check and install (TOCTOU).
		if (!(error instanceof SkillConflictError)) throw error;
		io.stderr(conflictWarning(packagedSkill.name, error.details.outputDir));
	}
}

async function autoRepairSkills(options: SkillOptions, io: SkillIO): Promise<void> {
	let skills: readonly PackagedSkill[];
	try {
		skills = loadArtifactSkills();
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
		return loadArtifactSkills()
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
	const files = await renderSkills(options.generated === false ? undefined : context.snapshot, {
		version: context.snapshot.meta.version,
		name: options.name,
		description: options.description,
		extras: options.extras,
	});
	return files.map((file) => ({ path: join(SKILLS_ARTIFACT, file.path), content: file.content }));
}

type SkillScopeFlag = {
	readonly type: "string";
	readonly choices: readonly ["project", "global"];
	readonly description: typeof SCOPE_FLAG_DESCRIPTION;
};
type SkillAllFlag<Description extends string> = {
	readonly type: "boolean";
	readonly description: Description;
};
type SkillInstallFlags = {
	readonly scope: SkillScopeFlag;
	readonly all: SkillAllFlag<typeof INSTALL_ALL_DESCRIPTION>;
};

/**
 * The contributed skill management command, spelled out because the exported
 * factory needs a declared type: a closed name keeps the host's command tree
 * precise after `.extend()`.
 */
export type SkillCommandDefinition<
	Command extends string = typeof DEFAULT_SKILL_COMMAND_NAME,
	Aliases extends readonly string[] = SkillCommandAliases<Command>,
> = CommandDefinition<
	Command,
	Aliases,
	CommandShape<
		[],
		SkillInstallFlags,
		{
			install: CommandShape<[], SkillInstallFlags, {}, void, {}>;
			uninstall: CommandShape<
				[],
				{
					readonly scope: SkillScopeFlag;
					readonly all: SkillAllFlag<typeof UNINSTALL_ALL_DESCRIPTION>;
				},
				{},
				void,
				{}
			>;
			repair: CommandShape<[], { readonly scope: SkillScopeFlag }, {}, void, {}>;
		},
		void,
		{}
	>
>;

type SkillCommandAliases<Command extends string> = Command extends typeof DEFAULT_SKILL_COMMAND_NAME
	? readonly ["skill"]
	: readonly [];

// A non-literal name cannot be keyed statically, so it keeps the open command namespace.
type SkillCommands<Command extends string> = string extends Command
	? readonly CommandDefinition<any, any, any, any>[]
	: readonly [SkillCommandDefinition<Command>];

/**
 * {@link skill}'s signature: a `command` that is always present flows into the host's
 * command tree, an absent one is `skills`, and a possibly absent one stays open.
 */
export interface SkillExtension {
	<const Command extends string>(
		options: SkillOptions & { command: Command },
	): Extension<{}, [], {}, SkillCommands<Command>>;
	(
		options: SkillOptions & { command?: undefined },
	): Extension<{}, [], {}, readonly [SkillCommandDefinition]>;
	// Omitted `Commands` is the open command namespace.
	(options: SkillOptions): Extension<{}, [], {}>;
	readonly id: ExtensionId;
}

const skillFactory: ExtensionFactory<
	[options: SkillOptions],
	{},
	[],
	{},
	readonly [SkillCommandDefinition<string, readonly string[]>]
> = defineExtension(SKILLS).factory((extension, options) => {
	const commandName = options.command ?? DEFAULT_SKILL_COMMAND_NAME;
	return (
		extension
			.add(buildSkillCommand(commandName, options))
			.preRun(async (context) => {
				if (context.commandPath[1] === commandName || options.autoUpdate === false) return;
				// Only an installed CLI repairs its links. From source, the packaged directory is a
				// checkout's last build, and repairing would move every link away from the installed
				// CLI, which then moves them back on its next run.
				if (isSourceRun()) return;
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

// SAFETY: the runtime command name is `options.command ?? "skills"`, which each overload's name restates,
// and only the default name carries the `skill` alias.
export const skill = skillFactory as SkillExtension;

type SkillStatusEntry = SkillStatusResult["agents"][number];
type SkillStatusMap = ReadonlyMap<AgentTarget, SkillStatusEntry>;

function installedAgents(statusMap: SkillStatusMap): AgentTarget[] {
	return [...statusMap.values()].flatMap((entry) =>
		entry.status === "linked" || entry.status === "dangling" ? [entry.agent] : [],
	);
}

async function loadStatuses(scope: Scope): Promise<Map<PackagedSkill, SkillStatusMap>> {
	const statuses = new Map<PackagedSkill, SkillStatusMap>();
	for (const packagedSkill of loadArtifactSkills()) {
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
	const { multiselect } = await import("@crustjs/prompts");
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
	let statuses = [...(await loadStatuses(effectiveScope))];
	if (statuses.length === 0) return;
	if (!installAll && statuses.length > 1) {
		const skills = statuses.map(([packagedSkill]) => packagedSkill);
		const installedSkills = statuses.flatMap(([packagedSkill, statusMap]) =>
			installedAgents(statusMap).length > 0 ? [packagedSkill] : [],
		);
		const chosen = await selectSkills(
			"Select skills to install",
			skills,
			installedSkills.length > 0 ? installedSkills : skills,
		);
		statuses = statuses.filter(([packagedSkill]) => chosen.includes(packagedSkill));
		if (statuses.length === 0) {
			io.stdout(dim("No skills selected."));
			return;
		}
	}

	const detected = new Set(await detectInstalledAgents());
	const universal = getUniversalAgents();
	const installed = new Set(statuses.flatMap(([, statusMap]) => installedAgents(statusMap)));
	const additional = getAdditionalAgents().filter(
		(agent) => detected.has(agent) || installed.has(agent),
	);
	// Every skill links into the same per-agent skills root; hint the shared root.
	const rootHint = (agent: AgentTarget) => {
		const outputDir = statuses[0]?.[1].get(agent)?.outputDir;
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
		const { multiselect } = await import("@crustjs/prompts");
		const values = await multiselect({
			message: "Select agents to install for",
			choices,
			default: defaults,
			required: false,
		});
		selected = values.filter((value): value is AgentTarget => value !== UNIVERSAL_GROUP);
		if (values.includes(UNIVERSAL_GROUP)) selected.push(...universal);
	}

	for (const [packagedSkill, statusMap] of statuses) {
		await installSelectedAgents({
			packagedSkill,
			statusMap,
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

	const [{ spinner }, { confirm }] = await Promise.all([
		import("@crustjs/progress"),
		import("@crustjs/prompts"),
	]);
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
	const { spinner } = await import("@crustjs/progress");
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

const SCOPE_FLAG_DESCRIPTION = "Skill scope (project or global)";
const INSTALL_ALL_DESCRIPTION =
	"Install for every detected agent and every agent already holding a packaged skill, non-interactively";
const UNINSTALL_ALL_DESCRIPTION = "Uninstall every installed skill non-interactively";

const SCOPE_FLAG = {
	scope: {
		type: "string",
		choices: ["project", "global"],
		description: SCOPE_FLAG_DESCRIPTION,
	},
} as const;

const INSTALL_FLAGS = {
	...SCOPE_FLAG,
	all: {
		type: "boolean",
		description: INSTALL_ALL_DESCRIPTION,
	},
} as const;

type SkillActionContext = SkillIO & { flags: { scope?: Scope; all?: boolean } };

function buildSkillCommand(commandName: string, options: SkillOptions) {
	const install = async (context: SkillActionContext) => {
		const installAll = context.flags.all === true;
		const scope = await resolveScope(context.flags.scope, options, installAll);
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
				.flags(INSTALL_FLAGS)
				.add(
					defineCommand(
						"install",
						{
							description:
								"Link packaged skills into agent directories; never removes existing links",
						},
						(sub) => sub.flags(INSTALL_FLAGS).action(install),
					),
				)
				.add(
					defineCommand("uninstall", { description: "Remove installed skill links" }, (sub) =>
						sub
							.flags({
								...SCOPE_FLAG,
								all: { type: "boolean", description: UNINSTALL_ALL_DESCRIPTION },
							})
							.action(async (context) => {
								const removeAll = context.flags.all === true;
								const scope = await resolveScope(context.flags.scope, options, removeAll);
								await uninstallSkills({ scope, removeAll, io: context });
							}),
					),
				)
				.add(
					defineCommand("repair", { description: "Repair installed skill links" }, (sub) =>
						sub.flags(SCOPE_FLAG).action(async (context) => {
							const scope = await resolveScope(context.flags.scope, options);
							for (const packagedSkill of loadArtifactSkills()) {
								await repairInstalledSkill(packagedSkill, scope, context, true);
							}
						}),
					),
				)
				.action(install),
	);
}
