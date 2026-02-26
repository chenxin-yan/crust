// ────────────────────────────────────────────────────────────────────────────
// Plugin layer — skillPlugin with interactive command injection
// ────────────────────────────────────────────────────────────────────────────

import type { AnyCommand, CrustPlugin } from "@crustjs/core";
import { defineCommand } from "@crustjs/core";
import { confirm, multiselect, spinner } from "@crustjs/prompts";
import { AGENT_LABELS, detectInstalledAgents } from "./agents.ts";
import { SkillConflictError } from "./errors.ts";
import { generateSkill, skillStatus, uninstallSkill } from "./generate.ts";
import type { AgentTarget, SkillMeta, SkillPluginOptions } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Derives a {@link SkillMeta} from a command's `meta` and a version string.
 *
 * The returned `name` is the raw CLI name (e.g. `"my-cli"`). The `use-`
 * prefix is applied downstream by `generateSkill()` and friends.
 */
function deriveSkillMeta(command: AnyCommand, version: string): SkillMeta {
	return {
		name: command.meta.name,
		description: command.meta.description ?? "",
		version,
	};
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
 * Installed agents are detected automatically by checking for global
 * configuration directories. Only detected agents are managed by the
 * middleware and the interactive command.
 *
 * **Auto-update** (default): silently updates already-installed skills when a
 * new version is detected. Set `autoInstall: true` to also install skills that
 * are not yet present.
 *
 * **Interactive command** (default): registers a `skill` subcommand that
 * presents a single multiselect prompt for toggling agent installations.
 * Detected agents are shown with their current installation status pre-filled.
 * The system reconciles the desired state: newly selected agents are installed,
 * deselected agents are uninstalled, and already-correct agents are skipped.
 * Set `command: false` to disable command injection.
 *
 * @param options - Plugin configuration with version and scope
 * @returns A `CrustPlugin` to register in a command's `plugins` array
 *
 * @example
 * ```ts
 * import { defineCommand, runMain } from "@crustjs/core";
 * import { skillPlugin } from "@crustjs/skills";
 *
 * const app = defineCommand({
 *   meta: { name: "my-cli", description: "My CLI" },
 *   plugins: [
 *     skillPlugin({
 *       version: "1.0.0",
 *       command: true, // registers "my-cli skill" subcommand
 *     }),
 *   ],
 * });
 *
 * runMain(app);
 * ```
 */
export function skillPlugin(options: SkillPluginOptions): CrustPlugin {
	let rootCmd: AnyCommand;
	let skillCmd: AnyCommand | null = null;

	return {
		name: "skills",
		setup(context, actions) {
			rootCmd = context.rootCommand;

			// Inject interactive skill command unless explicitly disabled
			if (options.command !== false) {
				const name =
					typeof options.command === "string" ? options.command : "skill";
				skillCmd = buildSkillCommand(rootCmd, options);
				actions.addSubCommand(rootCmd, name, skillCmd);
			}
		},
		async middleware(_context, next) {
			// Skip auto-update when the skill command itself is being executed
			if (skillCmd && _context.route?.command === skillCmd) {
				await next();
				return;
			}

			const agents = await detectInstalledAgents();
			if (agents.length === 0) {
				await next();
				return;
			}

			const autoInstall = options.autoInstall ?? false;
			const autoUpdate = options.autoUpdate ?? true;
			const meta = deriveSkillMeta(rootCmd, options.version);

			const status = await skillStatus({
				name: meta.name,
				agents,
				scope: options.scope ?? "global",
			});

			const needsUpdate = status.agents.filter((a) => {
				if (!a.installed) return autoInstall;
				if (a.version !== meta.version) return autoUpdate;
				return false;
			});

			if (needsUpdate.length > 0) {
				try {
					const result = await generateSkill({
						command: rootCmd,
						meta,
						agents: needsUpdate.map((a) => a.agent),
						scope: options.scope,
					});

					// Print concise status summaries for auto-install and auto-update
					const installedAgents = result.agents
						.filter((a) => a.status === "installed")
						.map((a) => AGENT_LABELS[a.agent]);
					const updatedAgents = result.agents
						.filter((a) => a.status === "updated")
						.map((a) => AGENT_LABELS[a.agent]);

					if (installedAgents.length > 0) {
						if (options.command !== false) {
							const manageCommand = `${rootCmd.meta.name} skill`;
							console.log(
								`Auto-installed skill "${meta.name}" v${meta.version} for ${installedAgents.join(", ")}. Manage with \`${manageCommand}\`.`,
							);
						} else {
							console.log(
								`Auto-installed skill "${meta.name}" v${meta.version} for ${installedAgents.join(", ")}.`,
							);
						}
					}

					if (updatedAgents.length > 0) {
						console.log(
							`Updated skill "${meta.name}" to v${meta.version} for ${updatedAgents.join(", ")}.`,
						);
					}
				} catch (err) {
					if (err instanceof SkillConflictError) {
						console.warn(
							`Skill conflict: "${err.details.outputDir}" already exists ` +
								`but was not created by ${meta.name}. Skipping auto-update. ` +
								`Delete or rename the conflicting skill to resolve.`,
						);
					} else {
						throw err;
					}
				}
			}

			await next();
		},
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Interactive skill command builder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Builds the interactive skill management command.
 *
 * Presents a single multiselect prompt listing all detected agents with their
 * current installation status pre-filled. The user toggles agents on/off and
 * the system reconciles the desired state: newly selected agents are installed,
 * deselected agents are uninstalled, and already-correct agents are skipped.
 *
 * The installation scope is taken from the plugin's configured `scope` option
 * (defaulting to `"global"`) — no interactive scope selection.
 */
function buildSkillCommand(
	rootCmd: AnyCommand,
	options: SkillPluginOptions,
): AnyCommand {
	return defineCommand({
		meta: {
			name: "skill",
			description: "Manage agent skill installations",
		},
		async run() {
			const meta = deriveSkillMeta(rootCmd, options.version);
			const scope = options.scope ?? "global";

			// Detect installed agents
			const detectedAgents = await detectInstalledAgents();
			if (detectedAgents.length === 0) {
				console.log(
					"No supported agents detected. Install Claude Code or OpenCode first.",
				);
				return;
			}

			// Check current skill status for each agent
			const status = await skillStatus({
				name: meta.name,
				agents: detectedAgents,
				scope,
			});

			// Build multiselect choices with status hints and pre-selection
			const installedAgents: AgentTarget[] = [];
			const choices = status.agents.map((entry) => {
				const hint = entry.installed
					? `v${entry.version} installed`
					: "not installed";

				if (entry.installed) {
					installedAgents.push(entry.agent);
				}

				return {
					label: AGENT_LABELS[entry.agent],
					value: entry.agent,
					hint,
				};
			});

			// Single multiselect — pre-check currently installed agents
			const selected = await multiselect({
				message: "Select agents to install skills for",
				choices,
				default: installedAgents,
				required: false,
			});

			// Compute diff
			const toInstall = selected.filter(
				(agent) => !installedAgents.includes(agent),
			);
			const toUpdate = selected.filter((agent) => {
				const entry = status.agents.find((a) => a.agent === agent);
				return entry?.installed === true && entry.version !== meta.version;
			});
			const toUninstall = installedAgents.filter(
				(agent) => !selected.includes(agent),
			);

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
							}),
					});

					console.log(`\nInstalled "${meta.name}" v${meta.version}`);
					for (const r of result.agents) {
						console.log(`  ${AGENT_LABELS[r.agent]} → ${r.outputDir}`);
					}
				} catch (err) {
					if (err instanceof SkillConflictError) {
						const overwrite = await confirm({
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
									}),
							});

							console.log(`\nInstalled "${meta.name}" v${meta.version}`);
							for (const r of result.agents) {
								console.log(`  ${AGENT_LABELS[r.agent]} → ${r.outputDir}`);
							}
						} else {
							console.log(`\nSkipped ${AGENT_LABELS[err.details.agent]}`);
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

				const removed = result.agents
					.filter((a) => a.status === "removed")
					.map((a) => AGENT_LABELS[a.agent]);

				if (removed.length > 0) {
					console.log(`\nRemoved from ${removed.join(", ")}`);
				}
			}

			// No changes
			if (agentsToGenerate.length === 0 && toUninstall.length === 0) {
				console.log("No changes.");
			}
		},
	});
}
