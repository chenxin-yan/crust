import type { AgentTarget, SkillKind } from "./types.ts";
import type { InstalledManifestMalformedReason } from "./version.ts";

export class SkillSourceConflictError extends Error {
	override readonly name = "SkillSourceConflictError";
	readonly skillName: string;

	constructor(skillName: string) {
		super(`Skill source name conflict: "${skillName}" is declared more than once.`);
		this.skillName = skillName;
	}
}

export interface SkillKindMismatch {
	existing: SkillKind;
	attempted: SkillKind;
}

export interface SkillManifestMalformed {
	reason: InstalledManifestMalformedReason;
	rawKind?: string;
}

export interface SkillConflictDetails {
	agent: AgentTarget;
	outputDir: string;
	kindMismatch?: SkillKindMismatch;
	manifestMalformed?: SkillManifestMalformed;
}

/** Refuses to overwrite an agent directory that the requested skill does not own. */
export class SkillConflictError extends Error {
	override readonly name = "SkillConflictError";
	readonly details: SkillConflictDetails;

	constructor(details: SkillConflictDetails) {
		super(buildMessage(details));
		this.details = details;
	}
}

function buildMessage(details: SkillConflictDetails): string {
	const prefix = `Skill conflict for agent "${details.agent}": directory "${details.outputDir}"`;
	if (details.kindMismatch) {
		return `${prefix} contains a ${details.kindMismatch.existing} skill, not the requested ${details.kindMismatch.attempted} skill.`;
	}
	if (details.manifestMalformed) {
		return `${prefix} contains an invalid crust.json (${details.manifestMalformed.reason}).`;
	}
	return `${prefix} is not owned by the requested skill.`;
}
