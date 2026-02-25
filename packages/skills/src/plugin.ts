// ────────────────────────────────────────────────────────────────────────────
// Plugin layer — skillPlugin with optional interactive command injection
// ────────────────────────────────────────────────────────────────────────────

import type { AnyCommand, CrustPlugin } from "@crustjs/core";
import { defineCommand } from "@crustjs/core";
import { confirm, multiselect, select, spinner } from "@crustjs/prompts";
import { AGENT_LABELS, detectInstalledAgents } from "./agents.ts";
import { generateSkill, skillStatus, uninstallSkill } from "./generate.ts";
import type {
	AgentTarget,
	Scope,
	SkillMeta,
	SkillPluginOptions,
} from "./types.ts";

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
 * **Interactive command**: set `command: true` to register a `skill` subcommand
 * on the root command for manual install/uninstall/status management. The
 * subcommand is injected via `addSubCommand` during `setup()` — if the user
 * already defines a subcommand with the same name, theirs takes priority.
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

			// Inject interactive skill command if requested
			if (options.command) {
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
// Interactive skill command builder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Builds the interactive skill management command.
 *
 * Supports three actions via prompts: install/update, uninstall, and status.
 * Agents are detected automatically — only installed agents are shown.
 */
function buildSkillCommand(
	rootCmd: AnyCommand,
	options: SkillPluginOptions,
): AnyCommand {
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
			const meta = deriveSkillMeta(rootCmd, options.version);
			const actionFlag = flags.action as string | undefined;
			const scopeFlag = flags.scope as string | undefined;
			const forceFlag = flags.force ?? false;

			// Detect installed agents
			const installedAgents = await detectInstalledAgents();
			if (installedAgents.length === 0) {
				console.log(
					"No supported agents detected. Install Claude Code or OpenCode first.",
				);
				return;
			}

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
				await handleInstall(rootCmd, meta, options, installedAgents, scopeFlag);
			} else if (action === "uninstall") {
				await handleUninstall(meta, installedAgents, scopeFlag, forceFlag);
			} else if (action === "status") {
				await handleStatus(meta, installedAgents, scopeFlag);
			}
		},
	});
}

// ────────────────────────────────────────────────────────────────────────────
// Install flow
// ────────────────────────────────────────────────────────────────────────────

async function handleInstall(
	rootCmd: AnyCommand,
	meta: SkillMeta,
	options: SkillPluginOptions,
	installedAgents: AgentTarget[],
	scopeFlag: string | undefined,
): Promise<void> {
	// Select agents
	const agents = await multiselect<AgentTarget>({
		message: "Which agents?",
		choices: installedAgents.map((a) => ({
			label: AGENT_LABELS[a],
			value: a,
		})),
		default: installedAgents,
		required: true,
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
				command: rootCmd,
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
	installedAgents: AgentTarget[],
	scopeFlag: string | undefined,
	forceFlag: boolean,
): Promise<void> {
	// Select agents
	const agents = await multiselect<AgentTarget>({
		message: "Which agents to uninstall from?",
		choices: installedAgents.map((a) => ({
			label: AGENT_LABELS[a],
			value: a,
		})),
		default: installedAgents,
		required: true,
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
	installedAgents: AgentTarget[],
	scopeFlag: string | undefined,
): Promise<void> {
	const scope = (scopeFlag as Scope | undefined) ?? "global";

	const result = await skillStatus({
		name: meta.name,
		agents: installedAgents,
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
