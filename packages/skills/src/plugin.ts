// ────────────────────────────────────────────────────────────────────────────
// Plugin layer — skillPlugin (auto mode) and createSkillCommand (command mode)
// ────────────────────────────────────────────────────────────────────────────

import type { AnyCommand, CrustPlugin } from "@crustjs/core";
import { defineCommand } from "@crustjs/core";
import { confirm, multiselect, select, spinner } from "@crustjs/prompts";
import { generateSkill, skillStatus, uninstallSkill } from "./generate.ts";
import type {
	AgentTarget,
	Scope,
	SkillCommandOptions,
	SkillMeta,
	SkillPluginOptions,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const ALL_AGENTS: AgentTarget[] = ["claude-code", "opencode"];

const AGENT_LABELS: Record<AgentTarget, string> = {
	"claude-code": "Claude Code",
	opencode: "OpenCode",
};

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/** Derives a {@link SkillMeta} from a command's `meta` and a version string. */
function deriveSkillMeta(command: AnyCommand, version: string): SkillMeta {
	return {
		name: command.meta.name,
		description: command.meta.description ?? "",
		version,
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Auto mode plugin — skillPlugin
// ────────────────────────────────────────────────────────────────────────────

/**
 * Auto-mode plugin that silently manages agent skills on every CLI invocation.
 *
 * `name` and `description` are read from the root command's `meta` at setup
 * time — only `version` needs to be supplied in the options.
 *
 * By default the plugin only **updates** already-installed skills when a new
 * version is detected (`autoUpdate: true`). First-time installation is left to
 * the interactive {@link createSkillCommand} (`autoInstall: false`).
 *
 * Set `autoInstall: true` to also install skills that are not yet present.
 *
 * - `setup` phase: captures `rootCommand` from the setup context
 * - `middleware` phase: checks skill versions and installs/updates if needed
 *
 * @param options - Plugin configuration with version, agents, and scope
 * @returns A `CrustPlugin` to register in a command's `plugins` array
 *
 * @example
 * ```ts
 * import { defineCommand } from "@crustjs/core";
 * import { skillPlugin } from "@crustjs/skills";
 *
 * const app = defineCommand({
 *   meta: { name: "my-cli", description: "My CLI" },
 *   plugins: [
 *     skillPlugin({
 *       version: "1.0.0",
 *       agents: ["claude-code", "opencode"],
 *     }),
 *   ],
 * });
 * ```
 */
export function skillPlugin(options: SkillPluginOptions): CrustPlugin {
	let rootCmd: AnyCommand;

	return {
		name: "skills",
		setup(context) {
			rootCmd = context.rootCommand;
		},
		async middleware(_context, next) {
			const autoInstall = options.autoInstall ?? false;
			const autoUpdate = options.autoUpdate ?? true;
			const meta = deriveSkillMeta(rootCmd, options.version);

			const status = await skillStatus({
				name: meta.name,
				agents: options.agents,
				scope: options.scope ?? "global",
			});

			const needsUpdate = status.agents.filter((a) => {
				if (!a.installed) return autoInstall;
				if (a.version !== meta.version) return autoUpdate;
				return false;
			});

			if (needsUpdate.length > 0) {
				const result = await generateSkill({
					command: rootCmd,
					meta,
					agents: needsUpdate.map((a) => a.agent),
					scope: options.scope,
				});

				// Print one-line summary
				const agentNames = result.agents
					.filter((a) => a.status !== "up-to-date")
					.map((a) => AGENT_LABELS[a.agent]);

				if (agentNames.length > 0) {
					console.log(
						`Skill "${meta.name}" v${meta.version} installed for ${agentNames.join(", ")}`,
					);
				}
			}

			await next();
		},
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Command mode — createSkillCommand
// ────────────────────────────────────────────────────────────────────────────

/**
 * Creates an interactive command for managing agent skills.
 *
 * `name` and `description` are read from the root command's `meta` (via the
 * lazy `command` reference) — only `version` needs to be supplied.
 *
 * The command supports three actions via interactive prompts:
 * - **Install / update** — select agents and scope, then install skills
 * - **Uninstall** — select agents and confirm removal
 * - **Check status** — display installation status for all agents
 *
 * All prompts can be skipped via flags for CI/scripting:
 * - `--action`: `"install" | "uninstall" | "status"`
 * - `--agent`: agent target (can be specified multiple times)
 * - `--scope`: `"global" | "project"`
 * - `--force`: skip confirmation on uninstall
 *
 * @param options - Command configuration with lazy root command ref and version
 * @returns An `AnyCommand` to mount as a subcommand
 *
 * @example
 * ```ts
 * import { defineCommand } from "@crustjs/core";
 * import { createSkillCommand } from "@crustjs/skills";
 *
 * let app: AnyCommand;
 * const skillCmd = createSkillCommand({
 *   command: () => app,
 *   version: "1.0.0",
 * });
 * app = defineCommand({
 *   meta: { name: "my-cli", description: "My CLI" },
 *   subCommands: { skill: skillCmd },
 * });
 * ```
 */
export function createSkillCommand(options: SkillCommandOptions): AnyCommand {
	const availableAgents = options.agents ?? ALL_AGENTS;

	return defineCommand({
		meta: {
			name: "skill",
			description: "Manage agent skills (install, uninstall, status)",
		},
		flags: {
			action: {
				type: "string",
				description:
					'Action to perform: "install", "uninstall", or "status" (skips prompt)',
			},
			agent: {
				type: "string",
				multiple: true,
				description:
					"Agent target (can be specified multiple times, skips prompt)",
			},
			scope: {
				type: "string",
				description: 'Installation scope: "global" or "project" (skips prompt)',
			},
			force: {
				type: "boolean",
				description: "Skip confirmation prompts",
			},
		} as const,
		async run({ flags }) {
			const meta = deriveSkillMeta(options.command(), options.version);
			const actionFlag = flags.action as string | undefined;
			const agentFlag = flags.agent as string[] | undefined;
			const scopeFlag = flags.scope as string | undefined;
			const forceFlag = flags.force ?? false;

			// Step 1 — Select action
			const action = await select<string>({
				message: "What would you like to do?",
				choices: [
					{ label: "Install / update skills", value: "install" },
					{ label: "Uninstall skills", value: "uninstall" },
					{ label: "Check status", value: "status" },
				],
				initial: actionFlag,
			});

			if (action === "install") {
				await handleInstall(
					options,
					meta,
					availableAgents,
					agentFlag,
					scopeFlag,
				);
			} else if (action === "uninstall") {
				await handleUninstall(
					meta,
					availableAgents,
					agentFlag,
					scopeFlag,
					forceFlag,
				);
			} else if (action === "status") {
				await handleStatus(meta, availableAgents, agentFlag, scopeFlag);
			}
		},
	});
}

// ────────────────────────────────────────────────────────────────────────────
// Install flow
// ────────────────────────────────────────────────────────────────────────────

async function handleInstall(
	options: SkillCommandOptions,
	meta: SkillMeta,
	availableAgents: AgentTarget[],
	agentFlag: string[] | undefined,
	scopeFlag: string | undefined,
): Promise<void> {
	// Select agents
	const agents = await multiselect<AgentTarget>({
		message: "Which agents?",
		choices: availableAgents.map((a) => ({
			label: AGENT_LABELS[a],
			value: a,
		})),
		default: availableAgents,
		required: true,
		initial: agentFlag as AgentTarget[] | undefined,
	});

	// Select scope
	const scope = await select<Scope>({
		message: "Scope?",
		choices: [
			{ label: "Global", value: "global" as Scope, hint: "recommended" },
			{ label: "Project", value: "project" as Scope },
		],
		default: options.scope ?? "global",
		initial: scopeFlag as Scope | undefined,
	});

	// Install with spinner
	const result = await spinner({
		message: "Installing skills...",
		task: async () =>
			generateSkill({
				command: options.command(),
				meta,
				agents,
				scope,
			}),
	});

	// Print summary
	console.log(`\nInstalled "${meta.name}" v${meta.version}`);
	for (const r of result.agents) {
		if (r.status !== "up-to-date") {
			console.log(`  ${AGENT_LABELS[r.agent]} → ${r.outputDir}`);
		} else {
			console.log(`  ${AGENT_LABELS[r.agent]} — already up-to-date`);
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Uninstall flow
// ────────────────────────────────────────────────────────────────────────────

async function handleUninstall(
	meta: SkillMeta,
	availableAgents: AgentTarget[],
	agentFlag: string[] | undefined,
	scopeFlag: string | undefined,
	forceFlag: boolean,
): Promise<void> {
	// Select agents
	const agents = await multiselect<AgentTarget>({
		message: "Which agents to uninstall from?",
		choices: availableAgents.map((a) => ({
			label: AGENT_LABELS[a],
			value: a,
		})),
		default: availableAgents,
		required: true,
		initial: agentFlag as AgentTarget[] | undefined,
	});

	// Confirm
	const agentNames = agents.map((a) => AGENT_LABELS[a]).join(", ");
	const confirmed = await confirm({
		message: `Remove "${meta.name}" skills from ${agentNames}?`,
		initial: forceFlag ? true : undefined,
	});

	if (!confirmed) {
		console.log("Cancelled.");
		return;
	}

	const scope = (scopeFlag as Scope | undefined) ?? "global";

	// Uninstall with spinner
	const result = await spinner({
		message: "Removing skills...",
		task: async () =>
			uninstallSkill({
				name: meta.name,
				agents,
				scope,
			}),
	});

	// Print summary
	const removed = result.agents
		.filter((a) => a.status === "removed")
		.map((a) => AGENT_LABELS[a.agent]);

	if (removed.length > 0) {
		console.log(`\nRemoved from ${removed.join(", ")}`);
	} else {
		console.log("\nNo installed skills found.");
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Status flow
// ────────────────────────────────────────────────────────────────────────────

async function handleStatus(
	meta: SkillMeta,
	availableAgents: AgentTarget[],
	agentFlag: string[] | undefined,
	scopeFlag: string | undefined,
): Promise<void> {
	const agents = (agentFlag as AgentTarget[] | undefined) ?? availableAgents;
	const scope = (scopeFlag as Scope | undefined) ?? "global";

	const result = await skillStatus({
		name: meta.name,
		agents,
		scope,
	});

	// Print table
	console.log("");
	console.log(
		`${"Agent".padEnd(14)}${"Scope".padEnd(10)}${"Version".padEnd(10)}Path`,
	);
	for (const entry of result.agents) {
		const agentName = AGENT_LABELS[entry.agent];
		const version = entry.installed
			? (entry.version ?? "—")
			: "(not installed)";
		const path = entry.installed ? entry.outputDir : "";
		console.log(
			`${agentName.padEnd(14)}${scope.padEnd(10)}${version.padEnd(10)}${path}`,
		);
	}
	console.log("");
}
