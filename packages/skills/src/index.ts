// ────────────────────────────────────────────────────────────────────────────
// @crustjs/skills — Agent skill generation from Crust command definitions
// ────────────────────────────────────────────────────────────────────────────

export { writeSkills, writeSkillsFromSnapshot } from "./build.ts";
export type { WriteSkillsOptions } from "./build.ts";
export {
	detectInstalledAgents,
	getAdditionalAgents,
	getUniversalAgents,
	isUniversalAgent,
} from "./agents.ts";
export { SkillConflictError, SkillSourceConflictError } from "./errors.ts";
export { skill } from "./extension.ts";
export { getSkillStatus, installSkill, uninstallSkill } from "./generate.ts";
export { isValidSkillName } from "./skill-name.ts";
export { loadPackagedSkills, resolveSkillSource, SkillSourceUnavailableError } from "./source.ts";
export type { PackagedSkill } from "./source.ts";

export type {
	AgentClass,
	AgentResult,
	AgentTarget,
	InstallSkillOptions,
	InstallSkillResult,
	InstallStatus,
	Scope,
	SkillLinkStatus,
	SkillOptions,
	SkillStatusOptions,
	SkillStatusResult,
	UninstallSkillOptions,
	UninstallSkillResult,
	UninstallStatus,
} from "./types.ts";
