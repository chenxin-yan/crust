// ────────────────────────────────────────────────────────────────────────────
// @crustjs/skills — Agent skill generation from Crust command definitions
// ────────────────────────────────────────────────────────────────────────────

// Primitives
export { generateSkill, skillStatus, uninstallSkill } from "./generate.ts";

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
