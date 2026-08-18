import type { ExtensionId } from "./identity.ts";
import type { CommandSection } from "./types.ts";

export function isText(value: unknown): value is string {
	return typeof value === "string" && !!value.trim();
}

/** Select sections visible to the given consumer. */
export function sectionsFor(
	sections: readonly CommandSection[] | undefined,
	consumer: ExtensionId,
): readonly CommandSection[] {
	return (sections ?? []).filter((section) => {
		if (section.only) return section.only.includes(consumer);
		if (section.except) return !section.except.includes(consumer);
		return true;
	});
}
