// ────────────────────────────────────────────────────────────────────────────
// Agent path resolution and detection
// ────────────────────────────────────────────────────────────────────────────

import { homedir } from "node:os";
import { join } from "node:path";

import { which } from "@crustjs/utils/process";

export type AgentClass = "universal" | "additional";
export type Scope = "global" | "project";

export type AgentTarget =
	| "adal"
	| "amp"
	| "antigravity"
	| "augment"
	| "claude-code"
	| "cline"
	| "codebuddy"
	| "codex"
	| "command-code"
	| "cortex"
	| "crush"
	| "cursor"
	| "devin"
	| "droid"
	| "gemini-cli"
	| "github-copilot"
	| "goose"
	| "junie"
	| "kilo"
	| "kimi-code-cli"
	| "kiro-cli"
	| "kode"
	| "mistral-vibe"
	| "opencode"
	| "openclaw"
	| "openhands"
	| "pi"
	| "pochi"
	| "qoder"
	| "qwen-code"
	| "replit"
	| "trae"
	| "trae-cn"
	| "warp"
	| "xum"
	| "zed"
	| "zencoder";

type AgentRegistry = { readonly [Agent in AgentTarget]: AgentConfig };

interface AgentConfig {
	readonly label: string;
	readonly class: AgentClass;
	readonly projectSkillsDir: string;
	readonly globalSkillsDir: (home: string) => string;
	readonly detectCommands?: readonly string[];
}

const PROJECT_UNIVERSAL_SKILLS_DIR = join(".agents", "skills");

function universalGlobalSkillsDir(home: string): string {
	return join(home, ".agents", "skills");
}

const universal = (label: string): AgentConfig => ({
	label,
	class: "universal",
	projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
	globalSkillsDir: universalGlobalSkillsDir,
});

/** @internal */
export function resolveEffectiveScope(scope: Scope): Scope {
	return scope === "project" && process.cwd() === homedir() ? "global" : scope;
}

const AGENTS: AgentRegistry = {
	adal: {
		label: "AdaL",
		class: "additional",
		projectSkillsDir: join(".adal", "skills"),
		globalSkillsDir: (home) => join(home, ".adal", "skills"),
		detectCommands: ["adal"],
	},
	amp: universal("Amp"),
	antigravity: {
		label: "Antigravity",
		class: "additional",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: (home) => join(home, ".gemini", "config", "skills"),
		detectCommands: ["agy", "antigravity"],
	},
	augment: universal("Augment"),
	"claude-code": {
		label: "Claude Code",
		class: "additional",
		projectSkillsDir: join(".claude", "skills"),
		globalSkillsDir: (home) =>
			join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude"), "skills"),
		detectCommands: ["claude"],
	},
	cline: universal("Cline"),
	codebuddy: {
		label: "CodeBuddy",
		class: "additional",
		projectSkillsDir: join(".codebuddy", "skills"),
		globalSkillsDir: (home) => join(home, ".codebuddy", "skills"),
		detectCommands: ["codebuddy", "cbc"],
	},
	codex: universal("Codex"),
	"command-code": universal("Command Code"),
	cortex: {
		label: "Cortex Code",
		class: "additional",
		projectSkillsDir: join(".cortex", "skills"),
		globalSkillsDir: (home) => join(home, ".snowflake", "cortex", "skills"),
		detectCommands: ["cortex"],
	},
	crush: universal("Crush"),
	cursor: universal("Cursor"),
	devin: universal("Devin"),
	droid: universal("Droid"),
	"gemini-cli": universal("Gemini CLI"),
	"github-copilot": universal("GitHub Copilot"),
	goose: universal("Goose"),
	junie: universal("Junie"),
	kilo: universal("Kilo Code"),
	"kimi-code-cli": universal("Kimi Code CLI"),
	"kiro-cli": {
		label: "Kiro CLI",
		class: "additional",
		projectSkillsDir: join(".kiro", "skills"),
		globalSkillsDir: (home) => join(home, ".kiro", "skills"),
		detectCommands: ["kiro-cli", "kiro"],
	},
	kode: {
		label: "Kode",
		class: "additional",
		projectSkillsDir: join(".kode", "skills"),
		globalSkillsDir: (home) => join(home, ".kode", "skills"),
		detectCommands: ["kode"],
	},
	"mistral-vibe": universal("Mistral Vibe"),
	opencode: universal("OpenCode"),
	openclaw: universal("OpenClaw"),
	openhands: universal("OpenHands"),
	pi: universal("Pi"),
	pochi: universal("Pochi"),
	qoder: {
		label: "Qoder",
		class: "additional",
		projectSkillsDir: join(".qoder", "skills"),
		globalSkillsDir: (home) => join(home, ".qoder", "skills"),
		detectCommands: ["qoder", "qodercli"],
	},
	"qwen-code": universal("Qwen Code"),
	replit: universal("Replit"),
	trae: {
		label: "Trae",
		class: "additional",
		projectSkillsDir: join(".trae", "skills"),
		globalSkillsDir: (home) => join(home, ".trae", "skills"),
		detectCommands: ["trae"],
	},
	"trae-cn": {
		label: "Trae CN",
		class: "additional",
		projectSkillsDir: join(".trae", "skills"),
		globalSkillsDir: (home) => join(home, ".trae-cn", "skills"),
		detectCommands: ["trae-cn"],
	},
	warp: universal("Warp"),
	xum: universal("Xum"),
	zed: universal("Zed"),
	zencoder: universal("Zencoder"),
};

const agentKeys = Object.keys(AGENTS);

/**
 * All agent targets supported by `@crustjs/skills`.
 *
 * @internal
 */
export const ALL_AGENTS =
	// SAFETY: Object.keys returns exactly the enumerable string keys of AGENTS.
	agentKeys as AgentTarget[];

/**
 * Human-readable labels for each agent target.
 *
 * @internal
 */
export const AGENT_LABELS =
	// SAFETY: ALL_AGENTS supplies every AgentTarget key to the mapped entries.
	Object.fromEntries(ALL_AGENTS.map((agent) => [agent, AGENTS[agent].label])) as Record<
		AgentTarget,
		string
	>;

/** Returns agents that use the canonical `.agents/skills` layout. */
export function getUniversalAgents(): AgentTarget[] {
	return ALL_AGENTS.filter((agent) => AGENTS[agent].class === "universal");
}

/**
 * Returns agents that do not use the canonical layout at both scopes.
 *
 * @internal
 */
export function getAdditionalAgents(): AgentTarget[] {
	return ALL_AGENTS.filter((agent) => AGENTS[agent].class === "additional");
}

/**
 * Detects installed non-universal agents by checking PATH for their CLI binaries.
 *
 * Universal agents are intentionally not detected here so callers can always
 * present them as a single optional "Universal" install target.
 */
export async function detectInstalledAgents(): Promise<AgentTarget[]> {
	return getAdditionalAgents().filter((agent) =>
		(AGENTS[agent].detectCommands ?? []).some((command) => which(command) !== null),
	);
}

/**
 * Resolves the filesystem path for a skill installation.
 *
 * @internal
 */
export function resolveAgentPath(agent: AgentTarget, scope: Scope, name: string): string {
	const cfg = AGENTS[agent];
	if (scope === "project") {
		return join(process.cwd(), cfg.projectSkillsDir, name);
	}
	return join(cfg.globalSkillsDir(homedir()), name);
}
