import { join, relative } from "node:path";

import {
	type Extension,
	type ExtensionId,
	type ExtensionBuildContext,
	type InvocationIO,
	defineCommand,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import { spinner } from "@crustjs/progress";
import { confirm, multiselect, select } from "@crustjs/prompts";
import { bold, dim, yellow } from "@crustjs/style";
import { isWithin } from "@crustjs/utils/path";

import {
	AGENT_LABELS,
	detectInstalledAgents,
	getAdditionalAgents,
	getUniversalAgents,
} from "./agents.ts";
import { SkillConflictError } from "./errors.ts";
import {
	getSkillStatus,
	groupAgentsByOutputDir,
	installSkill,
	uninstallSkill,
} from "./generate.ts";
import { planReconcile, UNIVERSAL_GROUP, type ReconcileChoice } from "./reconcile.ts";
import { SkillSourceUnavailableError, loadPackagedSkills, type PackagedSkill } from "./source.ts";
import type { AgentTarget, InstallSkillResult, Scope, SkillOptions } from "./types.ts";

export const SKILLS: ExtensionId = defineExtensionId("crust:skills");

const DEFAULT_SKILL_COMMAND_NAME = "skill";
const SKILLS_SECTION_TITLE = "Agent skills";
const DEFAULT_SKILL_SCOPE = "global";

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
		skills = loadPackagedSkills(options.distDir);
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
	const scopes = [...new Set(configuredScopes)];
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

function formatSkillDocumentation(
	source: string | URL,
	commandName: string,
	appName: string,
): string {
	try {
		return loadPackagedSkills(source)
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
			return `The packaged skills directory is unavailable. Run \`${appName} ${commandName}\` to link packaged skills into an agent directory.`;
		}
		// No warn here: the preRun repair hook already surfaces the underlying
		// message once per invocation, and the explicit skill command fails loudly.
		return `Packaged skills could not be read. Run \`${appName} ${commandName}\` for details.`;
	}
}

async function buildSkills(options: SkillOptions, context: ExtensionBuildContext): Promise<void> {
	const { writeSkills, writeSkillsFromSnapshot } = await import("./build.ts");
	const writeOptions = {
		outDir: join(context.outDir, "skills"),
		version: context.snapshot.meta.version,
		name: options.name,
		description: options.description,
		extras: options.extras,
	};
	if (options.generated === false) await writeSkills(writeOptions);
	else await writeSkillsFromSnapshot(context.snapshot, writeOptions);
}

function skillFactory(options: SkillOptions): Extension {
	const commandName = options.command ?? DEFAULT_SKILL_COMMAND_NAME;
	return defineExtension(SKILLS, {
		commands: [buildSkillCommand(commandName, options)],
		// Skills are loaded when a snapshot is prepared, not at construction, so
		// help and man pages reflect the packaged directory as it exists at render time.
		sections: (snapshot) => [
			{
				command: [],
				title: SKILLS_SECTION_TITLE,
				body: formatSkillDocumentation(options.distDir, commandName, snapshot.meta.name),
				except: [SKILLS],
			},
		],
		build: (context) => buildSkills(options, context),
		hooks: {
			async preRun(context) {
				if (context.commandPath[1] === commandName || options.autoUpdate === false) return;
				await autoRepairSkills(options, context);
			},
		},
	});
}

export const skill: typeof skillFactory & { readonly id: ExtensionId } = Object.assign(
	skillFactory,
	{ id: SKILLS },
);

