// ────────────────────────────────────────────────────────────────────────────
// Agent path resolution and detection
// ────────────────────────────────────────────────────────────────────────────

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { AGENTS } from "./agents.generated.ts";
import { sharedSkillsDir } from "./link.ts";

export type AgentClass = "universal" | "additional";
export type Scope = "global" | "project";

/** An agent id from the `skills` package's registry, snapshotted in `agents.generated.ts`. */
export type AgentTarget = keyof typeof AGENTS;

const UNIVERSAL_SKILLS_DIR = ".agents/skills";

/**
 * All agent targets supported by `@crustjs/skills`.
 *
 * @internal
 */
export const ALL_AGENTS =
	// SAFETY: Object.keys returns exactly the enumerable string keys of AGENTS.
	Object.keys(AGENTS) as AgentTarget[];

/**
 * Human-readable labels for each agent target.
 *
 * @internal
 */
export const AGENT_LABELS =
	// SAFETY: ALL_AGENTS supplies every AgentTarget key to the mapped entries.
	Object.fromEntries(ALL_AGENTS.map((agent) => [agent, AGENTS[agent][0]])) as Record<
		AgentTarget,
		string
	>;

function agentClass(agent: AgentTarget): AgentClass {
	const [, projectDir, globalDir] = AGENTS[agent];
	return projectDir === UNIVERSAL_SKILLS_DIR && globalDir === UNIVERSAL_SKILLS_DIR
		? "universal"
		: "additional";
}

/** Absolute global skills directory, or `undefined` when the agent has none. */
function globalSkillsDir(agent: AgentTarget): string | undefined {
	// The one upstream override carried here; the snapshot has none of upstream's other
	// environment overrides or per-platform paths.
	const claudeConfigDir = agent === "claude-code" ? process.env.CLAUDE_CONFIG_DIR?.trim() : "";
	if (claudeConfigDir) return join(claudeConfigDir, "skills");
	const dir = AGENTS[agent][2];
	return dir === null ? undefined : join(homedir(), dir);
}

/** Returns agents that use the canonical `.agents/skills` layout. */
export function getUniversalAgents(): AgentTarget[] {
	return ALL_AGENTS.filter((agent) => agentClass(agent) === "universal");
}

/**
 * Returns agents that do not use the canonical layout at both scopes.
 *
 * @internal
 */
export function getAdditionalAgents(): AgentTarget[] {
	return ALL_AGENTS.filter((agent) => agentClass(agent) === "additional");
}

/**
 * Whether the agent has a skills directory at `scope`; some have none at global scope.
 *
 * @internal
 */
export function isAgentAvailable(agent: AgentTarget, scope: Scope): boolean {
	return scope === "project" || AGENTS[agent][2] !== null;
}

/**
 * Agents with a skills directory at `scope`.
 *
 * @internal
 */
export function getScopeAgents(scope: Scope): AgentTarget[] {
	return ALL_AGENTS.filter((agent) => isAgentAvailable(agent, scope));
}

/**
 * Whether the agent reads the shared `.agents/skills` folder at `scope`, so it needs no link of its own.
 *
 * @internal
 */
export function readsSharedFolder(agent: AgentTarget, scope: Scope): boolean {
	return (
		isAgentAvailable(agent, scope) &&
		dirname(resolveAgentPath(agent, scope, "_")) === sharedSkillsDir(scope)
	);
}

/**
 * The folder whose presence shows an agent is installed: the one containing its global
 * skills directory, unless that is the home directory or the shared `~/.agents`, which
 * exist for unrelated reasons.
 *
 * @internal
 */
export function agentDetectionFolder(skillsDir: string, home: string): string | undefined {
	const folder = dirname(skillsDir);
	return folder === home || folder === join(home, ".agents") ? undefined : folder;
}

/**
 * Detects installed non-universal agents by the folder containing their global skills
 * directory, such as `~/.claude` for `~/.claude/skills`. Project folders are not consulted.
 *
 * Universal agents are intentionally not detected here so callers can always
 * present them as a single optional "Universal" install target.
 */
export async function detectInstalledAgents(): Promise<AgentTarget[]> {
	const home = homedir();
	return getAdditionalAgents().filter((agent) => {
		const skillsDir = globalSkillsDir(agent);
		const folder = skillsDir === undefined ? undefined : agentDetectionFolder(skillsDir, home);
		return folder !== undefined && existsSync(folder);
	});
}

/**
 * Resolves the filesystem path for a skill installation.
 *
 * @internal
 */
export function resolveAgentPath(agent: AgentTarget, scope: Scope, name: string): string {
	if (scope === "project") return join(process.cwd(), AGENTS[agent][1], name);
	const skillsDir = globalSkillsDir(agent);
	if (skillsDir === undefined) {
		throw new Error(
			`Agent "${agent}" (${AGENT_LABELS[agent]}) has no global skills directory; use project scope.`,
		);
	}
	return join(skillsDir, name);
}
