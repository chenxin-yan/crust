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

/**
 * Options for detecting installed agents.
 */
export interface DetectInstalledAgentsOptions {
	/**
	 * Detection scope.
	 * - `global`: checks global config roots under home directory.
	 * - `project`: checks project-local config roots under cwd, then falls back
	 *   to global roots under home directory when local roots are missing.
	 * @default "global"
	 */
	scope?: Scope;
	/** Home directory override used for global detection (tests). */
	home?: string;
	/** Working directory override used for project detection (tests). */
	cwd?: string;
}

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
 * Detects which supported agents are installed by checking for agent
 * configuration roots for the requested scope.
 *
 * Detection table:
 * | Scope     | Agent        | Config directories checked                 |
 * | --------- | ------------ | ------------------------------------------ |
 * | `global`  | `claude-code`| `<homedir>/.claude/`                       |
 * | `global`  | `opencode`   | `<homedir>/.config/opencode/`              |
 * | `project` | `claude-code`| `<cwd>/.claude/`, fallback `<homedir>/.claude/` |
 * | `project` | `opencode`   | `<cwd>/.opencode/`, fallback `<homedir>/.config/opencode/` |
 *
 * @param options - Optional scope/home/cwd overrides. For backwards
 *                  compatibility, passing a string is treated as `home`.
 * @returns Array of detected agent targets (may be empty)
 *
 * @example
 * ```ts
 * const agents = await detectInstalledAgents();
 * // ["claude-code"] — only Claude Code config found
 * ```
 */
export async function detectInstalledAgents(
	options?: string | DetectInstalledAgentsOptions,
): Promise<AgentTarget[]> {
	const resolvedOptions: DetectInstalledAgentsOptions =
		typeof options === "string" ? { home: options } : (options ?? {});
	const scope = resolvedOptions.scope ?? "global";
	const resolvedHome = resolvedOptions.home ?? homedir();
	const resolvedCwd = resolvedOptions.cwd ?? process.cwd();
	const detected: AgentTarget[] = [];

	for (const agent of ALL_AGENTS) {
		const configDirs = resolveAgentConfigDirs(
			agent,
			scope,
			resolvedHome,
			resolvedCwd,
		);

		let exists = false;
		for (const configDir of configDirs) {
			exists = await access(configDir)
				.then(() => true)
				.catch(() => false);
			if (exists) {
				break;
			}
		}

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
function resolveAgentConfigDirs(
	agent: AgentTarget,
	scope: Scope,
	home: string,
	cwd: string,
): string[] {
	if (scope === "project") {
		switch (agent) {
			case "claude-code":
				return [join(cwd, ".claude"), join(home, ".claude")];
			case "opencode":
				return [join(cwd, ".opencode"), join(home, ".config", "opencode")];
		}
	}

	switch (agent) {
		case "claude-code":
			return [join(home, ".claude")];
		case "opencode":
			return [join(home, ".config", "opencode")];
	}
}
