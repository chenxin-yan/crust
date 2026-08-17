import type { CommandSection, SectionConsumer } from "./types.ts";

export function isText(value: unknown): value is string {
	return typeof value === "string" && !!value.trim();
}

/** Select sections visible to the given consumer. */
export function sectionsFor(
	sections: readonly CommandSection[] | undefined,
	consumer: SectionConsumer,
): readonly CommandSection[] {
	return (sections ?? []).filter((section) => {
		if (section.only) return section.only.includes(consumer);
		if (section.except) return !section.except.includes(consumer);
		return true;
	});
}