async function reconcileSkill(opts: {
	packagedSkill: PackagedSkill;
	scope: Scope;
	installAll: boolean;
	io: SkillIO;
}): Promise<void> {
	const { packagedSkill, scope, installAll, io } = opts;
	const detected = new Set(await detectInstalledAgents());
	const universal = getUniversalAgents();
	const status = await getSkillStatus({
		name: packagedSkill.name,
		sourceDir: packagedSkill.sourceDir,
		scope,
	});
	const statusMap = new Map(status.agents.map((entry) => [entry.agent, entry]));
	const installed = new Set(
		status.agents
			.filter((entry) => entry.status === "linked" || entry.status === "dangling")
			.map((entry) => entry.agent),
	);
	const additional = getAdditionalAgents().filter(
		(agent) => detected.has(agent) || installed.has(agent),
	);
	const choices: Array<ReconcileChoice & { hint: string }> = [];
	if (universal.length > 0) {
		choices.push({
			label: "Universal",
			value: UNIVERSAL_GROUP,
			hint: statusMap.get(universal[0]!)?.outputDir ?? "path unavailable",
		});
	}
	for (const agent of additional) {
		choices.push({
			label: AGENT_LABELS[agent],
			value: agent,
			hint: statusMap.get(agent)?.outputDir ?? "path unavailable",
		});
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
			message: `Select agents to install "${packagedSkill.name}" for`,
			choices,
			default: defaults,
			required: false,
		});
		selected = values.filter((value): value is AgentTarget => value !== UNIVERSAL_GROUP);
		if (values.includes(UNIVERSAL_GROUP)) selected.push(...universal);
	}

	const { toInstall, toUninstall, sharedDirWarnings } = planReconcile({
		statusMap,
		choices,
		selected,
		universal,
	});
	for (const warning of sharedDirWarnings) {
		io.stderr(
			yellow(
				`${warning.label} [${packagedSkill.name}]: "${warning.outputDir}" is shared with a selected agent, so the skill stays available to it.`,
			),
		);
	}

	if (toInstall.length > 0) {
		const groups = groupAgentsByOutputDir(toInstall, scope, packagedSkill.name);
		const installedAgents: InstallSkillResult["agents"] = [];
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
				installedAgents.push(...result.agents);
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
				installedAgents.push(...result.agents);
			}
		}
		if (installedAgents.length > 0) {
			io.stdout(`\n${bold(`Installed "${packagedSkill.name}"`)}`);
			for (const line of new Map(
				installedAgents.map((entry) => [formatAgentLabels([entry.agent])[0]!, entry.outputDir]),
			)) {
				io.stdout(dim(`  ${line[0]} → ${line[1]}`));
			}
		}
	}

	if (toUninstall.length > 0) {
		await spinner({
			message: `Removing skill [${packagedSkill.name}]...`,
			task: () =>
				uninstallSkill({
					name: packagedSkill.name,
					agents: toUninstall,
					scope,
				}),
		});
	}
	if (toInstall.length === 0 && toUninstall.length === 0) {
		io.stdout(dim(`No changes [${packagedSkill.name}].`));
	}
}

function buildSkillCommand(commandName: string, options: SkillOptions) {
	return defineCommand(
		commandName,
		{ description: "Manage agent skill installations" },
		(command) =>
			command
				.flags(
					{
						name: "scope",
						type: "string",
						choices: ["project", "global"],
						description: "Install scope (project or global)",
					},
					{
						name: "all",
						type: "boolean",
						description: "Install for all detected agents non-interactively",
					},
				)
				.add(
					defineCommand("update", { description: "Repair installed skill links" }, (update) =>
						update
							.flags({
								name: "scope",
								type: "string",
								choices: ["project", "global"],
								description: "Update scope (project or global)",
							})
							.action(async (context) => {
								const scope = await resolveScope(context.flags.scope, options);
								for (const packagedSkill of loadPackagedSkills(options.distDir)) {
									await repairInstalledSkill(packagedSkill, scope, context, true);
								}
							}),
					),
				)
				.action(async (context) => {
					const installAll = context.flags.all === true;
					const scope = installAll
						? (context.flags.scope ?? options.defaultScope ?? DEFAULT_SKILL_SCOPE)
						: await resolveScope(context.flags.scope, options);
					for (const packagedSkill of loadPackagedSkills(options.distDir)) {
						await reconcileSkill({ packagedSkill, scope, installAll, io: context });
					}
				}),
	);
}
