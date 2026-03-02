// ────────────────────────────────────────────────────────────────────────────
// Plugin layer — skillPlugin with interactive command injection
// ────────────────────────────────────────────────────────────────────────────

import type { CommandNode, CrustPlugin } from "@crustjs/core";
import { createCommandNode, VALIDATION_MODE_ENV } from "@crustjs/core";
import { confirm, multiselect, spinner } from "@crustjs/prompts";
import { bold, dim, yellow } from "@crustjs/style";
import { AGENT_LABELS, detectInstalledAgents } from "./agents.ts";
import { SkillConflictError } from "./errors.ts";
import {
	generateSkill,
	resolveSkillName,
	skillStatus,
	uninstallSkill,
} from "./generate.ts";
import type { AgentTarget, SkillMeta, SkillPluginOptions } from "./types.ts";

const DEFAULT_SKILL_COMMAND_NAME = "skill";
const DEFAULT_SKILL_SCOPE = "global";

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Derives a {@link SkillMeta} from a command's `meta` and a version string.
 *
 * The returned `name` is the raw CLI name (e.g. `"my-cli"`). The `use-`
 * prefix is applied downstream by `generateSkill()` and friends.
 */
function deriveSkillMeta(command: CommandNode, version: string): SkillMeta {
	return {
		name: command.meta.name,
		description: command.meta.description ?? "",
		version,
	};
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
	rootCmd: CommandNode,
	options: SkillPluginOptions,
): Promise<void> {
	const scope = options.scope ?? DEFAULT_SKILL_SCOPE;
	const agents = await detectInstalledAgents({ scope });
	if (agents.length === 0) {
		return;
	}

	const meta = deriveSkillMeta(rootCmd, options.version);

	const status = await skillStatus({
		name: meta.name,
		agents,
		scope,
	});

	const needsUpdate = status.agents.filter(
		(a) => a.installed && a.version !== meta.version,
	);

	if (needsUpdate.length === 0) {
		return;
	}

	try {
		await spinner({
			message: "Updating skills...",
			task: async ({ updateMessage }) => {
				const res = await generateSkill({
					command: rootCmd,
					meta,
					agents: needsUpdate.map((a) => a.agent),
					scope: options.scope,
				});

				const updatedAgents = res.agents
					.filter((a) => a.status === "updated")
					.map((a) => AGENT_LABELS[a.agent]);

				if (updatedAgents.length > 0) {
					updateMessage(
						`Updated skill "${resolveSkillName(meta.name)}" to v${meta.version} for ${updatedAgents.join(", ")}`,
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
						`but was not created by ${meta.name}. Skipping auto-update. ` +
						`Delete or rename the conflicting skill to resolve.`,
				),
			);
		} else {
			throw err;
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
 * Installed agents are detected automatically based on the configured scope.
 * - `scope: "global"` checks global config roots in the home directory
 * - `scope: "project"` checks project-local config roots in the cwd, then
 *   falls back to global roots in the home directory
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
 * Set `command: false` to disable command injection.
 *
 * For first-time installation, use the interactive command or build custom
 * auto-install logic with the exported primitives (`detectInstalledAgents`,
 * `skillStatus`, `generateSkill`).
 *
 * @param options - Plugin configuration with version and scope
 * @returns A `CrustPlugin` to register in a command's `plugins` array
 *
 * @example
 * ```ts
 * import { Crust } from "@crustjs/core";
 * import { skillPlugin } from "@crustjs/skills";
 *
 * const app = new Crust({ name: "my-cli", description: "My CLI" })
 *   .use(skillPlugin({
 *     version: "1.0.0",
 *     command: true, // registers "my-cli skill" subcommand
 *   }))
 *   .run(() => { /* ... *​/ });
 *
 * await app.execute();
 * ```
 */
export function skillPlugin(options: SkillPluginOptions): CrustPlugin {
	let rootCmd: CommandNode;

	return {
		name: "skills",
		async setup(context, actions) {
			rootCmd = context.rootCommand;
			const skillCommandName =
				typeof options.command === "string"
					? options.command
					: DEFAULT_SKILL_COMMAND_NAME;

			// Inject interactive skill command unless explicitly disabled
			if (options.command !== false) {
				actions.addSubCommand(
					rootCmd,
					skillCommandName,
					buildSkillCommand(rootCmd, options),
				);
			}

			// Build validation should never mutate user environments
			if (process.env[VALIDATION_MODE_ENV] === "1") {
				return;
			}

			// Skip auto-update when the skill command itself is being executed
			if (options.command !== false && context.argv[0] === skillCommandName) {
				return;
			}

			// Auto-update already-installed skills when version changes
			if (options.autoUpdate !== false) {
				await autoUpdateSkills(rootCmd, options);
			}
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
	rootCmd: CommandNode,
	options: SkillPluginOptions,
): CommandNode {
	const node = createCommandNode({
		name: DEFAULT_SKILL_COMMAND_NAME,
		description: "Manage agent skill installations",
	});
	node.run = async () => {
		const meta = deriveSkillMeta(rootCmd, options.version);
		const scope = options.scope ?? DEFAULT_SKILL_SCOPE;

		// Detect installed agents
		const detectedAgents = await detectInstalledAgents({
			scope,
		});
		if (detectedAgents.length === 0) {
			console.log(
				yellow(
					"No supported agents detected. Install Claude Code or OpenCode first.",
				),
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
		// In non-interactive mode (no TTY), install to all detected agents
		const isInteractive = process.stdin.isTTY;
		const selected = await multiselect({
			message: "Select agents to install skills for",
			choices,
			default: installedAgents,
			initial: !isInteractive ? detectedAgents : undefined,
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

				console.log(`\n${bold(`Installed "${meta.name}" v${meta.version}`)}`);
				for (const r of result.agents) {
					console.log(dim(`  ${AGENT_LABELS[r.agent]} → ${r.outputDir}`));
				}
			} catch (err) {
				if (err instanceof SkillConflictError) {
					const overwrite = await confirm({
						message:
							`"${err.details.outputDir}" already exists but was not ` +
							`created by Crust. Overwrite?`,
						default: false,
						initial: !isInteractive ? false : undefined,
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

						console.log(
							`\n${bold(`Installed "${meta.name}" v${meta.version}`)}`,
						);
						for (const r of result.agents) {
							console.log(dim(`  ${AGENT_LABELS[r.agent]} → ${r.outputDir}`));
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

			const removed = result.agents
				.filter((a) => a.status === "removed")
				.map((a) => AGENT_LABELS[a.agent]);

			if (removed.length > 0) {
				console.log(`\n${bold(`Removed from ${removed.join(", ")}`)}`);
			}
		}

		// No changes
		if (agentsToGenerate.length === 0 && toUninstall.length === 0) {
			console.log(dim("No changes."));
		}
	};
	return node;
}
