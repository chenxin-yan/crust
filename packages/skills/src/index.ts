// ────────────────────────────────────────────────────────────────────────────
// @crustjs/skills — Agent skill generation from Crust command definitions
// ────────────────────────────────────────────────────────────────────────────

// Agent detection
export { detectInstalledAgents } from "./agents.ts";

// Primitives
export {
	generateSkill,
	resolveSkillName,
	skillStatus,
	uninstallSkill,
} from "./generate.ts";

// Plugin
export { skillPlugin } from "./plugin.ts";

// Types
export type {
	AgentResult,
	AgentTarget,
	GenerateOptions,
	GenerateResult,
	InstallStatus,
	Scope,
	SkillMeta,
	SkillPluginOptions,
	StatusOptions,
	StatusResult,
	UninstallOptions,
	UninstallResult,
	UninstallStatus,
} from "./types.ts";
