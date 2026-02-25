// ────────────────────────────────────────────────────────────────────────────
// Agent path resolution — maps agent targets and scopes to filesystem paths
// ────────────────────────────────────────────────────────────────────────────

import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentTarget, Scope } from "./types.ts";

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
