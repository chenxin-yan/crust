// ────────────────────────────────────────────────────────────────────────────
// Skill errors — typed error classes for @crustjs/skills
// ────────────────────────────────────────────────────────────────────────────

import type { AgentTarget, SkillKind } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// SkillConflictError
// ────────────────────────────────────────────────────────────────────────────

/**
 * Describes a kind mismatch between an existing installed bundle and an
 * incoming install attempt.
 *
 * Set on {@link SkillConflictDetails.kindMismatch} when {@link generateSkill}
 * or {@link installSkillBundle} discovers an existing `crust.json` whose
 * `kind` differs from the kind being installed (e.g. a generated skill
 * already lives at the target path and a bundle install was attempted).
 */
export interface SkillKindMismatch {
	/** Kind recorded in the existing `crust.json` */
	existing: SkillKind;
	/** Kind requested by the current install attempt */
	attempted: SkillKind;
}

/** Details about the conflict between an existing skill and an incoming one. */
export interface SkillConflictDetails {
	/** The agent where the conflict was detected */
	agent: AgentTarget;
	/** Absolute path to the conflicting skill directory */
	outputDir: string;
	/**
	 * Set when the conflict is a `kind` mismatch (existing `crust.json`
	 * reports a different `kind` than the one being installed).
	 *
	 * Absent for "no-crust.json" conflicts (the original case).
	 */
	kindMismatch?: SkillKindMismatch;
}

/**
 * Thrown when an install entrypoint detects that the target skill directory
 * already exists but cannot be overwritten safely.
 *
 * Two flavours:
 * - **No `crust.json`** — directory exists but was not created by Crust.
 *   This prevents Crust from silently overwriting a skill that was manually
 *   created or installed by another tool.
 * - **Kind mismatch** — directory was created by Crust but with a different
 *   {@link SkillKind} (e.g. an existing `generated` skill collides with an
 *   incoming `bundle` install). `force: true` bypasses both cases.
 *
 * @example
 * ```ts
 * import { generateSkill, SkillConflictError } from "@crustjs/skills";
 *
 * try {
 *   await generateSkill({ command, meta, agents });
 * } catch (err) {
 *   if (err instanceof SkillConflictError) {
 *     if (err.details.kindMismatch) {
 *       console.error(
 *         `Cannot install ${err.details.kindMismatch.attempted} skill — ` +
 *           `${err.details.kindMismatch.existing} skill already at "${err.details.outputDir}".`,
 *       );
 *     } else {
 *       console.error(
 *         `Conflict: "${err.details.outputDir}" already exists and was not created by Crust.`,
 *       );
 *     }
 *   }
 * }
 * ```
 */
export class SkillConflictError extends Error {
	override readonly name = "SkillConflictError";
	readonly details: SkillConflictDetails;

	constructor(details: SkillConflictDetails) {
		const message = details.kindMismatch
			? `Skill conflict for agent "${details.agent}": ` +
				`directory "${details.outputDir}" was installed as a ` +
				`"${details.kindMismatch.existing}" skill but ` +
				`"${details.kindMismatch.attempted}" was attempted. ` +
				`Use force: true to overwrite, or uninstall the existing skill first.`
			: `Skill conflict for agent "${details.agent}": ` +
				`directory "${details.outputDir}" already exists but was not created by Crust ` +
				`(no crust.json found). Delete or rename the conflicting skill to resolve.`;

		super(message);
		this.details = details;
	}
}
