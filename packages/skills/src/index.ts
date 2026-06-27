// ────────────────────────────────────────────────────────────────────────────
// @crustjs/skills — Agent skill generation from Crust command definitions
// ────────────────────────────────────────────────────────────────────────────

import type { Extension } from "@crustjs/core";
import { extensionFromPlugin } from "@crustjs/core/internal";

import { skillPlugin } from "./plugin.ts";
import type { SkillPluginOptions } from "./types.ts";

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
export {
	generateSkill,
	isValidSkillName,
	resolveSkillName,
	skillStatus,
	uninstallSkill,
} from "./generate.ts";

// Extension
export function skill(options: SkillPluginOptions): Extension {
	return extensionFromPlugin(skillPlugin(options)) as unknown as Extension;
}

// Types
export type {
	AgentClass,
	AgentResult,
	AgentTarget,
	CustomSkillConfig,
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
