// ────────────────────────────────────────────────────────────────────────────
// Extension layer — skill() with interactive command injection
// ────────────────────────────────────────────────────────────────────────────

import {
	type CommandSnapshot,
	Crust,
	type Extension,
	defineCommand,
	defineExtension,
} from "@crustjs/core";
import { spinner } from "@crustjs/progress";
import { confirm, multiselect, select } from "@crustjs/prompts";
import { bold, dim, yellow } from "@crustjs/style";

import {
	AGENT_LABELS,
	detectInstalledAgents,
	getAdditionalAgents,
	getUniversalAgents,
	resolveAgentPath,
	resolveEffectiveScope,
} from "./agents.ts";
import { installSkillBundle } from "./bundle.ts";
import { SkillConflictError } from "./errors.ts";
import { generateSkill, isValidSkillName, skillStatus, uninstallSkill } from "./generate.ts";
import type {
	AgentTarget,
	CustomSkillConfig,
	GenerateResult,
	Scope,
	SkillMeta,
	SkillOptions,
} from "./types.ts";

const DEFAULT_SKILL_COMMAND_NAME = "skill";
const DEFAULT_SKILL_SCOPE = "global";
const UNIVERSAL_GROUP = "__universal__";

interface SkillInstallFlags {
	readonly scope?: string;
	readonly all?: boolean;
}

interface SkillUpdateFlags {
	readonly scope?: string;
}

function isScope(value: unknown): value is Scope {
	return value === "global" || value === "project";
}

/**
 * Validates an explicit `--scope` flag. Returns the typed scope when set,
 * `undefined` when omitted. Throws on a non-Scope string so the caller
 * does not need to repeat the check.
 */
function parseScopeFlag(rawScope: string | undefined): Scope | undefined {
	if (rawScope === undefined) return undefined;
	if (!isScope(rawScope)) {
		throw new Error(`Invalid --scope value: ${rawScope}. Expected "project" or "global".`);
	}
	return rawScope;
}

async function resolveScopeForCommand(
	rawScope: string | undefined,
	options: SkillOptions,
): Promise<Scope> {
	const explicit = parseScopeFlag(rawScope);
	if (explicit !== undefined) return explicit;

	if (options.defaultScope) {
		return options.defaultScope;
	}

	return select<Scope>({
		message: "Select scope",
		choices: [
			{ label: "Project", value: "project" },
			{ label: "Global", value: "global" },
		],
		default: DEFAULT_SKILL_SCOPE,
	});
}

function formatAgentLabels(agents: AgentTarget[]): string[] {
	const universalSet = new Set(getUniversalAgents());
	const labels: string[] = [];

	if (agents.some((agent) => universalSet.has(agent))) {
		labels.push("Universal");
	}

	for (const agent of agents) {
		if (universalSet.has(agent)) {
			continue;
		}
		labels.push(AGENT_LABELS[agent]);
	}

	return labels;
}

