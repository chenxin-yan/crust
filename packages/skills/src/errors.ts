import type { AgentTarget } from "./types.ts";

export class SkillSourceConflictError extends Error {
	override readonly name = "SkillSourceConflictError";
	readonly skillName: string;

	constructor(skillName: string) {
		super(`Skill source name conflict: "${skillName}" is declared more than once.`);
		this.skillName = skillName;
	}
}

export interface SkillConflictDetails {
	agent: AgentTarget;
	outputDir: string;
}

/** Refuses to overwrite an agent entry that is not owned by the requested skill. */
export class SkillConflictError extends Error {
	override readonly name = "SkillConflictError";
	readonly details: SkillConflictDetails;

	constructor(details: SkillConflictDetails) {
		super(
			`Skill conflict for agent "${details.agent}": entry "${details.outputDir}" is not owned by the requested skill.`,
		);
		this.details = details;
	}
}
