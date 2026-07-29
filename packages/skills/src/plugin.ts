// ────────────────────────────────────────────────────────────────────────────
// Extension layer — skill() with interactive command injection
// ────────────────────────────────────────────────────────────────────────────

import { type CommandSnapshot, Crust, type Extension, extension } from "@crustjs/core";
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
	Scope,
	SkillInstallMode,
	SkillMeta,
	SkillPluginOptions,
} from "./types.ts";

const DEFAULT_SKILL_COMMAND_NAME = "skill";
const DEFAULT_SKILL_SCOPE = "global";
const UNIVERSAL_GROUP = "__universal__";

function isScope(value: unknown): value is Scope {
	return value === "global" || value === "project";
}

function isInstallMode(value: unknown): value is SkillInstallMode {
	return value === "auto" || value === "symlink" || value === "copy";
}

/**
 * Validates an explicit `--scope` flag. Returns the typed scope when set,
 * `undefined` when omitted. Throws on a non-Scope string so the caller
 * does not need to repeat the check.
 */
function parseScopeFlag(rawScope: string | undefined): Scope | undefined {
	if (rawScope === undefined) return undefined;
	if (!isScope(rawScope)) {
		throw new Error(`Invalid --scope value: ${String(rawScope)}. Expected "project" or "global".`);
	}
	return rawScope;
}

