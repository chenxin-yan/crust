import { type Extension, defineCommand, defineExtension } from "@crustjs/core";
import { spinner } from "@crustjs/progress";
import { confirm, multiselect, select } from "@crustjs/prompts";
import { bold, dim, yellow } from "@crustjs/style";

import {
	AGENT_LABELS,
	detectInstalledAgents,
	getAdditionalAgents,
	getUniversalAgents,
	resolveEffectiveScope,
} from "./agents.ts";
import { SkillConflictError } from "./errors.ts";
import { getSkillStatus, installSkill, uninstallSkill } from "./generate.ts";
import { SkillSourceUnavailableError, loadPackagedSkills, type PackagedSkill } from "./source.ts";
import type { AgentTarget, InstallSkillResult, Scope, SkillOptions } from "./types.ts";

const DEFAULT_SKILL_COMMAND_NAME = "skill";
const DEFAULT_SKILL_SCOPE = "global";
const UNIVERSAL_GROUP = "__universal__";

function parseScopeFlag(value: string | undefined): Scope | undefined {
	if (value === undefined) return undefined;
	if (value !== "global" && value !== "project") {
		throw new Error(`Invalid --scope value: ${value}. Expected "project" or "global".`);
	}
	return value;
}

async function resolveScope(rawScope: string | undefined, options: SkillOptions): Promise<Scope> {
	const explicit = parseScopeFlag(rawScope);
	if (explicit) return explicit;
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

async function updateInstalledSkill(
	packagedSkill: PackagedSkill,
	scope: Scope,
	hooks: {
		onNoUpdate?: (scope: Scope) => void;
		onUpdated?: (labels: string[], scope: Scope) => void;
		onConflict?: (error: SkillConflictError) => void;
	} = {},
): Promise<void> {
	const effectiveScope = resolveEffectiveScope(scope);
	const status = await getSkillStatus({ name: packagedSkill.name, scope });
	const outdated = status.agents.filter(
		(entry) => entry.installed && entry.version !== packagedSkill.version,
	);
	if (outdated.length === 0) {
		hooks.onNoUpdate?.(effectiveScope);
		return;
	}

	try {
		const result = await spinner({
			message: `Updating ${effectiveScope} skills [${packagedSkill.name}]...`,
			task: () =>
				installSkill({
					sourceDir: packagedSkill.sourceDir,
					agents: outdated.map((entry) => entry.agent),
					scope,
				}),
		});
		const labels = formatAgentLabels(result.agents.map((entry) => entry.agent));
		if (labels.length > 0) hooks.onUpdated?.(labels, effectiveScope);
	} catch (error) {
		if (!(error instanceof SkillConflictError)) throw error;
		if (hooks.onConflict) hooks.onConflict(error);
		else {
			console.warn(
				yellow(
					`Skill conflict [${packagedSkill.name}]: "${error.details.outputDir}" is not owned by this skill. Skipping auto-update.`,
				),
			);
		}
	}
}

async function autoUpdateSkills(options: SkillOptions): Promise<void> {
	let skills: readonly PackagedSkill[];
	try {
		skills = await loadPackagedSkills(options.source);
	} catch (error) {
		// A missing or invalid packaged asset must not prevent unrelated CLI commands
		// from running; the explicit skill command surfaces the same failure loudly.
		if (!(error instanceof SkillSourceUnavailableError)) {
			console.warn(
				yellow(
					`Skipping skill auto-update: ${error instanceof Error ? error.message : String(error)}`,
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
		for (const scope of scopes) await updateInstalledSkill(packagedSkill, scope);
	}
}

export function skill(options: SkillOptions): Extension {
	const commandName = options.command ?? DEFAULT_SKILL_COMMAND_NAME;
	return defineExtension("skills", {
		commands: [buildSkillCommand(commandName, options)],
		hooks: {
			async preRun(context) {
				if (context.commandPath[1] === commandName || options.autoUpdate === false) return;
				await autoUpdateSkills(options);
			},
		},
	});
}

async function reconcileSkill(opts: {
	packagedSkill: PackagedSkill;
	scope: Scope;
	installAll: boolean;
}): Promise<void> {
	const { packagedSkill, scope, installAll } = opts;
	const detected = new Set(await detectInstalledAgents());
	const universal = getUniversalAgents();
	const status = await getSkillStatus({ name: packagedSkill.name, scope });
	const statusMap = new Map(status.agents.map((entry) => [entry.agent, entry]));
	const installed = new Set(
		status.agents.filter((entry) => entry.installed).map((entry) => entry.agent),
	);
	const additional = getAdditionalAgents().filter(
		(agent) => detected.has(agent) || installed.has(agent),
	);
	const choices: Array<{
		label: string;
		value: AgentTarget | typeof UNIVERSAL_GROUP;
		hint: string;
	}> = [];
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

	const toInstall = selected.filter((agent) => {
		const entry = statusMap.get(agent);
		return !entry?.installed || entry.version !== packagedSkill.version;
	});
	const toUninstall = [...installed].filter((agent) => !selected.includes(agent));

	if (toInstall.length > 0) {
		const groups = new Map<string, AgentTarget[]>();
		for (const agent of toInstall) {
			const outputDir = statusMap.get(agent)!.outputDir;
			const group = groups.get(outputDir);
			if (group) group.push(agent);
			else groups.set(outputDir, [agent]);
		}

		const installedAgents: InstallSkillResult["agents"] = [];
		for (const agents of groups.values()) {
			const runInstall = (force?: boolean) =>
				installSkill({ sourceDir: packagedSkill.sourceDir, agents, scope, force });
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
					console.warn(yellow(skipped));
					continue;
				}
				const overwrite = await confirm({
					message: `"${error.details.outputDir}" is not owned by "${packagedSkill.name}". Overwrite?`,
					default: false,
				});
				if (!overwrite) {
					console.log(dim(skipped));
					continue;
				}
				const result = await runInstall(true);
				installedAgents.push(...result.agents);
			}
		}
		if (installedAgents.length > 0) {
			console.log(`\n${bold(`Installed "${packagedSkill.name}" v${packagedSkill.version}`)}`);
			for (const line of new Map(
				installedAgents.map((entry) => [formatAgentLabels([entry.agent])[0]!, entry.outputDir]),
			)) {
				console.log(dim(`  ${line[0]} → ${line[1]}`));
			}
		}
	}

	if (toUninstall.length > 0) {
		await spinner({
			message: `Removing skill [${packagedSkill.name}]...`,
			task: () => uninstallSkill({ name: packagedSkill.name, agents: toUninstall, scope }),
		});
	}
	if (toInstall.length === 0 && toUninstall.length === 0) {
		console.log(dim(`No changes [${packagedSkill.name}].`));
	}
}

function buildSkillCommand(commandName: string, options: SkillOptions) {
	return defineCommand(
		commandName,
		{ description: "Manage agent skill installations" },
		(command) =>
			command
				.flags(
					{ name: "scope", type: "string", description: "Install scope (project or global)" },
					{
						name: "all",
						type: "boolean",
						description: "Install for all detected agents non-interactively",
					},
				)
				.add(
					defineCommand("update", { description: "Update installed skills" }, (update) =>
						update
							.flags({
								name: "scope",
								type: "string",
								description: "Update scope (project or global)",
							})
							.action(async (context) => {
								const scope = await resolveScope(context.flags.scope, options);
								for (const packagedSkill of await loadPackagedSkills(options.source)) {
									await updateInstalledSkill(packagedSkill, scope, {
										onNoUpdate: (resolvedScope) =>
											console.log(
												dim(`No updates needed [${packagedSkill.name}] (${resolvedScope}).`),
											),
										onUpdated: (labels, resolvedScope) =>
											console.log(
												`\n${bold(`Updated "${packagedSkill.name}" to v${packagedSkill.version} for ${labels.join(", ")} (${resolvedScope})`)}`,
											),
										onConflict: (error) =>
											console.warn(
												yellow(`Skipped "${error.details.outputDir}": not owned by this skill.`),
											),
									});
								}
							}),
					),
				)
				.action(async (context) => {
					const installAll = context.flags.all === true;
					const scope = installAll
						? (parseScopeFlag(context.flags.scope) ?? options.defaultScope ?? DEFAULT_SKILL_SCOPE)
						: await resolveScope(context.flags.scope, options);
					for (const packagedSkill of await loadPackagedSkills(options.source)) {
						await reconcileSkill({ packagedSkill, scope, installAll });
					}
				}),
	);
}
