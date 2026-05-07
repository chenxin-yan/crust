// ────────────────────────────────────────────────────────────────────────────
// @crustjs/skills — Agent skill generation from Crust command definitions
// ────────────────────────────────────────────────────────────────────────────

// Agent detection
export {
	detectInstalledAgents,
	getAdditionalAgents,
	getUniversalAgents,
	isUniversalAgent,
	resolveCanonicalSkillPath,
} from "./agents.ts";
export type { SkillCommandAnnotations } from "./annotations.ts";
export { annotate } from "./annotations.ts";
// Bundle install
export { installSkillBundle } from "./bundle.ts";
export type { SkillConflictDetails, SkillKindMismatch } from "./errors.ts";
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
	AgentClass,
	AgentResult,
	AgentTarget,
	GenerateOptions,
	GenerateResult,
	InstallSkillBundleOptions,
	InstallSkillBundleResult,
	InstallStatus,
	Scope,
	SkillInstallMode,
	SkillKind,
	SkillMeta,
	SkillPluginOptions,
	StatusOptions,
	StatusResult,
	UninstallOptions,
	UninstallResult,
	UninstallStatus,
} from "./types.ts";
