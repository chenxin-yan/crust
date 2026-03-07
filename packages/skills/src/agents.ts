// ────────────────────────────────────────────────────────────────────────────
// Agent path resolution and detection
// ────────────────────────────────────────────────────────────────────────────

import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { AgentClass, AgentTarget, Scope } from "./types.ts";

interface AgentConfig {
	readonly label: string;
	readonly class: AgentClass;
	readonly projectSkillsDir: string;
	readonly globalSkillsDir: (home: string) => string;
	readonly detectCommands?: readonly string[];
}

const PROJECT_UNIVERSAL_SKILLS_DIR = join(".agents", "skills");
const PROJECT_CANONICAL_SKILLS_DIR = join(".crust", "skills");

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

function canonicalGlobalSkillsDir(home: string): string {
	return join(home, ".crust", "skills");
}

const AGENTS: Record<AgentTarget, AgentConfig> = {
	amp: {
		label: "Amp",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	},
	adal: {
		label: "AdaL",
		class: "additional",
		projectSkillsDir: join(".adal", "skills"),
		globalSkillsDir: (home) => join(home, ".adal", "skills"),
		detectCommands: ["adal"],
	},
	antigravity: {
		label: "Antigravity",
		class: "additional",
		projectSkillsDir: join(".agent", "skills"),
		globalSkillsDir: (home) => join(home, ".gemini", "antigravity", "skills"),
		detectCommands: ["antigravity"],
	},
	augment: {
		label: "Augment",
		class: "additional",
		projectSkillsDir: join(".augment", "skills"),
		globalSkillsDir: (home) => join(home, ".augment", "skills"),
		detectCommands: ["augment"],
	},
	"claude-code": {
		label: "Claude Code",
		class: "additional",
		projectSkillsDir: join(".claude", "skills"),
		globalSkillsDir: (home) =>
			join(
				process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude"),
				"skills",
			),
		detectCommands: ["claude", "claude-code"],
	},
	cline: {
		label: "Cline",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	},
	codebuddy: {
		label: "CodeBuddy",
		class: "additional",
		projectSkillsDir: join(".codebuddy", "skills"),
		globalSkillsDir: (home) => join(home, ".codebuddy", "skills"),
		detectCommands: ["codebuddy"],
	},
	codex: {
		label: "Codex",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	},
	"command-code": {
		label: "Command Code",
		class: "additional",
		projectSkillsDir: join(".commandcode", "skills"),
		globalSkillsDir: (home) => join(home, ".commandcode", "skills"),
		detectCommands: ["command-code", "commandcode"],
	},
	continue: {
		label: "Continue",
		class: "additional",
		projectSkillsDir: join(".continue", "skills"),
		globalSkillsDir: (home) => join(home, ".continue", "skills"),
		detectCommands: ["continue"],
	},
	cortex: {
		label: "Cortex Code",
		class: "additional",
		projectSkillsDir: join(".cortex", "skills"),
		globalSkillsDir: (home) => join(home, ".snowflake", "cortex", "skills"),
		detectCommands: ["cortex"],
	},
	crush: {
		label: "Crush",
		class: "additional",
		projectSkillsDir: join(".crush", "skills"),
		globalSkillsDir: (home) => join(configHome(home), "crush", "skills"),
		detectCommands: ["crush"],
	},
	cursor: {
		label: "Cursor",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	},
	droid: {
		label: "Droid",
		class: "additional",
		projectSkillsDir: join(".factory", "skills"),
		globalSkillsDir: (home) => join(home, ".factory", "skills"),
		detectCommands: ["droid"],
	},
	"gemini-cli": {
		label: "Gemini CLI",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	},
	"github-copilot": {
		label: "GitHub Copilot",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	},
	goose: {
		label: "Goose",
		class: "additional",
		projectSkillsDir: join(".goose", "skills"),
		globalSkillsDir: (home) => join(configHome(home), "goose", "skills"),
		detectCommands: ["goose"],
	},
	"iflow-cli": {
		label: "iFlow CLI",
		class: "additional",
		projectSkillsDir: join(".iflow", "skills"),
		globalSkillsDir: (home) => join(home, ".iflow", "skills"),
		detectCommands: ["iflow", "iflow-cli"],
	},
	junie: {
		label: "Junie",
		class: "additional",
		projectSkillsDir: join(".junie", "skills"),
		globalSkillsDir: (home) => join(home, ".junie", "skills"),
		detectCommands: ["junie"],
	},
	kilo: {
		label: "Kilo Code",
		class: "additional",
		projectSkillsDir: join(".kilocode", "skills"),
		globalSkillsDir: (home) => join(home, ".kilocode", "skills"),
		detectCommands: ["kilo", "kilocode"],
	},
	"kimi-cli": {
		label: "Kimi Code CLI",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	},
	"kiro-cli": {
		label: "Kiro CLI",
		class: "additional",
		projectSkillsDir: join(".kiro", "skills"),
		globalSkillsDir: (home) => join(home, ".kiro", "skills"),
		detectCommands: ["kiro", "kiro-cli"],
	},
	kode: {
		label: "Kode",
		class: "additional",
		projectSkillsDir: join(".kode", "skills"),
		globalSkillsDir: (home) => join(home, ".kode", "skills"),
		detectCommands: ["kode"],
	},
	mcpjam: {
		label: "MCPJam",
		class: "additional",
		projectSkillsDir: join(".mcpjam", "skills"),
		globalSkillsDir: (home) => join(home, ".mcpjam", "skills"),
		detectCommands: ["mcpjam"],
	},
	"mistral-vibe": {
		label: "Mistral Vibe",
		class: "additional",
		projectSkillsDir: join(".vibe", "skills"),
		globalSkillsDir: (home) => join(home, ".vibe", "skills"),
		detectCommands: ["mistral-vibe", "vibe"],
	},
	mux: {
		label: "Mux",
		class: "additional",
		projectSkillsDir: join(".mux", "skills"),
		globalSkillsDir: (home) => join(home, ".mux", "skills"),
		detectCommands: ["mux"],
	},
	neovate: {
		label: "Neovate",
		class: "additional",
		projectSkillsDir: join(".neovate", "skills"),
		globalSkillsDir: (home) => join(home, ".neovate", "skills"),
		detectCommands: ["neovate"],
	},
	opencode: {
		label: "OpenCode",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	},
	openclaw: {
		label: "OpenClaw",
		class: "additional",
		projectSkillsDir: "skills",
		globalSkillsDir: (home) => join(home, ".openclaw", "skills"),
		detectCommands: ["openclaw"],
	},
	openhands: {
		label: "OpenHands",
		class: "additional",
		projectSkillsDir: join(".openhands", "skills"),
		globalSkillsDir: (home) => join(home, ".openhands", "skills"),
		detectCommands: ["openhands"],
	},
	pi: {
		label: "Pi",
		class: "additional",
		projectSkillsDir: join(".pi", "skills"),
		globalSkillsDir: (home) => join(home, ".pi", "agent", "skills"),
		detectCommands: ["pi"],
	},
	pochi: {
		label: "Pochi",
		class: "additional",
		projectSkillsDir: join(".pochi", "skills"),
		globalSkillsDir: (home) => join(home, ".pochi", "skills"),
		detectCommands: ["pochi"],
	},
	qoder: {
		label: "Qoder",
		class: "additional",
		projectSkillsDir: join(".qoder", "skills"),
		globalSkillsDir: (home) => join(home, ".qoder", "skills"),
		detectCommands: ["qoder"],
	},
	"qwen-code": {
		label: "Qwen Code",
		class: "additional",
		projectSkillsDir: join(".qwen", "skills"),
		globalSkillsDir: (home) => join(home, ".qwen", "skills"),
		detectCommands: ["qwen", "qwen-code"],
	},
	replit: {
		label: "Replit",
		class: "universal",
		projectSkillsDir: PROJECT_UNIVERSAL_SKILLS_DIR,
		globalSkillsDir: universalGlobalSkillsDir,
	},
	roo: {
		label: "Roo Code",
		class: "additional",
		projectSkillsDir: join(".roo", "skills"),
		globalSkillsDir: (home) => join(home, ".roo", "skills"),
		detectCommands: ["roo", "roo-code"],
	},
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
		detectCommands: ["trae-cn", "trae"],
	},
	windsurf: {
		label: "Windsurf",
		class: "additional",
		projectSkillsDir: join(".windsurf", "skills"),
		globalSkillsDir: (home) => join(home, ".codeium", "windsurf", "skills"),
		detectCommands: ["windsurf"],
	},
	zencoder: {
		label: "Zencoder",
		class: "additional",
		projectSkillsDir: join(".zencoder", "skills"),
		globalSkillsDir: (home) => join(home, ".zencoder", "skills"),
		detectCommands: ["zencoder"],
	},
};

