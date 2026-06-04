// ────────────────────────────────────────────────────────────────────────────
// Skill errors — typed error classes for @crustjs/skills
// ────────────────────────────────────────────────────────────────────────────

import type { AgentTarget, SkillKind } from "./types.ts";
import type { InstalledManifestMalformedReason } from "./version.ts";

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

/**
 * Describes a malformed `crust.json` discovered at the conflicting skill
 * directory.
 *
 * Set on {@link SkillConflictDetails.manifestMalformed} when the directory
 * contains a `crust.json` that exists but cannot be interpreted — e.g. it is
 * not valid JSON, lacks a `version`, or has an unrecognized `kind` value
 * (a hand-edit typo like `"bundel"`, or a forward-compatible value emitted by
 * a newer Crust release). Distinct from a missing `crust.json`, which keeps
 * the original "not created by Crust" semantics.
 */
export interface SkillManifestMalformed {
	/** Why the manifest could not be interpreted. */
	reason: InstalledManifestMalformedReason;
	/** Raw `kind` value when `reason === "unknown-kind"`. */
	rawKind?: string;
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
	/**
	 * Set when `crust.json` is present at the conflicting directory but cannot
	 * be interpreted (invalid JSON, missing version, unrecognized `kind`,
	 * etc.). Lets the error message distinguish a Crust-owned-but-broken
	 * manifest from a directory that simply was never managed by Crust.
	 */
	manifestMalformed?: SkillManifestMalformed;
}

/**
 * Thrown when an install entrypoint detects that the target skill directory
 * already exists but cannot be overwritten safely.
 *
 * Three flavours:
 * - **No `crust.json`** — directory exists but was not created by Crust.
 *   This prevents Crust from silently overwriting a skill that was manually
 *   created or installed by another tool.
 * - **Malformed `crust.json`** — directory is Crust-owned but its manifest
 *   cannot be interpreted (see {@link SkillConflictDetails.manifestMalformed}).
 * - **Kind mismatch** — directory was created by Crust but with a different
 *   {@link SkillKind} (e.g. an existing `generated` skill collides with an
 *   incoming `bundle` install). `force: true` bypasses all three cases.
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
		super(buildSkillConflictMessage(details));
		this.details = details;
	}
}

function buildSkillConflictMessage(details: SkillConflictDetails): string {
	const prefix = `Skill conflict for agent "${details.agent}": directory "${details.outputDir}"`;

	if (details.kindMismatch) {
		return (
			`${prefix} was installed as a "${details.kindMismatch.existing}" skill but ` +
			`"${details.kindMismatch.attempted}" was attempted. ` +
			`Use force: true to overwrite, or uninstall the existing skill first.`
		);
	}

	if (details.manifestMalformed) {
		const { reason, rawKind } = details.manifestMalformed;
		switch (reason) {
			case "unknown-kind": {
				const raw = rawKind ?? "<unknown>";
				return (
					`${prefix} was created by Crust but its crust.json declares an ` +
					`unrecognized kind "${raw}" — likely a hand-edit typo or a ` +
					`crust.json written by a newer Crust release. Fix the kind ` +
					`field, upgrade Crust, or pass force: true to overwrite.`
				);
			}
			case "parse-error":
				return (
					`${prefix} contains a crust.json that is not valid JSON. ` +
					`Repair the file, or pass force: true to overwrite the directory.`
				);
			case "not-an-object":
				return (
					`${prefix} contains a crust.json whose top-level value is not a JSON object. ` +
					`Repair the file, or pass force: true to overwrite the directory.`
				);
			case "missing-version":
				return (
					`${prefix} contains a crust.json with no "version" string. ` +
					`Repair the file, or pass force: true to overwrite the directory.`
				);
		}
	}

	return (
		`${prefix} already exists but was not created by Crust ` +
		`(no crust.json found). Delete or rename the conflicting skill to resolve.`
	);
}
