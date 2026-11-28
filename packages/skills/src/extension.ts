import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import {
	type BuildArtifacts,
	type CommandDefinition,
	type CommandShape,
	type Extension,
	type ExtensionBuildContext,
	type ExtensionFactory,
	type ExtensionSectionContribution,
	type InvocationIO,
	type CommandSnapshot,
	CrustError,
	defineCommand,
	defineExtension,
} from "@crustjs/core";
// @crustjs/prompts and @crustjs/progress load inside the `skills` command so other commands skip their import cost.
import { bold, dim, yellow } from "@crustjs/style";
import { BUILD_OUT_DIR_ENV, artifactPath, isSourceRun } from "@crustjs/utils/artifacts";
import { isWithin, resolvePathLike } from "@crustjs/utils/path";

import {
	AGENT_LABELS,
	ALL_AGENTS,
	detectInstalledAgents,
	getScopeAgents,
	isAgentAvailable,
	readsSharedFolder,
} from "./agents.ts";
import type { AgentTarget, Scope } from "./agents.ts";
import { renderSkills } from "./build.ts";
import { SKILL_MD } from "./bundle.ts";
import { SkillConflictError } from "./errors.ts";
import { SKILLS } from "./id.ts";
import {
	getSharedSkillStatus,
	getSkillStatus,
	groupAgentsByOutputDir,
	installSkill,
	uninstallSkill,
} from "./install.ts";
import { resolveEffectiveScope, sharedSkillsDir } from "./link.ts";
import {
	SKILLS_ARTIFACT,
	SkillSourceUnavailableError,
	loadPackagedSkills,
	readSkillFrontmatter,
	type PackagedSkill,
} from "./source.ts";
import type { SkillOptions, SkillStatusResult } from "./types.ts";

const DEFAULT_SKILL_COMMAND_NAME = "skills";
const SKILLS_SECTION_TITLE = "Agent skills";
const DEFAULT_SKILL_SCOPE = "global";
const SHARED_LABEL = "Shared";

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

function parseAgentFlag(values: readonly string[]): AgentTarget[] {
	return [...new Set(values)].map((value) => {
		const agent = ALL_AGENTS.find((id) => id === value);
		if (agent) return agent;
		throw new CrustError(
			"PARSE",
			`Unknown agent "${value}" for --agent. Agent ids are listed at https://crustjs.com/docs/modules/skills#supported-agents.`,
			{ flag: "agent" },
		);
	});
}

/** Checks `--skill` values against the packaged skills. */
function checkSkillFlag(names: readonly string[]): readonly string[] {
	const skills = loadPackagedSkills().map((packagedSkill) => packagedSkill.name);
	const unknown = names.find((name) => !skills.includes(name));
	if (unknown !== undefined) {
		throw new CrustError(
			"PARSE",
			`Unknown skill "${unknown}" for --skill. Packaged skills: ${skills.join(", ")}.`,
			{ flag: "skill" },
		);
	}
	return names;
}

function conflictWarning(name: string, outputDir: string): string {
	return yellow(
		`Skill conflict [${name}]: "${outputDir}" is not owned by this skill. Skipping link repair.`,
	);
}

/** One label per link folder: the shared folder reads "Shared", others name their agents. */
function linkLabels(entries: readonly { agent?: AgentTarget; outputDir: string }[], scope: Scope) {
	return [...Map.groupBy(entries, (entry) => entry.outputDir)].map(([outputDir, group]) => ({
		outputDir,
		label:
			dirname(outputDir) === sharedSkillsDir(scope)
				? SHARED_LABEL
				: group.flatMap((entry) => (entry.agent ? [AGENT_LABELS[entry.agent]] : [])).join(", "),
	}));
}