/** All agent targets supported by `@crustjs/skills`. */
export const ALL_AGENTS = Object.keys(AGENTS) as AgentTarget[];

/** Human-readable labels for each agent target. */
export const AGENT_LABELS: Record<AgentTarget, string> = Object.fromEntries(
	ALL_AGENTS.map((agent) => [agent, AGENTS[agent].label]),
) as Record<AgentTarget, string>;

/** Returns agents that use the canonical `.agents/skills` layout. */
export function getUniversalAgents(): AgentTarget[] {
	return ALL_AGENTS.filter((agent) => AGENTS[agent].class === "universal");
}

/** Returns agents that use agent-specific skill roots. */
export function getAdditionalAgents(): AgentTarget[] {
	return ALL_AGENTS.filter((agent) => AGENTS[agent].class === "additional");
}

/** Returns true if the agent uses the canonical `.agents/skills` layout. */
export function isUniversalAgent(agent: AgentTarget): boolean {
	return AGENTS[agent].class === "universal";
}

export interface DetectInstalledAgentsOptions {
	/** Kept for backwards compatibility with previous API. */
	scope?: Scope;
	/** Kept for backwards compatibility with previous API. */
	home?: string;
	/** Working directory for PATH lookups. */
	cwd?: string;
	/** Test-only hook to override command detection. */
	commandChecker?: (command: string, cwd: string) => Promise<boolean>;
}

