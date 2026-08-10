// Dependency-free so callers can validate names without pulling in the
// filesystem-heavy generate module.

/**
 * Agent Skills spec name pattern: 1–64 lowercase alphanumeric characters and
 * hyphens. Must not start or end with `-`, and must not contain consecutive `--`.
 */
export const SKILL_NAME_PATTERN: RegExp = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Validates a resolved skill name against the Agent Skills specification.
 *
 * @param name - The resolved skill name to validate
 * @returns `true` if valid, `false` otherwise
 */
export function isValidSkillName(name: string): boolean {
	return name.length >= 1 && name.length <= 64 && SKILL_NAME_PATTERN.test(name);
}
