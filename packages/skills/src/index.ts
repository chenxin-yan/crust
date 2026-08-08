// ────────────────────────────────────────────────────────────────────────────
// @crustjs/skills — Agent skill generation from Crust command definitions
// ────────────────────────────────────────────────────────────────────────────

import type { Extension } from "@crustjs/core";

import { skillExtension } from "./plugin.ts";
import type { SkillOptions } from "./types.ts";

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
export type { SkillConflictDetails, SkillKindMismatch, SkillManifestMalformed } from "./errors.ts";
// Errors
export { SkillConflictError } from "./errors.ts";

// Primitives
export { generateSkill, isValidSkillName, getSkillStatus, uninstallSkill } from "./generate.ts";

// Extension
export function skill(options: SkillOptions): Extension {
	return skillExtension(options);
}

// Types
export type {
	AgentClass,
	AgentResult,
	AgentTarget,
	CustomSkillConfig,
	GenerateSkillOptions,
	GenerateSkillResult,
	InstallSkillBundleOptions,
	InstallSkillBundleResult,
	InstallStatus,
	Scope,
	SkillInstallMode,
	SkillKind,
	SkillMeta,
	SkillOptions,
	SkillStatusOptions,
	SkillStatusResult,
	UninstallSkillOptions,
	UninstallSkillResult,
	UninstallStatus,
} from "./types.ts";