/** The `repair` command: re-points the shared link and every owned agent link that is not linked. */
async function repairInstalledSkill(
	packagedSkill: PackagedSkill,
	scope: Scope,
	io: SkillIO,
): Promise<void> {
	const effectiveScope = resolveEffectiveScope(scope);
	const status = await getSkillStatus({
		name: packagedSkill.name,
		sourceDir: packagedSkill.sourceDir,
		scope,
	});
	const conflicts = new Set(
		status.agents.filter((entry) => entry.status === "conflict").map((entry) => entry.outputDir),
	);
	for (const outputDir of conflicts) io.stderr(conflictWarning(packagedSkill.name, outputDir));
	const dangling = status.agents.filter((entry) => entry.status === "dangling");
	if (dangling.length === 0) {
		io.stdout(dim(`No repairs needed [${packagedSkill.name}] (${effectiveScope}).`));
		return;
	}
	// Agent links point at the shared link, so they cannot be repaired past a conflict there.
	if (conflicts.has(join(sharedSkillsDir(effectiveScope), packagedSkill.name))) return;

	try {
		const result = await installSkill({
			sourceDir: packagedSkill.sourceDir,
			agents: dangling.map((entry) => entry.agent),
			scope,
		});
		const changed = [result.shared, ...result.agents].filter(
			(entry) => entry.status !== "up-to-date",
		);
		const labels = linkLabels(changed, effectiveScope).map((entry) => entry.label);
		if (labels.length > 0) {
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

/**
 * Before ordinary commands: re-links our shared link only when its target is gone, silently.
 * Which installed copy should own a working link cannot be told reliably, so a link to another
 * live copy, like a conflict at the shared path, is left to `skills repair`. Agent links point at
 * the shared link, which does not move, so they are not inspected.
 */
async function repairBrokenSharedLink(packagedSkill: PackagedSkill, scope: Scope): Promise<void> {
	const shared = await getSharedSkillStatus({
		name: packagedSkill.name,
		sourceDir: packagedSkill.sourceDir,
		scope,
	});
	if (shared.status !== "dangling" || existsSync(shared.outputDir)) return;
	await installSkill({ sourceDir: packagedSkill.sourceDir, agents: [], scope });
}

async function autoRepairSkills(options: SkillOptions, io: SkillIO): Promise<void> {
	let skills: readonly PackagedSkill[];
	try {
		skills = loadPackagedSkills();
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
				await repairBrokenSharedLink(packagedSkill, scope);
			} catch (error) {
				// A failed repair (including a conflict that appeared since the check) must not abort the user's
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

function formatSkillDocumentation(
	commandName: string,
	appName: string,
	load: () => readonly PackagedSkill[],
): string {
	try {
		return load()
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

/**
 * The skills {@link buildSkills} writes, read from the options and the authored `SKILL.md` files
 * instead of the build output, so the docs section is the same whatever the build hooks' order.
 */
function plannedSkills(options: SkillOptions, snapshot: CommandSnapshot): readonly PackagedSkill[] {
	const skills = new Map<string, string>();
	for (const extra of options.extras ?? []) {
		const dir = resolvePathLike(extra);
		// The bundle's rule for an authored file, before the file is read: a regular file inside
		// the skill. A link out of it is not followed, and a pipe cannot stall the build.
		const entry = realpathSync(join(dir, SKILL_MD));
		if (!isWithin(realpathSync(dir), entry) || !statSync(entry).isFile()) {
			throw new Error(`"${join(dir, SKILL_MD)}" is not a file inside its skill directory.`);
		}
		const { name, description } = readSkillFrontmatter(dir);
		skills.set(name, description);
	}
	const generated = options.name ?? snapshot.meta.name;
	if (options.generated !== false && !skills.has(generated)) {
		skills.set(generated, options.description ?? snapshot.meta.description ?? "");
	}
	const root = artifactPath(SKILLS_ARTIFACT);
	return [...skills]
		.map(([name, description]) => ({ name, description, sourceDir: join(root, name) }))
		.sort((a, b) => a.name.localeCompare(b.name));
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
type SkillRepeatableFlag<Description extends string> = {
	readonly type: "string";
	readonly multiple: true;
	readonly description: Description;
};
type SkillNameFlag = SkillRepeatableFlag<typeof SKILL_FLAG_DESCRIPTION>;
type SkillInstallFlags = {
	readonly scope: SkillScopeFlag;
	readonly all: SkillAllFlag<typeof INSTALL_ALL_DESCRIPTION>;
	readonly agent: SkillRepeatableFlag<typeof AGENT_FLAG_DESCRIPTION>;
	readonly skill: SkillNameFlag;
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
					readonly skill: SkillNameFlag;
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
 * The `skills()` factory's signature: a `command` that is always present flows into the host's
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
	readonly id: string;
}

const skillFactory: ExtensionFactory<
	[options: SkillOptions],
	{},
	[],
	{},
	readonly [SkillCommandDefinition<string, readonly string[]>]
> = defineExtension(SKILLS).factory((extension, options) => {
	const commandName = options.command ?? DEFAULT_SKILL_COMMAND_NAME;
	const runtime = extension.add(buildSkillCommand(commandName, options)).preRun(async (context) => {
		if (context.commandPath[1] === commandName || options.autoUpdate === false) return;
		// Only an installed CLI repairs its links. From source, the packaged directory is a
		// checkout's last build, and repairing would move every link away from the installed
		// CLI, which then moves them back on its next run.
		if (isSourceRun()) return;
		await autoRepairSkills(options, context);
	});
	// Skills are loaded when a snapshot is prepared, not at construction, so
	// help and man pages reflect the packaged directory as it exists at render time.
	const section = (
		appName: string,
		load: () => readonly PackagedSkill[],
	): readonly ExtensionSectionContribution[] => [
		{
			command: [],
			title: SKILLS_SECTION_TITLE,
			body: formatSkillDocumentation(commandName, appName, load),
			except: [extension],
		},
	];
	// `crust build` runs build hooks from source; literal property access lets a Crust-built
	// bundle fold this and drop the skill renderer.
	return process.env.CRUST_INTERNAL_BUILD === "1"
		? runtime.sections((snapshot) => section(snapshot.meta.name, loadPackagedSkills))
		: runtime
				// `crust build` prepares the snapshot before this hook writes the skills.
				.sections((snapshot) =>
					section(snapshot.meta.name, () =>
						process.env[BUILD_OUT_DIR_ENV]
							? plannedSkills(options, snapshot)
							: loadPackagedSkills(),
					),
				)
				.build((context) => buildSkills(options, context));
});

// SAFETY: the runtime command name is `options.command ?? "skills"`, which each overload's name restates,
// and only the default name carries the `skill` alias.
const skillsExtension = skillFactory as SkillExtension;
// Exported under its public name without a module binding, which local `skills` lists would shadow.
export { skillsExtension as skills };

type SkillStatusEntry = SkillStatusResult["agents"][number];
type SkillStatusMap = ReadonlyMap<AgentTarget, SkillStatusEntry>;

function installedAgents(statusMap: SkillStatusMap): AgentTarget[] {
	return [...statusMap.values()].flatMap((entry) =>
		entry.status === "linked" || entry.status === "dangling" ? [entry.agent] : [],
	);
}

async function loadStatuses(scope: Scope): Promise<Map<PackagedSkill, SkillStatusMap>> {
	const statuses = new Map<PackagedSkill, SkillStatusMap>();
	for (const packagedSkill of loadPackagedSkills()) {
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
	entries: readonly { agent?: AgentTarget; outputDir: string }[],
	scope: Scope,
): void {
	// Agents sharing one directory report as one line.
	for (const { outputDir, label } of linkLabels(entries, scope)) {
		io.stdout(dim(`  ${label} → ${outputDir}`));
	}
}

async function installSkills(opts: {
	scope: Scope;
	installAll: boolean;
	/** From `--agent`: skips the agent prompt and conflict confirmations. */
	agents?: readonly AgentTarget[] | undefined;
	/** From `--skill`: skips the skill prompt. */
	skills?: readonly string[] | undefined;
	io: SkillIO;
}): Promise<void> {
	const { installAll, io } = opts;
	const effectiveScope = resolveEffectiveScope(opts.scope);
	const unavailable = opts.agents?.find((agent) => !isAgentAvailable(agent, effectiveScope));
	if (unavailable) {
		throw new CrustError(
			"PARSE",
			`Agent "${unavailable}" (${AGENT_LABELS[unavailable]}) has no global skills directory; use --scope project.`,
			{ flag: "agent" },
		);
	}
	let statuses = [...(await loadStatuses(effectiveScope))];
	if (statuses.length === 0) return;
	const namedSkills = opts.skills;
	if (namedSkills) {
		statuses = statuses.filter(([packagedSkill]) => namedSkills.includes(packagedSkill.name));
	} else if (!installAll && statuses.length > 1) {
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

	let selected: AgentTarget[];
	if (opts.agents) selected = [...opts.agents];
	else {
		const detected = new Set(await detectInstalledAgents());
		const installed = new Set(statuses.flatMap(([, statusMap]) => installedAgents(statusMap)));
		// Agents reading the shared folder need no link of their own.
		const candidates = getScopeAgents(effectiveScope).filter(
			(agent) =>
				!readsSharedFolder(agent, effectiveScope) && (detected.has(agent) || installed.has(agent)),
		);
		if (installAll || candidates.length === 0) selected = candidates;
		else {
			// Every skill links into the same per-agent skills root; hint that root.
			const rootHint = (agent: AgentTarget) => {
				const outputDir = statuses[0]?.[1].get(agent)?.outputDir;
				return outputDir ? dirname(outputDir) : "path unavailable";
			};
			const { multiselect } = await import("@crustjs/prompts");
			selected = await multiselect({
				message: "Select agents to link (the shared .agents/skills folder is always linked)",
				choices: candidates.map((agent) => ({
					label: AGENT_LABELS[agent],
					value: agent,
					hint: rootHint(agent),
				})),
				default: candidates.filter((agent) => installed.has(agent)),
				required: false,
			});
		}
	}

	for (const [packagedSkill, statusMap] of statuses) {
		await installSelectedAgents({
			packagedSkill,
			statusMap,
			selected,
			scope: effectiveScope,
			nonInteractive: installAll || opts.agents !== undefined,
			io,
		});
	}
}

/**
 * Additive only: links the shared folder, then the selected agents' own folders to it;
 * unselected links are left untouched. Without the shared link no agent link is made.
 */
async function installSelectedAgents(opts: {
	packagedSkill: PackagedSkill;
	statusMap: SkillStatusMap;
	selected: readonly AgentTarget[];
	scope: Scope;
	/** Skip conflicts with a warning instead of asking to overwrite. */
	nonInteractive: boolean;
	io: SkillIO;
}): Promise<void> {
	const { packagedSkill, statusMap, selected, scope, nonInteractive, io } = opts;
	const toInstall = selected.filter(
		(agent) => !readsSharedFolder(agent, scope) && statusMap.get(agent)?.status !== "linked",
	);
	const shared = await getSharedSkillStatus({
		name: packagedSkill.name,
		sourceDir: packagedSkill.sourceDir,
		scope,
	});
	if (shared.status === "linked" && toInstall.length === 0) {
		io.stdout(dim(`No changes [${packagedSkill.name}].`));
		return;
	}

	const [{ spinner }, { confirm }] = await Promise.all([
		import("@crustjs/progress"),
		import("@crustjs/prompts"),
	]);
	// Each approval covers only the path it named; a conflict at another path is asked about separately.
	const install = async (agents: AgentTarget[], label: string) => {
		const approved: string[] = [];
		for (;;) {
			try {
				return await spinner({
					message: `Installing skill [${packagedSkill.name}]...`,
					task: () =>
						installSkill({ sourceDir: packagedSkill.sourceDir, agents, scope, force: approved }),
				});
			} catch (error) {
				if (!(error instanceof SkillConflictError)) throw error;
				const skipped = `Skipped ${error.details.agent ? label : SHARED_LABEL} [${packagedSkill.name}]: directory is not owned by this skill.`;
				if (nonInteractive) {
					io.stderr(yellow(skipped));
					return undefined;
				}
				const overwrite = await confirm({
					message: `"${error.details.outputDir}" is not owned by "${packagedSkill.name}". Overwrite?`,
					default: false,
				});
				if (!overwrite) {
					io.stdout(dim(skipped));
					return undefined;
				}
				approved.push(error.details.outputDir);
			}
		}
	};

	const sharedResult = await install([], SHARED_LABEL);
	if (!sharedResult) return;
	const linked: Array<{ agent?: AgentTarget; outputDir: string }> =
		sharedResult.shared.status === "up-to-date" ? [] : [sharedResult.shared];
	for (const agents of groupAgentsByOutputDir(toInstall, scope, packagedSkill.name).values()) {
		const result = await install(agents, agents.map((agent) => AGENT_LABELS[agent]).join(", "));
		if (result) linked.push(...result.agents);
	}
	if (linked.length > 0) {
		io.stdout(`\n${bold(`Installed "${packagedSkill.name}"`)}`);
		reportAgentDirs(io, linked, scope);
	}
}

async function uninstallSkills(opts: {
	scope: Scope;
	removeAll: boolean;
	/** From `--skill`: skips the skill prompt. */
	skills?: readonly string[] | undefined;
	io: SkillIO;
}): Promise<void> {
	const { removeAll, skills: namedSkills, io } = opts;
	const effectiveScope = resolveEffectiveScope(opts.scope);
	const statuses = await loadStatuses(effectiveScope);
	const installedSkills = [...statuses].flatMap(([packagedSkill, statusMap]) =>
		installedAgents(statusMap).length > 0 &&
		(namedSkills === undefined || namedSkills.includes(packagedSkill.name))
			? [packagedSkill]
			: [],
	);
	if (installedSkills.length === 0) {
		io.stdout(dim(`No installed skills (${effectiveScope}).`));
		return;
	}
	// No default: a preselected list would let a non-TTY run (which answers with
	// the default) remove every skill without --all.
	const skills =
		removeAll || namedSkills
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
		reportAgentDirs(io, removed, effectiveScope);
	}
}

const SCOPE_FLAG_DESCRIPTION = "Skill scope (project or global)";
const INSTALL_ALL_DESCRIPTION =
	"Install for every detected agent and every agent already holding a packaged skill, non-interactively";
const UNINSTALL_ALL_DESCRIPTION = "Uninstall every installed skill non-interactively";
const AGENT_FLAG_DESCRIPTION =
	"Agent to link besides the shared .agents/skills folder, repeatable; ids are listed at https://crustjs.com/docs/modules/skills#supported-agents";
const SKILL_FLAG_DESCRIPTION = "Packaged skill name, repeatable";

const SCOPE_FLAG = {
	scope: {
		type: "string",
		choices: ["project", "global"],
		description: SCOPE_FLAG_DESCRIPTION,
	},
} as const;

const SKILL_FLAG = {
	skill: {
		type: "string",
		multiple: true,
		description: SKILL_FLAG_DESCRIPTION,
	},
} as const;

const INSTALL_FLAGS = {
	...SCOPE_FLAG,
	all: {
		type: "boolean",
		description: INSTALL_ALL_DESCRIPTION,
	},
	agent: {
		type: "string",
		multiple: true,
		description: AGENT_FLAG_DESCRIPTION,
	},
	...SKILL_FLAG,
} as const;

type SkillActionContext = SkillIO & {
	flags: {
		scope?: Scope | undefined;
		all?: boolean | undefined;
		agent?: readonly string[] | undefined;
		skill?: readonly string[] | undefined;
	};
};

function buildSkillCommand(commandName: string, options: SkillOptions) {
	const install = async (context: SkillActionContext) => {
		const { all: installAll = false, agent: agentFlag, skill: skillFlag } = context.flags;
		if (installAll && (agentFlag || skillFlag)) {
			throw new CrustError("PARSE", "--all cannot be combined with --agent or --skill.", {
				flag: "all",
			});
		}
		const agents = agentFlag && parseAgentFlag(agentFlag);
		const skills = skillFlag && checkSkillFlag(skillFlag);
		const scope = await resolveScope(context.flags.scope, options, installAll);
		await installSkills({ scope, installAll, agents, skills, io: context });
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
								...SKILL_FLAG,
							})
							.action(async (context) => {
								const { all: removeAll = false, skill: skillFlag } = context.flags;
								if (removeAll && skillFlag) {
									throw new CrustError("PARSE", "--all cannot be combined with --skill.", {
										flag: "all",
									});
								}
								const skills = skillFlag && checkSkillFlag(skillFlag);
								const scope = await resolveScope(context.flags.scope, options, removeAll);
								await uninstallSkills({ scope, removeAll, skills, io: context });
							}),
					),
				)
				.add(
					defineCommand("repair", { description: "Repair installed skill links" }, (sub) =>
						sub.flags(SCOPE_FLAG).action(async (context) => {
							const scope = await resolveScope(context.flags.scope, options);
							for (const packagedSkill of loadPackagedSkills()) {
								await repairInstalledSkill(packagedSkill, scope, context);
							}
						}),
					),
				)
				.action(install),
	);
}
