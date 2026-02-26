// ────────────────────────────────────────────────────────────────────────────
// @crustjs/skills — Agent skill generation from Crust command definitions
// ────────────────────────────────────────────────────────────────────────────

// Agent detection
export { detectInstalledAgents } from "./agents.ts";
export type { SkillConflictDetails } from "./errors.ts";
// Errors
export { SkillConflictError } from "./errors.ts";

// Primitives
export {
	generateSkill,
	isValidSkillName,
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
