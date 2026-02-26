// ────────────────────────────────────────────────────────────────────────────
// Skill errors — typed error classes for @crustjs/skills
// ────────────────────────────────────────────────────────────────────────────

import type { AgentTarget } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// SkillConflictError
// ────────────────────────────────────────────────────────────────────────────

/** Details about the conflict between an existing skill and an incoming one. */
export interface SkillConflictDetails {
	/** The agent where the conflict was detected */
	agent: AgentTarget;
	/** Absolute path to the conflicting skill directory */
	outputDir: string;
}

/**
 * Thrown when `generateSkill()` detects that the target skill directory
 * already exists but was not created by Crust (i.e. has no `crust.json`).
 *
 * This prevents Crust from silently overwriting a skill that was manually
 * created or installed by another tool.
 *
 * @example
 * ```ts
 * import { generateSkill, SkillConflictError } from "@crustjs/skills";
 *
 * try {
 *   await generateSkill({ command, meta, agents });
 * } catch (err) {
 *   if (err instanceof SkillConflictError) {
 *     console.error(
 *       `Conflict: "${err.details.outputDir}" already exists and was not created by Crust.`,
 *     );
 *   }
 * }
 * ```
 */
export class SkillConflictError extends Error {
	override readonly name = "SkillConflictError";
	readonly details: SkillConflictDetails;

	constructor(details: SkillConflictDetails) {
		const message =
			`Skill conflict for agent "${details.agent}": ` +
			`directory "${details.outputDir}" already exists but was not created by Crust ` +
			`(no crust.json found). Delete or rename the conflicting skill to resolve.`;

		super(message);
		this.details = details;
	}
}
