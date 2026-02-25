// ────────────────────────────────────────────────────────────────────────────
// Agent path resolution and detection
// ────────────────────────────────────────────────────────────────────────────

import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentTarget, Scope } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/** All agent targets supported by `@crustjs/skills`. */
export const ALL_AGENTS: AgentTarget[] = ["claude-code", "opencode"];

/** Human-readable labels for each agent target. */
export const AGENT_LABELS: Record<AgentTarget, string> = {
	"claude-code": "Claude Code",
	opencode: "OpenCode",
};

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the filesystem path for a skill installation.
 *
 * Resolution table:
 * | Agent + Scope            | Path                                        |
 * | ------------------------ | ------------------------------------------- |
 * | `claude-code` + global   | `<homedir>/.claude/skills/<name>/`          |
 * | `claude-code` + project  | `<cwd>/.claude/skills/<name>/`              |
 * | `opencode` + global      | `<homedir>/.config/opencode/skills/<name>/` |
 * | `opencode` + project     | `<cwd>/.opencode/skills/<name>/`            |
 *
 * @param agent - The target agent
 * @param scope - Installation scope (global or project)
 * @param name - Skill name (used as the directory name)
 * @returns Absolute path to the skill directory
 */
export function resolveAgentPath(
	agent: AgentTarget,
	scope: Scope,
	name: string,
): string {
	const base = scope === "global" ? homedir() : process.cwd();

	switch (agent) {
		case "claude-code":
			return join(base, ".claude", "skills", name);
		case "opencode":
			if (scope === "global") {
				return join(base, ".config", "opencode", "skills", name);
			}
			return join(base, ".opencode", "skills", name);
	}
}

/**
 * Detects which supported agents are installed by checking for the
 * existence of their global configuration directories.
 *
 * Detection always checks global paths regardless of the intended
 * installation scope — if the agent's global config directory exists,
 * the agent is considered installed.
 *
 * Detection table:
 * | Agent        | Config directory              |
 * | ------------ | ----------------------------- |
 * | `claude-code`| `<homedir>/.claude/`          |
 * | `opencode`   | `<homedir>/.config/opencode/` |
 *
 * @param home - Override the home directory for detection (defaults to `os.homedir()`).
 *               Primarily useful for testing.
 * @returns Array of detected agent targets (may be empty)
 *
 * @example
 * ```ts
 * const agents = await detectInstalledAgents();
 * // ["claude-code"] — only Claude Code config found
 * ```
 */
export async function detectInstalledAgents(
	home?: string,
): Promise<AgentTarget[]> {
	const resolvedHome = home ?? homedir();
	const detected: AgentTarget[] = [];

	for (const agent of ALL_AGENTS) {
		const configDir = resolveAgentConfigDir(resolvedHome, agent);
		const exists = await access(configDir)
			.then(() => true)
			.catch(() => false);

		if (exists) {
			detected.push(agent);
		}
	}

	return detected;
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the global configuration root directory for an agent.
 *
 * This is the directory whose existence indicates the agent is installed,
 * distinct from the skill output directory.
 */
function resolveAgentConfigDir(home: string, agent: AgentTarget): string {
	switch (agent) {
		case "claude-code":
			return join(home, ".claude");
		case "opencode":
			return join(home, ".config", "opencode");
	}
}