/**
 * Detects installed additional agents by checking PATH for their CLI binaries.
 *
 * Universal agents are intentionally not detected here so callers can always
 * present them as a single optional "Universal" install target.
 */
export async function detectInstalledAgents(
	options?: string | DetectInstalledAgentsOptions,
): Promise<AgentTarget[]> {
	const resolvedOptions: DetectInstalledAgentsOptions =
		typeof options === "string" ? { home: options } : (options ?? {});
	const cwd = resolvedOptions.cwd ?? process.cwd();
	const commandChecker =
		resolvedOptions.commandChecker ??
		((command: string) => Promise.resolve(isCommandOnPath(command)));
	const detected: AgentTarget[] = [];

	for (const agent of getAdditionalAgents()) {
		const commands = AGENTS[agent].detectCommands ?? [];
		let installed = false;

		for (const command of commands) {
			if (await commandChecker(command, cwd)) {
				installed = true;
				break;
			}
		}

		if (installed) {
			detected.push(agent);
		}
	}

	return detected;
}

/**
 * Resolves the filesystem path for a skill installation.
 */
export function resolveAgentPath(
	agent: AgentTarget,
	scope: Scope,
	name: string,
): string {
	const cfg = AGENTS[agent];
	if (scope === "project") {
		return join(process.cwd(), cfg.projectSkillsDir, name);
	}
	return join(cfg.globalSkillsDir(homedir()), name);
}

/**
 * Resolves the canonical skill bundle path used by Crust.
 */
export function resolveCanonicalSkillPath(scope: Scope, name: string): string {
	if (scope === "project") {
		return join(process.cwd(), PROJECT_CANONICAL_SKILLS_DIR, name);
	}

	return join(canonicalGlobalSkillsDir(homedir()), name);
}

/**
 * Non-executing PATH lookup. Walks `process.env.PATH` and checks whether a
 * matching executable exists using `fs.accessSync` with `X_OK`.
 *
 * On Windows, also probes `PATHEXT` extensions (`.exe`, `.cmd`, `.bat`, `.com`).
 *
 * This intentionally never spawns the target binary — some CLI tools
 * (Electron-based IDEs, etc.) interpret arguments like `version` as workspace
 * paths, causing unwanted side effects.
 */
function isCommandOnPath(command: string): boolean {
	const pathEnv = process.env.PATH ?? "";
	const dirs = pathEnv.split(delimiter).filter((d) => d.length > 0);

	const isWindows = process.platform === "win32";
	const pathExts = isWindows
		? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
				.split(";")
				.filter((e) => e.length > 0)
		: [];

	for (const dir of dirs) {
		// On POSIX, check for an executable file matching the command name directly.
		// Skip this on Windows where X_OK ≡ R_OK and would false-positive on any
		// readable file; rely solely on the PATHEXT loop instead.
		if (!isWindows && isExecutable(join(dir, command))) {
			return true;
		}

		if (isWindows) {
			for (const ext of pathExts) {
				if (isExecutable(join(dir, command + ext))) {
					return true;
				}
			}
		}
	}

	return false;
}

function isExecutable(filePath: string): boolean {
	try {
		accessSync(filePath, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