async function resolveScopeForCommand(
	rawScope: string | undefined,
	options: SkillPluginOptions,
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
	const universalSet = new Set(getUniversalAgents());
	const output: Array<{ label: string; outputDir: string }> = [];

	const firstUniversalResult = results.find((result) => universalSet.has(result.agent));
	if (firstUniversalResult) {
		output.push({
			label: "Universal",
			outputDir: firstUniversalResult.outputDir,
		});
	}

	for (const result of results) {
		if (universalSet.has(result.agent)) {
			continue;
		}

		output.push({
			label: AGENT_LABELS[result.agent],
			outputDir: result.outputDir,
		});
	}

	return output;
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Derives a {@link SkillMeta} from a command's `meta` and plugin options.
 *
 * The returned `name` is the canonical raw CLI name (e.g. `"my-cli"`).
 */
function deriveSkillMeta(command: CommandSnapshot, options: SkillPluginOptions): SkillMeta {
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

/**
 * Validates and normalizes the `customSkills` array passed to `skill()`.
 *
 * Acts as the single boundary check (per AGENTS.md "validate untrusted input
 * once at the boundary; trust types inside"). Runs synchronously at plugin
 * setup before any FS work; resolution-time errors (non-`file:` URL, missing
 * source directory, missing `SKILL.md`, etc.) are deferred to the underlying
 * {@link installSkillBundle} invocation so plugin setup stays fast.
 *
 * Rules:
 * - `customSkills` itself must be an array (or `undefined`).
 * - Each `entry.name` must satisfy {@link isValidSkillName}, must not collide
 *   with the main skill's name, and must be unique within the array.
 * - `entry.version`, when set, must be a non-empty string. When omitted, the
 *   plugin's top-level `version` is used at install time.
 * - `entry.sourceDir` must be `string` or `URL`.
 * - `entry.scope`, when set, must be `"project"` or `"global"`.
 * - `entry.installMode`, when set, must be `"auto"`, `"symlink"`, or `"copy"`.
 */
function validateCustomSkillsConfig(
	mainName: string,
	customSkills: readonly CustomSkillConfig[] | undefined,
): readonly CustomSkillConfig[] {
	if (customSkills === undefined) {
		return [];
	}
	if (!Array.isArray(customSkills)) {
		throw new Error(
			`skill: customSkills must be an array, got ${
				customSkills === null ? "null" : typeof customSkills
			}.`,
		);
	}
	if (customSkills.length === 0) {
		return [];
	}

	const seen = new Set<string>();
	for (let i = 0; i < customSkills.length; i++) {
		const entry = customSkills[i];
		if (!entry || typeof entry !== "object") {
			throw new Error(
				`skill: customSkills[${i}] must be an object, got ${entry === null ? "null" : typeof entry}.`,
			);
		}

		if (typeof entry.name !== "string" || entry.name.length === 0) {
			throw new Error(`skill: customSkills[${i}].name must be a non-empty string.`);
		}

		if (!isValidSkillName(entry.name)) {
			throw new Error(
				`skill: customSkills[${i}].name "${entry.name}" is not a valid skill name. ` +
					`Must be 1–64 lowercase alphanumeric characters and hyphens, ` +
					`no leading/trailing/consecutive hyphens.`,
			);
		}

		if (entry.name === mainName) {
			throw new Error(
				`skill: customSkills[${i}].name "${entry.name}" collides with the main skill name. ` +
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

		if (
			entry.version !== undefined &&
			(typeof entry.version !== "string" || entry.version.length === 0)
		) {
			throw new Error(
				`skill: customSkills[${i}].version (for "${entry.name}") ` +
					`must be a non-empty string when set, or omitted to inherit the plugin's \`version\`.`,
			);
		}

		if (typeof entry.sourceDir !== "string" && !(entry.sourceDir instanceof URL)) {
			throw new Error(
				`skill: customSkills[${i}].sourceDir (for "${entry.name}") ` +
					`must be a string or URL, got ${typeof entry.sourceDir}.`,
			);
		}

		if (entry.scope !== undefined && !isScope(entry.scope)) {
			throw new Error(
				`skill: customSkills[${i}].scope (for "${entry.name}") ` +
					`must be "project" or "global", got ${JSON.stringify(entry.scope)}.`,
			);
		}

		if (entry.installMode !== undefined && !isInstallMode(entry.installMode)) {
			throw new Error(
				`skill: customSkills[${i}].installMode (for "${entry.name}") ` +
					`must be "auto", "symlink", or "copy", got ${JSON.stringify(entry.installMode)}.`,
			);
		}
	}

	return customSkills;
}

/** Resolves the effective scope for a custom-skill auto-update sweep. */
function resolveCustomSkillScopes(entry: CustomSkillConfig, options: SkillPluginOptions): Scope[] {
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
	options: SkillPluginOptions,
): Promise<void> {
	const agents = [...getUniversalAgents(), ...getAdditionalAgents()];
	if (agents.length === 0) {
		return;
	}

	const scopes = resolveCustomSkillScopes(entry, options);
	const installMode = entry.installMode ?? options.installMode;
	const effectiveVersion = entry.version ?? options.version;

	for (const scope of scopes) {
		const status = await skillStatus({
			name: entry.name,
			agents,
			scope,
		});

		const needsUpdate = status.agents.filter((a) => {
			if (!a.installed) return false;
			const expectedOutputDir = resolveAgentPath(a.agent, scope, entry.name);
			return a.version !== effectiveVersion || a.outputDir !== expectedOutputDir;
		});

		if (needsUpdate.length === 0) {
			continue;
		}

		try {
			await spinner({
				message: `Updating ${scope} skills [${entry.name}]...`,
				task: async ({ updateMessage }) => {
					const res = await installSkillBundle({
						sourceDir: entry.sourceDir,
						agents: needsUpdate.map((a) => a.agent),
						version: effectiveVersion,
						scope,
						installMode,
						expectedName: entry.name,
					});

					const updatedAgents = res.agents
						.filter((a) => a.status === "updated")
						.map((a) => a.agent);
					const updatedLabels = formatAgentLabels(updatedAgents);

					if (updatedLabels.length > 0) {
						updateMessage(
							`Updated bundle "${entry.name}" to v${effectiveVersion} for ${updatedLabels.join(", ")} (${scope})`,
						);
					}

					return res;
				},
			});
		} catch (err) {
			if (err instanceof SkillConflictError) {
				const kindMismatchSuffix = err.details.kindMismatch
					? ` (existing skill is "${err.details.kindMismatch.existing}", attempted "${err.details.kindMismatch.attempted}")`
					: "";
				console.warn(
					yellow(
						`Skill conflict [${entry.name}]: "${err.details.outputDir}" already exists ` +
							`but conflicts with the requested install${kindMismatchSuffix}. ` +
							`Skipping auto-update for ${scope}. ` +
							`Delete or rename the conflicting skill to resolve.`,
					),
				);
			} else {
				throw err;
			}
		}
	}
}

function needsSkillReconciliation(
	agent: AgentTarget,
	scope: Scope,
	meta: SkillMeta,
	entry: { installed: boolean; version?: string; outputDir: string },
): boolean {
	// TODO(v0.1.0): Remove legacy outputDir reconciliation once `use-<cli>` ->
	// `<cli>` migration support is dropped in @crustjs/skills.
	if (!entry.installed) {
		return false;
	}

	const expectedOutputDir = resolveAgentPath(agent, scope, meta.name);
	return entry.version !== meta.version || entry.outputDir !== expectedOutputDir;
}

/**
 * Performs automatic updates for already-installed skills when the version
 * has changed or a legacy install path needs migration.
 *
 * Runs during plugin setup so behavior is independent of middleware ordering.
 * Only updates skills that are already installed — first-time installation
 * should be done via the interactive command or programmatically by the user.
 */
async function autoUpdateSkills(
	rootCmd: CommandSnapshot,
	options: SkillPluginOptions,
	customSkills: readonly CustomSkillConfig[],
): Promise<void> {
	// Use all known agents and let skillStatus (filesystem-only) determine
	// which ones are actually installed. This avoids any PATH probing or
	// process spawning during normal CLI startup.
	const agents = [...getUniversalAgents(), ...getAdditionalAgents()];
	if (agents.length === 0) {
		// Still run the bundle loop — no agents means each `skillStatus` returns
		// empty, and `installSkillBundle` is never called.
		await autoUpdateCustomSkillsLoop(customSkills, options);
		return;
	}

	const meta = deriveSkillMeta(rootCmd, options);

	const scopesToCheck: Scope[] = [
		...new Set((["project", "global"] as Scope[]).map((scope) => resolveEffectiveScope(scope))),
	];

	for (const scope of scopesToCheck) {
		const status = await skillStatus({
			name: meta.name,
			agents,
			scope,
		});

		const needsUpdate = status.agents.filter((entry) =>
			needsSkillReconciliation(entry.agent, scope, meta, entry),
		);

		if (needsUpdate.length === 0) {
			continue;
		}

		try {
			await spinner({
				message: `Updating ${scope} skills...`,
				task: async ({ updateMessage }) => {
					const res = await generateSkill({
						command: rootCmd,
						meta,
						agents: needsUpdate.map((a) => a.agent),
						scope,
						installMode: options.installMode,
					});

					const updatedAgents = res.agents
						.filter((a) => a.status === "updated")
						.map((a) => a.agent);
					const updatedLabels = formatAgentLabels(updatedAgents);

					if (updatedLabels.length > 0) {
						updateMessage(
							`Updated skill "${meta.name}" to v${meta.version} for ${updatedLabels.join(", ")} (${scope})`,
						);
					}

					return res;
				},
			});
		} catch (err) {
			if (err instanceof SkillConflictError) {
				console.warn(
					yellow(
						`Skill conflict: "${err.details.outputDir}" already exists ` +
							`but was not created by ${meta.name}. Skipping auto-update for ${scope}. ` +
							`Delete or rename the conflicting skill to resolve.`,
					),
				);
			} else {
				throw err;
			}
		}
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
	options: SkillPluginOptions,
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
export function skillExtension(options: SkillPluginOptions): Extension {
	const skillCommandName = options.command ?? DEFAULT_SKILL_COMMAND_NAME;

	return extension("skills", {
		commands: [buildSkillCommandGrammar(skillCommandName)],
		async intercept(context, next) {
			const rootCmd = context.rootCommand;

			// Validate customSkills config at the boundary so misconfiguration
			// surfaces before any auto-update or interactive run.
			const customSkills = validateCustomSkillsConfig(rootCmd.meta.name, options.customSkills);

			// The owned skill command's work happens here — the intercept is
			// the only hook with access to the final root snapshot.
			if (context.commandPath[1] === skillCommandName) {
				if (context.commandPath[2] === "update") {
					await runSkillUpdateFlow(rootCmd, options, customSkills, context.flags);
				} else {
					await runSkillInstallFlow(rootCmd, options, customSkills, context.flags);
				}
				return;
			}

			// Auto-update already-installed skills when version changes.
			// Build-validation mode never reaches intercepts, so it can never
			// mutate user environments.
			if (options.autoUpdate !== false) {
				await autoUpdateSkills(rootCmd, options, customSkills);
			}

			await next();
		},
	});
}

// ────────────────────────────────────────────────────────────────────────────
// Interactive skill command builder
// ────────────────────────────────────────────────────────────────────────────

/** Reconciles one custom-skill bundle through the interactive skill flow. */
async function reconcileBundleInteractively(opts: {
	entry: CustomSkillConfig;
	options: SkillPluginOptions;
	scope: Scope;
	installAll: boolean;
	isInteractive: boolean;
}): Promise<void> {
	const { entry, options, scope, installAll, isInteractive } = opts;
	const installMode = entry.installMode ?? options.installMode;
	const effectiveVersion = entry.version ?? options.version;

	const detectedAgents = await detectInstalledAgents();
	const universalAgents = getUniversalAgents();
	const allAdditionalAgents = getAdditionalAgents();

	const status = await skillStatus({
		name: entry.name,
		agents: [...universalAgents, ...allAdditionalAgents],
		scope,
	});

	const installedAgentSet = new Set<AgentTarget>(
		status.agents.filter((a) => a.installed).map((a) => a.agent),
	);
	const detectedAdditionalSet = new Set(detectedAgents);
	const statusMap = new Map(status.agents.map((a) => [a.agent, a]));
	const additionalAgents = allAdditionalAgents.filter((agent) => {
		if (detectedAdditionalSet.has(agent)) return true;
		const e = statusMap.get(agent);
		return e?.installed === true;
	});
	const installedAgents = additionalAgents.filter((agent) => installedAgentSet.has(agent));

	const choices: Array<{
		label: string;
		value: AgentTarget | typeof UNIVERSAL_GROUP;
		hint: string;
	}> = [];

	if (universalAgents.length > 0) {
		const firstUniversalAgent = universalAgents[0];
		if (!firstUniversalAgent) {
			throw new Error("Expected at least one universal agent");
		}
		const firstUniversal = statusMap.get(firstUniversalAgent);
		const universalDir = firstUniversal?.outputDir ?? "path unavailable";
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
		const e = statusMap.get(agent);
		const hint = e?.outputDir ?? "path unavailable";
		choices.push({
			label: AGENT_LABELS[agent],
			value: agent,
			hint,
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
						message: `Select agents to install skills for [${entry.name}]`,
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
		const e = statusMap.get(agent);
		if (!e?.installed) return false;
		const expectedOutputDir = resolveAgentPath(agent, scope, entry.name);
		return e.version !== effectiveVersion || e.outputDir !== expectedOutputDir;
	});
	const toUninstall = [...installedAgentSet].filter((agent) => !selectedAgents.includes(agent));

	const agentsToInstall = [...toInstall, ...toUpdate];

	if (agentsToInstall.length > 0) {
		try {
			const result = await spinner({
				message: `Installing skills [${entry.name}]...`,
				task: async () =>
					installSkillBundle({
						sourceDir: entry.sourceDir,
						agents: agentsToInstall,
						version: effectiveVersion,
						scope,
						installMode,
						expectedName: entry.name,
					}),
			});

			console.log(`\n${bold(`Installed bundle "${entry.name}" v${effectiveVersion}`)}`);
			for (const line of formatInstallOutput(result.agents)) {
				console.log(dim(`  ${line.label} → ${line.outputDir}`));
			}
		} catch (err) {
			if (err instanceof SkillConflictError) {
				const kindMismatchSuffix = err.details.kindMismatch
					? ` (existing is a "${err.details.kindMismatch.existing}" skill, attempted "${err.details.kindMismatch.attempted}")`
					: " but was not created by Crust";
				const overwrite = installAll
					? true
					: await confirm({
							message:
								`"${err.details.outputDir}" already exists${kindMismatchSuffix}. ` + `Overwrite?`,
							default: false,
						});

				if (overwrite) {
					const result = await spinner({
						message: `Overwriting bundle [${entry.name}]...`,
						task: async () =>
							installSkillBundle({
								sourceDir: entry.sourceDir,
								agents: [err.details.agent],
								version: effectiveVersion,
								scope,
								force: true,
								installMode,
								expectedName: entry.name,
							}),
					});

					console.log(`\n${bold(`Installed bundle "${entry.name}" v${effectiveVersion}`)}`);
					for (const line of formatInstallOutput(result.agents)) {
						console.log(dim(`  ${line.label} → ${line.outputDir}`));
					}
				} else {
					console.log(dim(`\nSkipped ${AGENT_LABELS[err.details.agent]} [${entry.name}]`));
				}
			} else {
				throw err;
			}
		}
	}

	if (toUninstall.length > 0) {
		const result = await spinner({
			message: `Removing skills [${entry.name}]...`,
			task: async () =>
				uninstallSkill({
					name: entry.name,
					agents: toUninstall,
					scope,
				}),
		});

		const removedAgents = result.agents.filter((a) => a.status === "removed").map((a) => a.agent);
		const removed = formatAgentLabels(removedAgents);

		if (removed.length > 0) {
			console.log(`\n${bold(`Removed bundle "${entry.name}" from ${removed.join(", ")}`)}`);
		}
	}

	if (agentsToInstall.length === 0 && toUninstall.length === 0) {
		console.log(dim(`No changes [${entry.name}].`));
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
function buildSkillCommandGrammar(commandName: string) {
	return (
		new Crust(commandName)
			.meta({ description: "Manage agent skill installations" })
			.flags({
				scope: {
					type: "string",
					description: "Install scope (project or global)",
				},
				all: {
					type: "boolean",
					description: "Install for all detected agents non-interactively (universal + detected)",
				},
			})
			.command("update", (cmd) =>
				cmd
					.meta({ description: "Update installed skills to latest version" })
					.flags({
						scope: {
							type: "string",
							description: "Update scope (project or global)",
						},
					})
					// Never reached — the skills extension intercept short-circuits
					.handle(() => {}),
			)
			// Never reached — the skills extension intercept short-circuits
			.handle(() => {})
	);
}

async function runSkillInstallFlow(
	rootCmd: CommandSnapshot,
	options: SkillPluginOptions,
	customSkills: readonly CustomSkillConfig[],
	flags: Readonly<Record<string, unknown>>,
): Promise<void> {
	const meta = deriveSkillMeta(rootCmd, options);
	const installAll = flags.all === true;
	const isInteractive = !!process.stdin.isTTY;
	// `--scope` always wins when set; `--all` skips only the interactive
	// prompt fallback, falling back to `defaultScope` or `"global"`.
	const scope = installAll
		? (parseScopeFlag(flags.scope as string | undefined) ??
			options.defaultScope ??
			DEFAULT_SKILL_SCOPE)
		: await resolveScopeForCommand(flags.scope as string | undefined, options);

	// Detect installed agents
	const detectedAgents = await detectInstalledAgents();

	const universalAgents = getUniversalAgents();
	const allAdditionalAgents = getAdditionalAgents();

	// Check current skill status for each agent
	const status = await skillStatus({
		name: meta.name,
		agents: [...universalAgents, ...allAdditionalAgents],
		scope,
	});

	// Build multiselect choices with status hints and pre-selection
	const installedAgentSet = new Set<AgentTarget>(
		status.agents.filter((entry) => entry.installed).map((entry) => entry.agent),
	);
	const detectedAdditionalSet = new Set(detectedAgents);
	const statusMap = new Map(status.agents.map((entry) => [entry.agent, entry]));
	const additionalAgents = allAdditionalAgents.filter((agent) => {
		if (detectedAdditionalSet.has(agent)) {
			return true;
		}
		const entry = statusMap.get(agent);
		return entry?.installed === true;
	});
	const installedAgents = additionalAgents.filter((agent) => installedAgentSet.has(agent));

	const choices: Array<{
		label: string;
		value: AgentTarget | typeof UNIVERSAL_GROUP;
		hint: string;
	}> = [];

	if (universalAgents.length > 0) {
		const firstUniversalAgent = universalAgents[0];
		if (!firstUniversalAgent) {
			throw new Error("Expected at least one universal agent");
		}
		const firstUniversal = statusMap.get(firstUniversalAgent);
		const universalDir = firstUniversal?.outputDir ?? "path unavailable";
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
		const entry = statusMap.get(agent);
		const hint = entry?.outputDir ?? "path unavailable";
		choices.push({
			label: AGENT_LABELS[agent],
			value: agent,
			hint,
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

	// When --all is set, select all universal + detected additional agents
	// without prompting. Otherwise, show the interactive multiselect.
	let selectedAgents: AgentTarget[];

	if (installAll) {
		selectedAgents = [...universalAgents, ...additionalAgents];
	} else {
		const selectedValues =
			choices.length === 0
				? ([] as Array<AgentTarget | typeof UNIVERSAL_GROUP>)
				: await multiselect({
						message: "Select agents to install skills for",
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

	// Compute diff
	const toInstall = selectedAgents.filter((agent) => !installedAgentSet.has(agent));
	const toUpdate = selectedAgents.filter((agent) => {
		const entry = statusMap.get(agent);
		return entry !== undefined && needsSkillReconciliation(agent, scope, meta, entry);
	});
	const toUninstall = [...installedAgentSet].filter((agent) => !selectedAgents.includes(agent));

	const agentsToGenerate = [...toInstall, ...toUpdate];

	// Install/update selected agents
	if (agentsToGenerate.length > 0) {
		try {
			const result = await spinner({
				message: "Installing skills...",
				task: async () =>
					generateSkill({
						command: rootCmd,
						meta,
						agents: agentsToGenerate,
						scope,
						installMode: options.installMode,
					}),
			});

			console.log(`\n${bold(`Installed "${meta.name}" v${meta.version}`)}`);
			for (const line of formatInstallOutput(result.agents)) {
				console.log(dim(`  ${line.label} → ${line.outputDir}`));
			}
		} catch (err) {
			if (err instanceof SkillConflictError) {
				const overwrite = installAll
					? true
					: await confirm({
							message:
								`"${err.details.outputDir}" already exists but was not ` +
								`created by Crust. Overwrite?`,
							default: false,
						});

				if (overwrite) {
					const result = await spinner({
						message: "Overwriting skill...",
						task: async () =>
							generateSkill({
								command: rootCmd,
								meta,
								agents: [err.details.agent],
								scope,
								force: true,
								installMode: options.installMode,
							}),
					});

					console.log(`\n${bold(`Installed "${meta.name}" v${meta.version}`)}`);
					for (const line of formatInstallOutput(result.agents)) {
						console.log(dim(`  ${line.label} → ${line.outputDir}`));
					}
				} else {
					console.log(dim(`\nSkipped ${AGENT_LABELS[err.details.agent]}`));
				}
			} else {
				throw err;
			}
		}
	}

	// Uninstall deselected agents
	if (toUninstall.length > 0) {
		const result = await spinner({
			message: "Removing skills...",
			task: async () =>
				uninstallSkill({
					name: meta.name,
					agents: toUninstall,
					scope,
				}),
		});

		const removedAgents = result.agents.filter((a) => a.status === "removed").map((a) => a.agent);
		const removed = formatAgentLabels(removedAgents);

		if (removed.length > 0) {
			console.log(`\n${bold(`Removed from ${removed.join(", ")}`)}`);
		}
	}

	// No changes
	if (agentsToGenerate.length === 0 && toUninstall.length === 0) {
		console.log(dim("No changes."));
	}

	// Custom skill bundles — sequential per-bundle prompts.
	// Each bundle is reconciled independently; a single-entry failure
	// aborts that entry only and subsequent entries still run, but the
	// command exits non-zero so callers (CI, scripts) see the failure.
	const failedEntries: string[] = [];
	for (const entry of customSkills) {
		const entryScope = entry.scope ?? scope;
		try {
			await reconcileBundleInteractively({
				entry,
				options,
				scope: entryScope,
				installAll,
				isInteractive,
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
	options: SkillPluginOptions,
	customSkills: readonly CustomSkillConfig[],
	flags: Readonly<Record<string, unknown>>,
): Promise<void> {
	const scope = await resolveScopeForCommand(flags.scope as string | undefined, options);
	const effectiveScope = resolveEffectiveScope(scope);
	// Use all known agents and let skillStatus determine which are installed.
	// This avoids spawning external CLIs during `skill update`.
	const agents = [...getUniversalAgents(), ...getAdditionalAgents()];

	const meta = deriveSkillMeta(rootCmd, options);
	const status = await skillStatus({
		name: meta.name,
		agents,
		scope,
	});
	const needsUpdate = status.agents.filter((entry) =>
		needsSkillReconciliation(entry.agent, scope, meta, entry),
	);

	if (needsUpdate.length === 0) {
		console.log(dim(`No updates needed (${effectiveScope}).`));
	} else {
		try {
			const res = await spinner({
				message: `Updating ${effectiveScope} skills...`,
				task: async () =>
					generateSkill({
						command: rootCmd,
						meta,
						agents: needsUpdate.map((agent) => agent.agent),
						scope,
						installMode: options.installMode,
					}),
			});

			const updatedAgents = res.agents
				.filter((agent) => agent.status === "updated")
				.map((agent) => agent.agent);
			const updatedLabels = formatAgentLabels(updatedAgents);
			if (updatedLabels.length > 0) {
				console.log(
					`\n${bold(
						`Updated "${meta.name}" to v${meta.version} for ${updatedLabels.join(", ")} (${effectiveScope})`,
					)}`,
				);
			}
		} catch (err) {
			if (err instanceof SkillConflictError) {
				console.warn(
					yellow(
						`Skipped ${AGENT_LABELS[err.details.agent]}: "${err.details.outputDir}" already exists ` +
							`but was not created by ${meta.name}. ` +
							`Delete or rename the conflicting directory to resolve.`,
					),
				);
			} else {
				throw err;
			}
		}
	}

	// Custom skill bundles — update each in turn after the main skill.
	// SkillConflictError is logged and treated as recoverable (matches
	// the main-skill update behavior); any other error is also logged
	// per-entry but tracked so the command exits non-zero.
	const failedEntries: string[] = [];
	for (const entry of customSkills) {
		const entryScope = entry.scope ?? scope;
		const entryEffectiveScope = resolveEffectiveScope(entryScope);
		const entryInstallMode = entry.installMode ?? options.installMode;
		const entryEffectiveVersion = entry.version ?? options.version;
		try {
			const bundleStatus = await skillStatus({
				name: entry.name,
				agents,
				scope: entryScope,
			});
			const bundleNeedsUpdate = bundleStatus.agents.filter((a) => {
				if (!a.installed) return false;
				const expectedOutputDir = resolveAgentPath(a.agent, entryScope, entry.name);
				return a.version !== entryEffectiveVersion || a.outputDir !== expectedOutputDir;
			});

			if (bundleNeedsUpdate.length === 0) {
				console.log(dim(`No updates needed [${entry.name}] (${entryEffectiveScope}).`));
				continue;
			}

			const res = await spinner({
				message: `Updating ${entryEffectiveScope} skills [${entry.name}]...`,
				task: async () =>
					installSkillBundle({
						sourceDir: entry.sourceDir,
						agents: bundleNeedsUpdate.map((a) => a.agent),
						version: entryEffectiveVersion,
						scope: entryScope,
						installMode: entryInstallMode,
						expectedName: entry.name,
					}),
			});

			const updatedAgents = res.agents.filter((a) => a.status === "updated").map((a) => a.agent);
			const updatedLabels = formatAgentLabels(updatedAgents);
			if (updatedLabels.length > 0) {
				console.log(
					`\n${bold(
						`Updated bundle "${entry.name}" to v${entryEffectiveVersion} for ${updatedLabels.join(", ")} (${entryEffectiveScope})`,
					)}`,
				);
			}
		} catch (err) {
			if (err instanceof SkillConflictError) {
				// Conflict matches main-skill `skill update` semantics:
				// log and skip without failing the command (caller can
				// resolve manually).
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
			} else {
				// Unexpected error (filesystem, bad bundle, frontmatter
				// mismatch from `expectedName`, etc.). Keep updating siblings
				// so a single bad entry does not block the rest, but track
				// it so the command exits non-zero.
				const message = err instanceof Error ? err.message : String(err);
				console.warn(
					yellow(
						`Skill update failed [${entry.name}]: ${message}. ` +
							`Continuing with remaining skills.`,
					),
				);
				failedEntries.push(entry.name);
			}
		}
	}
	if (failedEntries.length > 0) {
		process.exitCode = 1;
	}
}
