// ────────────────────────────────────────────────────────────────────────────
// Agent path resolution and detection
// ────────────────────────────────────────────────────────────────────────────

import { homedir } from "node:os";
import { join } from "node:path";

import { which } from "@crustjs/utils/process";

import type { AgentClass, Scope } from "./types.ts";

interface AgentConfig {
	readonly label: string;
	readonly class: AgentClass;
	readonly projectSkillsDir: string;
	readonly globalSkillsDir: (home: string) => string;
	readonly detectCommands?: readonly string[];
}

const PROJECT_UNIVERSAL_SKILLS_DIR = join(".agents", "skills");

function configHome(home: string): string {
	if (home !== homedir()) {
		return join(home, ".config");
	}

	const xdg = process.env.XDG_CONFIG_HOME?.trim();
	return xdg && xdg.length > 0 ? xdg : join(home, ".config");
}

function universalGlobalSkillsDir(home: string): string {
	return join(home, ".agents", "skills");
}

/** @internal */
export function resolveEffectiveScope(scope: Scope): Scope {
	return scope === "project" && process.cwd() === homedir() ? "global" : scope;
}

// SAFETY: Entry assertions provide declaration-safe value types after each literal is checked against AgentConfig.
const AGENTS = {
	amp: {
		label: "Amp",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	} as AgentConfig,
	adal: {
		label: "AdaL",
		class: "additional",
		projectSkillsDir: join(".adal", "skills"),
		globalSkillsDir: (home) => join(home, ".adal", "skills"),
		detectCommands: ["adal"],
	} as AgentConfig,
	antigravity: {
		label: "Antigravity",
		class: "additional",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: (home) => join(home, ".gemini", "config", "skills"),
		detectCommands: ["antigravity"],
	} as AgentConfig,
	augment: {
		label: "Augment",
		class: "additional",
		projectSkillsDir: join(".augment", "skills"),
		globalSkillsDir: (home) => join(home, ".augment", "skills"),
		detectCommands: ["augment"],
	} as AgentConfig,
	"claude-code": {
		label: "Claude Code",
		class: "additional",
		projectSkillsDir: join(".claude", "skills"),
		globalSkillsDir: (home) =>
			join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude"), "skills"),
		detectCommands: ["claude", "claude-code"],
	} as AgentConfig,
	cline: {
		label: "Cline",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	} as AgentConfig,
	codebuddy: {
		label: "CodeBuddy",
		class: "additional",
		projectSkillsDir: join(".codebuddy", "skills"),
		globalSkillsDir: (home) => join(home, ".codebuddy", "skills"),
		detectCommands: ["codebuddy"],
	} as AgentConfig,
	codex: {
		label: "Codex",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	} as AgentConfig,
	"command-code": {
		label: "Command Code",
		class: "additional",
		projectSkillsDir: join(".commandcode", "skills"),
		globalSkillsDir: (home) => join(home, ".commandcode", "skills"),
		detectCommands: ["command-code", "commandcode"],
	} as AgentConfig,
	continue: {
		label: "Continue",
		class: "additional",
		projectSkillsDir: join(".continue", "skills"),
		globalSkillsDir: (home) => join(home, ".continue", "skills"),
		detectCommands: ["continue"],
	} as AgentConfig,
	cortex: {
		label: "Cortex Code",
		class: "additional",
		projectSkillsDir: join(".cortex", "skills"),
		globalSkillsDir: (home) => join(home, ".snowflake", "cortex", "skills"),
		detectCommands: ["cortex"],
	} as AgentConfig,
	crush: {
		label: "Crush",
		class: "additional",
		projectSkillsDir: join(".crush", "skills"),
		globalSkillsDir: (home) => join(configHome(home), "crush", "skills"),
		detectCommands: ["crush"],
	} as AgentConfig,
	cursor: {
		label: "Cursor",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	} as AgentConfig,
	droid: {
		label: "Droid",
		class: "additional",
		projectSkillsDir: join(".factory", "skills"),
		globalSkillsDir: (home) => join(home, ".factory", "skills"),
		detectCommands: ["droid"],
	} as AgentConfig,
	"gemini-cli": {
		label: "Gemini CLI",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	} as AgentConfig,
	"github-copilot": {
		label: "GitHub Copilot",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	} as AgentConfig,
	goose: {
		label: "Goose",
		class: "additional",
		projectSkillsDir: join(".goose", "skills"),
		globalSkillsDir: (home) => join(configHome(home), "goose", "skills"),
		detectCommands: ["goose"],
	} as AgentConfig,
	"iflow-cli": {
		label: "iFlow CLI",
		class: "additional",
		projectSkillsDir: join(".iflow", "skills"),
		globalSkillsDir: (home) => join(home, ".iflow", "skills"),
		detectCommands: ["iflow", "iflow-cli"],
	} as AgentConfig,
	junie: {
		label: "Junie",
		class: "additional",
		projectSkillsDir: join(".junie", "skills"),
		globalSkillsDir: (home) => join(home, ".junie", "skills"),
		detectCommands: ["junie"],
	} as AgentConfig,
	kilo: {
		label: "Kilo Code",
		class: "additional",
		projectSkillsDir: join(".kilocode", "skills"),
		globalSkillsDir: (home) => join(home, ".kilocode", "skills"),
		detectCommands: ["kilo", "kilocode"],
	} as AgentConfig,
	"kimi-cli": {
		label: "Kimi Code CLI",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	} as AgentConfig,
	"kiro-cli": {
		label: "Kiro CLI",
		class: "additional",
		projectSkillsDir: join(".kiro", "skills"),
		globalSkillsDir: (home) => join(home, ".kiro", "skills"),
		detectCommands: ["kiro", "kiro-cli"],
	} as AgentConfig,
	kode: {
		label: "Kode",
		class: "additional",
		projectSkillsDir: join(".kode", "skills"),
		globalSkillsDir: (home) => join(home, ".kode", "skills"),
		detectCommands: ["kode"],
	} as AgentConfig,
	mcpjam: {
		label: "MCPJam",
		class: "additional",
		projectSkillsDir: join(".mcpjam", "skills"),
		globalSkillsDir: (home) => join(home, ".mcpjam", "skills"),
		detectCommands: ["mcpjam"],
	} as AgentConfig,
	"mistral-vibe": {
		label: "Mistral Vibe",
		class: "additional",
		projectSkillsDir: join(".vibe", "skills"),
		globalSkillsDir: (home) => join(process.env.VIBE_HOME || join(home, ".vibe"), "skills"),
		detectCommands: ["mistral-vibe", "vibe"],
	} as AgentConfig,
	mux: {
		label: "Mux",
		class: "additional",
		projectSkillsDir: join(".mux", "skills"),
		globalSkillsDir: (home) => join(home, ".mux", "skills"),
		detectCommands: ["mux"],
	} as AgentConfig,
	neovate: {
		label: "Neovate",
		class: "additional",
		projectSkillsDir: join(".neovate", "skills"),
		globalSkillsDir: (home) => join(home, ".neovate", "skills"),
		detectCommands: ["neovate"],
	} as AgentConfig,
	opencode: {
		label: "OpenCode",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	} as AgentConfig,
	openclaw: {
		label: "OpenClaw",
		class: "additional",
		projectSkillsDir: "skills",
		globalSkillsDir: (home) => join(home, ".openclaw", "skills"),
		detectCommands: ["openclaw"],
	} as AgentConfig,
	openhands: {
		label: "OpenHands",
		class: "additional",
		projectSkillsDir: join(".openhands", "skills"),
		globalSkillsDir: (home) => join(home, ".openhands", "skills"),
		detectCommands: ["openhands"],
	} as AgentConfig,
	pi: {
		label: "Pi",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	} as AgentConfig,
	pochi: {
		label: "Pochi",
		class: "additional",
		projectSkillsDir: join(".pochi", "skills"),
		globalSkillsDir: (home) => join(home, ".pochi", "skills"),
		detectCommands: ["pochi"],
	} as AgentConfig,
	qoder: {
		label: "Qoder",
		class: "additional",
		projectSkillsDir: join(".qoder", "skills"),
		globalSkillsDir: (home) => join(home, ".qoder", "skills"),
		detectCommands: ["qoder"],
	} as AgentConfig,
	"qwen-code": {
		label: "Qwen Code",
		class: "additional",
		projectSkillsDir: join(".qwen", "skills"),
		globalSkillsDir: (home) => join(home, ".qwen", "skills"),
		detectCommands: ["qwen", "qwen-code"],
	} as AgentConfig,
	replit: {
		label: "Replit",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	} as AgentConfig,
	roo: {
		label: "Roo Code",
		class: "additional",
		projectSkillsDir: join(".roo", "skills"),
		globalSkillsDir: (home) => join(home, ".roo", "skills"),
		detectCommands: ["roo", "roo-code"],
	} as AgentConfig,
	trae: {
		label: "Trae",
		class: "additional",
		projectSkillsDir: join(".trae", "skills"),
		globalSkillsDir: (home) => join(home, ".trae", "skills"),
		detectCommands: ["trae"],
	} as AgentConfig,
	"trae-cn": {
		label: "Trae CN",
		class: "additional",
		projectSkillsDir: join(".trae", "skills"),
		globalSkillsDir: (home) => join(home, ".trae-cn", "skills"),
		detectCommands: ["trae-cn", "trae"],
	} as AgentConfig,
	warp: {
		label: "Warp",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	} as AgentConfig,
	windsurf: {
		label: "Windsurf",
		class: "additional",
		projectSkillsDir: join(".windsurf", "skills"),
		globalSkillsDir: (home) => join(home, ".codeium", "windsurf", "skills"),
		detectCommands: ["windsurf"],
	} as AgentConfig,
	zed: {
		label: "Zed",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	} as AgentConfig,
	zencoder: {
		label: "Zencoder",
		class: "additional",
		projectSkillsDir: join(".zencoder", "skills"),
		globalSkillsDir: (home) => join(home, ".zencoder", "skills"),
		detectCommands: ["zencoder"],
	} as AgentConfig,
};

/** Supported agent targets for skill installation. */
export type AgentTarget = keyof typeof AGENTS;

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

/** Returns agents that do not use the canonical layout at both scopes. */
export function getAdditionalAgents(): AgentTarget[] {
	return ALL_AGENTS.filter((agent) => AGENTS[agent].class === "additional");
}

/** Returns true if the agent uses the canonical layout at both scopes. */
export function isUniversalAgent(agent: AgentTarget): boolean {
	return AGENTS[agent].class === "universal";
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
	const effectiveScope = resolveEffectiveScope(scope);
	const cfg = AGENTS[agent];
	if (effectiveScope === "project") {
		return join(process.cwd(), cfg.projectSkillsDir, name);
	}
	return join(cfg.globalSkillsDir(homedir()), name);
}