function formatInstallOutput(
	results: Array<{ agent: AgentTarget; outputDir: string }>,
): Array<{ label: string; outputDir: string }> {
	const labels = formatAgentLabels(results.map((result) => result.agent));
	const outputDirs = new Map(
		results.map((result) => [formatAgentLabels([result.agent])[0]!, result.outputDir]),
	);
	return labels.map((label) => ({ label, outputDir: outputDirs.get(label)! }));
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Derives a {@link SkillMeta} from a command's `meta` and plugin options.
 *
 * The returned `name` is the canonical raw CLI name (e.g. `"my-cli"`).
 */
function deriveSkillMeta(command: CommandSnapshot, options: SkillOptions): SkillMeta {
	return {
		name: command.meta.name,
		description: command.meta.description ?? "",
		version: options.version,
		instructions: options.instructions,
		license: options.license,
		allowedTools: options.allowedTools,
		compatibility: options.compatibility,
		disableModelInvocation: options.disableModelInvocation,
	};
}

/** Validates custom skill config invariants that TypeScript cannot constrain. */
function validateCustomSkillsConfig(
	mainName: string,
	customSkills: readonly CustomSkillConfig[] | undefined,
): readonly CustomSkillConfig[] {
	if (!customSkills?.length) return [];

	const seen = new Set<string>();
	for (const [index, entry] of customSkills.entries()) {
		if (!isValidSkillName(entry.name)) {
			throw new Error(
				`skill: customSkills[${index}].name "${entry.name}" is not a valid skill name. ` +
					`Must be 1–64 lowercase alphanumeric characters and hyphens, ` +
					`no leading/trailing/consecutive hyphens.`,
			);
		}
		if (entry.name === mainName) {
			throw new Error(
				`skill: customSkills[${index}].name "${entry.name}" collides with the main skill name. ` +
					`Custom skill bundle names must differ from the root command name.`,
			);
		}
		if (seen.has(entry.name)) {
			throw new Error(
				`skill: customSkills contains duplicate name "${entry.name}". ` +
					`Each entry must declare a unique name.`,
			);
		}
		seen.add(entry.name);

		if (entry.version !== undefined && entry.version.length === 0) {
			throw new Error(
				`skill: customSkills[${index}].version (for "${entry.name}") ` +
					`must be a non-empty string when set, or omitted to inherit the plugin's \`version\`.`,
			);
		}
	}

	return customSkills;
}

/** Resolves the effective scope for a custom-skill auto-update sweep. */
function resolveCustomSkillScopes(entry: CustomSkillConfig, options: SkillOptions): Scope[] {
	// When the entry declares an explicit scope, only that scope is checked.
	// Otherwise, fall through to plugin defaultScope, else mirror main-skill
	// behavior (check both project + global, deduped via resolveEffectiveScope).
	const explicit = entry.scope ?? options.defaultScope;
	if (explicit !== undefined) {
		return [resolveEffectiveScope(explicit)];
	}
	return [
		...new Set((["project", "global"] as Scope[]).map((scope) => resolveEffectiveScope(scope))),
	];
}

/**
 * Reconciles a single hand-authored bundle entry for `autoUpdateSkills` and
 * `skill update`. Mirrors the main-skill loop body: per-scope `skillStatus`,
 * version diff, then a single `installSkillBundle` call for outdated agents.
 *
 * Per-scope `SkillConflictError`s are logged (including `kindMismatch`) and
 * other errors propagate. Callers wrap this in their own try/catch when they
 * want per-entry resilience across multiple bundles.
 */
async function autoUpdateCustomSkill(
	entry: CustomSkillConfig,
	options: SkillOptions,
	hooks: {
		scopes?: Scope[];
		onNoUpdate?: (scope: Scope) => void;
		onUpdated?: (message: string) => void;
		onConflict?: (error: SkillConflictError, scope: Scope) => void;
	} = {},
): Promise<void> {
	const scopes = hooks.scopes ?? resolveCustomSkillScopes(entry, options);
	const installMode = entry.installMode ?? options.installMode;
	const effectiveVersion = entry.version ?? options.version;

	for (const scope of scopes) {
		const effectiveScope = resolveEffectiveScope(scope);
		const status = await skillStatus({ name: entry.name, scope });
		const needsUpdate = status.agents.filter((agent) => {
			if (!agent.installed) return false;
			const expectedOutputDir = resolveAgentPath(agent.agent, scope, entry.name);
			return agent.version !== effectiveVersion || agent.outputDir !== expectedOutputDir;
		});

		if (needsUpdate.length === 0) {
			hooks.onNoUpdate?.(effectiveScope);
			continue;
		}

		try {
			await spinner({
				message: `Updating ${effectiveScope} skills [${entry.name}]...`,
				task: async ({ updateMessage }) => {
					const result = await installSkillBundle({
						sourceDir: entry.sourceDir,
						agents: needsUpdate.map((agent) => agent.agent),
						version: effectiveVersion,
						scope,
						installMode,
						expectedName: entry.name,
					});
					const updatedLabels = formatAgentLabels(
						result.agents.filter((agent) => agent.status === "updated").map((agent) => agent.agent),
					);
					if (updatedLabels.length > 0) {
						const message = `Updated bundle "${entry.name}" to v${effectiveVersion} for ${updatedLabels.join(", ")} (${effectiveScope})`;
						if (hooks.onUpdated) {
							hooks.onUpdated(message);
						} else {
							updateMessage(message);
						}
					}
					return result;
				},
			});
		} catch (err) {
			if (!(err instanceof SkillConflictError)) throw err;
			if (hooks.onConflict) {
				hooks.onConflict(err, effectiveScope);
				continue;
			}
			const kindMismatchSuffix = err.details.kindMismatch
				? ` (existing skill is "${err.details.kindMismatch.existing}", attempted "${err.details.kindMismatch.attempted}")`
				: "";
			console.warn(
				yellow(
					`Skill conflict [${entry.name}]: "${err.details.outputDir}" already exists ` +
						`but conflicts with the requested install${kindMismatchSuffix}. ` +
						`Skipping auto-update for ${effectiveScope}. ` +
						`Delete or rename the conflicting skill to resolve.`,
				),
			);
		}
	}
}

function needsSkillReconciliation(
	meta: SkillMeta,
	entry: { installed: boolean; version?: string },
): boolean {
	return entry.installed && entry.version !== meta.version;
}

async function updateGeneratedSkill(
	rootCmd: CommandSnapshot,
	options: SkillOptions,
	scope: Scope,
	hooks: {
		onNoUpdate?: (scope: Scope) => void;
		onUpdated?: (labels: string[], scope: Scope) => void;
		onConflict?: (error: SkillConflictError, scope: Scope) => void;
	} = {},
): Promise<void> {
	const effectiveScope = resolveEffectiveScope(scope);
	const meta = deriveSkillMeta(rootCmd, options);
	const status = await skillStatus({ name: meta.name, scope });
	const needsUpdate = status.agents.filter((entry) => needsSkillReconciliation(meta, entry));

	if (needsUpdate.length === 0) {
		hooks.onNoUpdate?.(effectiveScope);
		return;
	}

	try {
		await spinner({
			message: `Updating ${effectiveScope} skills...`,
			task: async ({ updateMessage }) => {
				const result = await generateSkill({
					command: rootCmd,
					meta,
					agents: needsUpdate.map((entry) => entry.agent),
					scope,
					installMode: options.installMode,
				});
				const labels = formatAgentLabels(
					result.agents.filter((entry) => entry.status === "updated").map((entry) => entry.agent),
				);
				if (labels.length > 0) {
					if (hooks.onUpdated) hooks.onUpdated(labels, effectiveScope);
					else {
						updateMessage(
							`Updated skill "${meta.name}" to v${meta.version} for ${labels.join(", ")} (${effectiveScope})`,
						);
					}
				}
				return result;
			},
		});
	} catch (err) {
		if (!(err instanceof SkillConflictError)) throw err;
		if (hooks.onConflict) {
			hooks.onConflict(err, effectiveScope);
			return;
		}
		console.warn(
			yellow(
				`Skill conflict: "${err.details.outputDir}" already exists ` +
					`but was not created by ${meta.name}. Skipping auto-update for ${effectiveScope}. ` +
					`Delete or rename the conflicting skill to resolve.`,
			),
		);
	}
}

/**
 * Performs automatic updates for already-installed skills when the version
 * has changed.
 *
 * Runs during plugin setup so behavior is independent of middleware ordering.
 * Only updates skills that are already installed — first-time installation
 * should be done via the interactive command or programmatically by the user.
 */
async function autoUpdateSkills(
	rootCmd: CommandSnapshot,
	options: SkillOptions,
	customSkills: readonly CustomSkillConfig[],
): Promise<void> {
	const scopesToCheck: Scope[] = [
		...new Set((["project", "global"] as Scope[]).map((scope) => resolveEffectiveScope(scope))),
	];

	for (const scope of scopesToCheck) {
		await updateGeneratedSkill(rootCmd, options, scope);
	}

	await autoUpdateCustomSkillsLoop(customSkills, options);
}

/**
 * Iterates each `customSkills` entry and delegates to
 * {@link autoUpdateCustomSkill}, isolating per-entry failures so a single
 * broken bundle does not abort the others.
 */
async function autoUpdateCustomSkillsLoop(
	customSkills: readonly CustomSkillConfig[],
	options: SkillOptions,
): Promise<void> {
	for (const entry of customSkills) {
		try {
			await autoUpdateCustomSkill(entry, options);
		} catch (err) {
			// Startup auto-update is opportunistic: log and continue so a single
			// broken bundle (missing sourceDir, frontmatter mismatch, FS error,
			// etc.) does not stop the user's CLI from running. Per-bundle
			// `SkillConflictError`s are already narrowed inside
			// `autoUpdateCustomSkill`. Unlike the explicit `skill --all` /
			// `skill update` paths, this loop never sets `process.exitCode`.
			const message = err instanceof Error ? err.message : String(err);
			console.warn(
				yellow(
					`Skill auto-update failed [${entry.name}]: ${message}. ` +
						`Continuing with remaining skills.`,
				),
			);
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Skill plugin
// ────────────────────────────────────────────────────────────────────────────

/**
 * Plugin that manages agent skills for a Crust CLI application.
 *
 * `name` and `description` are read from the root command's `meta` at setup
 * time — only `version` needs to be supplied in the options.
 *
 * Installed agents are detected automatically.
 *
 * Only detected agents are managed by automatic update and the interactive
 * command.
 *
 * **Auto-update** (default): silently updates already-installed skills when a
 * new version is detected. Disable with `autoUpdate: false`.
 *
 * **Interactive command** (default): registers a `skill` subcommand that
 * presents a single multiselect prompt for toggling agent installations.
 * Detected agents are shown with their current installation status pre-filled.
 * The system reconciles the desired state: newly selected agents are installed,
 * deselected agents are uninstalled, and already-correct agents are skipped.
 * `command` configures the injected command name.
 *
 * For first-time installation, use the interactive command or build custom
 * auto-install logic with the exported primitives (`detectInstalledAgents`,
 * `skillStatus`, `generateSkill`).
 *
 * @param options - Plugin configuration with version and defaults
 * @returns The internal plugin behind the `skill()` Extension
 *
 * @example
 * ```ts
 * import { Crust } from "@crustjs/core";
 * import { skill } from "@crustjs/skills";
 *
 * const app = new Crust("my-cli").meta({ description: "My CLI" })
 *   .extend(skill({
 *     version: "1.0.0",
 *     command: "skill", // registers "my-cli skill" subcommand
 *   }))
 *   .handle(() => { /* ... *�/ });
 *
 * await app.execute();
 * ```
 */
export function skillExtension(options: SkillOptions): Extension {
	const skillCommandName = options.command ?? DEFAULT_SKILL_COMMAND_NAME;
	let customSkills: readonly CustomSkillConfig[] | undefined;
	const getCustomSkills = (mainName: string) =>
		(customSkills ??= validateCustomSkillsConfig(mainName, options.customSkills));

	return defineExtension("skills", {
		commands: [buildSkillCommandGrammar(skillCommandName, options, getCustomSkills)],
		hooks: {
			async preRun(context) {
				const resolvedCustomSkills = getCustomSkills(context.rootCommand.meta.name);
				if (context.commandPath[1] === skillCommandName || options.autoUpdate === false) return;

				await autoUpdateSkills(context.rootCommand, options, resolvedCustomSkills);
			},
		},
	});
}

// ────────────────────────────────────────────────────────────────────────────
// Interactive skill command builder
// ────────────────────────────────────────────────────────────────────────────

/** Reconciles one generated skill or hand-authored bundle through the interactive flow. */
async function reconcileSkillInteractively(opts: {
	name: string;
	version: string;
	scope: Scope;
	installAll: boolean;
	isInteractive: boolean;
	labelSuffix: string;
	installNoun: "skill" | "bundle";
	install: (agents: AgentTarget[], force?: boolean) => Promise<GenerateResult>;
}): Promise<void> {
	const { name, version, scope, installAll, isInteractive, labelSuffix, installNoun, install } =
		opts;
	const detectedAgents = await detectInstalledAgents();
	const universalAgents = getUniversalAgents();
	const allAdditionalAgents = getAdditionalAgents();
	const status = await skillStatus({ name, scope });

	const installedAgentSet = new Set<AgentTarget>(
		status.agents.filter((entry) => entry.installed).map((entry) => entry.agent),
	);
	const detectedAdditionalSet = new Set(detectedAgents);
	const statusMap = new Map(status.agents.map((entry) => [entry.agent, entry]));
	const additionalAgents = allAdditionalAgents.filter((agent) => {
		if (detectedAdditionalSet.has(agent)) return true;
		return statusMap.get(agent)?.installed === true;
	});
	const installedAgents = additionalAgents.filter((agent) => installedAgentSet.has(agent));

	const choices: Array<{
		label: string;
		value: AgentTarget | typeof UNIVERSAL_GROUP;
		hint: string;
	}> = [];

	if (universalAgents.length > 0) {
		const firstUniversalAgent = universalAgents[0]!;
		const universalDir = statusMap.get(firstUniversalAgent)?.outputDir ?? "path unavailable";
		choices.push({
			label: "Universal",
			value: UNIVERSAL_GROUP,
			hint: universalDir,
		});

		const agentLabels = universalAgents.map((agent) => AGENT_LABELS[agent]).join(", ");
		if (isInteractive && !installAll) {
			console.log(dim(`Agents supporting universal skills: ${agentLabels}`));
		}
	}

	for (const agent of additionalAgents) {
		choices.push({
			label: AGENT_LABELS[agent],
			value: agent,
			hint: statusMap.get(agent)?.outputDir ?? "path unavailable",
		});
	}

	const universalInstalled =
		universalAgents.length > 0 && universalAgents.every((agent) => installedAgentSet.has(agent));
	const defaultSelections: Array<AgentTarget | typeof UNIVERSAL_GROUP> = [
		...installedAgents.filter((agent) => !universalAgents.includes(agent)),
	];
	if (universalInstalled) {
		defaultSelections.unshift(UNIVERSAL_GROUP);
	}

	let selectedAgents: AgentTarget[];
	if (installAll) {
		selectedAgents = [...universalAgents, ...additionalAgents];
	} else {
		const selectedValues =
			choices.length === 0
				? ([] as Array<AgentTarget | typeof UNIVERSAL_GROUP>)
				: await multiselect({
						message: `Select agents to install skills for${labelSuffix}`,
						choices,
						default: defaultSelections,
						required: false,
					});

		const selected = new Set<AgentTarget>(
			selectedValues.filter((value): value is AgentTarget => value !== UNIVERSAL_GROUP),
		);
		if (selectedValues.includes(UNIVERSAL_GROUP)) {
			for (const agent of universalAgents) {
				selected.add(agent);
			}
		}
		selectedAgents = [...selected];
	}

	const toInstall = selectedAgents.filter((agent) => !installedAgentSet.has(agent));
	const toUpdate = selectedAgents.filter((agent) => {
		const entry = statusMap.get(agent);
		if (!entry?.installed) return false;
		return entry.version !== version || entry.outputDir !== resolveAgentPath(agent, scope, name);
	});
	const toUninstall = [...installedAgentSet].filter((agent) => !selectedAgents.includes(agent));
	const agentsToInstall = [...toInstall, ...toUpdate];

	if (agentsToInstall.length > 0) {
		try {
			const result = await spinner({
				message: `Installing skills${labelSuffix}...`,
				task: async () => install(agentsToInstall),
			});

			console.log(
				`\n${bold(`Installed ${installNoun === "bundle" ? "bundle " : ""}"${name}" v${version}`)}`,
			);
			for (const line of formatInstallOutput(result.agents)) {
				console.log(dim(`  ${line.label} → ${line.outputDir}`));
			}
		} catch (err) {
			if (err instanceof SkillConflictError) {
				const kindMismatchSuffix = err.details.kindMismatch
					? ` (existing is a "${err.details.kindMismatch.existing}" skill, attempted "${err.details.kindMismatch.attempted}")`
					: " but was not created by Crust";
				const overwrite =
					installAll ||
					(await confirm({
						message: `"${err.details.outputDir}" already exists${kindMismatchSuffix}. Overwrite?`,
						default: false,
					}));

				if (overwrite) {
					const result = await spinner({
						message: `Overwriting ${installNoun}${labelSuffix}...`,
						task: async () => install([err.details.agent], true),
					});

					console.log(
						`\n${bold(`Installed ${installNoun === "bundle" ? "bundle " : ""}"${name}" v${version}`)}`,
					);
					for (const line of formatInstallOutput(result.agents)) {
						console.log(dim(`  ${line.label} → ${line.outputDir}`));
					}
				} else {
					console.log(dim(`\nSkipped ${AGENT_LABELS[err.details.agent]}${labelSuffix}`));
				}
			} else {
				throw err;
			}
		}
	}

	if (toUninstall.length > 0) {
		const result = await spinner({
			message: `Removing skills${labelSuffix}...`,
			task: async () => uninstallSkill({ name, agents: toUninstall, scope }),
		});
		const removed = formatAgentLabels(
			result.agents.filter((entry) => entry.status === "removed").map((entry) => entry.agent),
		);
		if (removed.length > 0) {
			const message =
				installNoun === "bundle"
					? `Removed bundle "${name}" from ${removed.join(", ")}`
					: `Removed from ${removed.join(", ")}`;
			console.log(`\n${bold(message)}`);
		}
	}

	if (agentsToInstall.length === 0 && toUninstall.length === 0) {
		console.log(dim(`No changes${labelSuffix}.`));
	}
}

/**
 * Builds the interactive skill management command.
 *
 * Presents a single multiselect prompt listing all detected agents with their
 * current installation status pre-filled. The user toggles agents on/off and
 * the system reconciles the desired state: newly selected agents are installed,
 * deselected agents are uninstalled, and already-correct agents are skipped.
 *
 * The command resolves scope from `--scope`, `defaultScope`, or an interactive
 * prompt. When `defaultScope` is not set and the terminal is interactive, users
 * are prompted to choose between project and global. In non-interactive mode,
 * scope falls back to global.
 */
function buildSkillCommandGrammar(
	commandName: string,
	options: SkillOptions,
	getCustomSkills: (mainName: string) => readonly CustomSkillConfig[],
) {
	return new Crust(commandName)
		.meta({ description: "Manage agent skill installations" })
		.flags(
			{
				name: "scope",
				type: "string",
				description: "Install scope (project or global)",
			},
			{
				name: "all",
				type: "boolean",
				description: "Install for all detected agents non-interactively (universal + detected)",
			},
		)
		.mount(
			defineCommand("update", (cmd) =>
				cmd
					.meta({ description: "Update installed skills to latest version" })
					.flags({
						name: "scope",
						type: "string",
						description: "Update scope (project or global)",
					})
					.handle(async (context) => {
						await runSkillUpdateFlow(
							context.rootCommand,
							options,
							getCustomSkills(context.rootCommand.meta.name),
							context.flags,
						);
					}),
			),
		)
		.handle(async (context) => {
			await runSkillInstallFlow(
				context.rootCommand,
				options,
				getCustomSkills(context.rootCommand.meta.name),
				context.flags,
			);
		});
}

async function runSkillInstallFlow(
	rootCmd: CommandSnapshot,
	options: SkillOptions,
	customSkills: readonly CustomSkillConfig[],
	flags: SkillInstallFlags,
): Promise<void> {
	const meta = deriveSkillMeta(rootCmd, options);
	const installAll = flags.all === true;
	const isInteractive = process.stdin.isTTY;
	// `--scope` always wins when set; `--all` skips only the interactive
	// prompt fallback, falling back to `defaultScope` or `"global"`.
	const scope = installAll
		? (parseScopeFlag(flags.scope) ?? options.defaultScope ?? DEFAULT_SKILL_SCOPE)
		: await resolveScopeForCommand(flags.scope, options);

	await reconcileSkillInteractively({
		name: meta.name,
		version: meta.version,
		scope,
		installAll,
		isInteractive,
		labelSuffix: "",
		installNoun: "skill",
		install: (agents, force) =>
			generateSkill({
				command: rootCmd,
				meta,
				agents,
				scope,
				force,
				installMode: options.installMode,
			}),
	});

	// Custom skill bundles — sequential per-bundle prompts.
	// Each bundle is reconciled independently; a single-entry failure
	// aborts that entry only and subsequent entries still run, but the
	// command exits non-zero so callers (CI, scripts) see the failure.
	const failedEntries: string[] = [];
	for (const entry of customSkills) {
		const entryScope = entry.scope ?? scope;
		try {
			const version = entry.version ?? options.version;
			await reconcileSkillInteractively({
				name: entry.name,
				version,
				scope: entryScope,
				installAll,
				isInteractive,
				labelSuffix: ` [${entry.name}]`,
				installNoun: "bundle",
				install: (agents, force) =>
					installSkillBundle({
						sourceDir: entry.sourceDir,
						agents,
						version,
						scope: entryScope,
						force,
						installMode: entry.installMode ?? options.installMode,
						expectedName: entry.name,
					}),
			});
		} catch (err) {
			// Recoverable per-entry failure: keep reconciling siblings.
			// SkillConflictError is already handled inside the helper; any
			// error reaching here (filesystem, bad bundle, etc.) is logged
			// and tracked for the final exit code.
			const message = err instanceof Error ? err.message : String(err);
			console.warn(
				yellow(
					`Skill reconciliation failed [${entry.name}]: ${message}. ` +
						`Continuing with remaining skills.`,
				),
			);
			failedEntries.push(entry.name);
		}
	}
	if (failedEntries.length > 0) {
		process.exitCode = 1;
	}
}

async function runSkillUpdateFlow(
	rootCmd: CommandSnapshot,
	options: SkillOptions,
	customSkills: readonly CustomSkillConfig[],
	flags: SkillUpdateFlags,
): Promise<void> {
	const scope = await resolveScopeForCommand(flags.scope, options);
	const meta = deriveSkillMeta(rootCmd, options);
	await updateGeneratedSkill(rootCmd, options, scope, {
		onNoUpdate: (updatedScope) => console.log(dim(`No updates needed (${updatedScope}).`)),
		onUpdated: (labels, updatedScope) =>
			console.log(
				`\n${bold(
					`Updated "${meta.name}" to v${meta.version} for ${labels.join(", ")} (${updatedScope})`,
				)}`,
			),
		onConflict: (err) =>
			console.warn(
				yellow(
					`Skipped ${AGENT_LABELS[err.details.agent]}: "${err.details.outputDir}" already exists ` +
						`but was not created by ${meta.name}. ` +
						`Delete or rename the conflicting directory to resolve.`,
				),
			),
	});

	// Custom skill bundles — update each in turn after the main skill.
	// SkillConflictError is logged and treated as recoverable (matches
	// the main-skill update behavior); any other error is also logged
	// per-entry but tracked so the command exits non-zero.
	const failedEntries: string[] = [];
	for (const entry of customSkills) {
		const entryScope = entry.scope ?? scope;
		try {
			await autoUpdateCustomSkill(entry, options, {
				scopes: [entryScope],
				onNoUpdate: (updatedScope) =>
					console.log(dim(`No updates needed [${entry.name}] (${updatedScope}).`)),
				onUpdated: (message) => console.log(`\n${bold(message)}`),
				onConflict: (err) => {
					const kindMismatchSuffix = err.details.kindMismatch
						? ` (existing is a "${err.details.kindMismatch.existing}" skill, attempted "${err.details.kindMismatch.attempted}")`
						: "";
					console.warn(
						yellow(
							`Skipped ${AGENT_LABELS[err.details.agent]} [${entry.name}]: ` +
								`"${err.details.outputDir}" already exists${kindMismatchSuffix}. ` +
								`Delete or rename the conflicting directory to resolve.`,
						),
					);
				},
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(
				yellow(
					`Skill update failed [${entry.name}]: ${message}. Continuing with remaining skills.`,
				),
			);
			failedEntries.push(entry.name);
		}
	}
	if (failedEntries.length > 0) {
		process.exitCode = 1;
	}
}
