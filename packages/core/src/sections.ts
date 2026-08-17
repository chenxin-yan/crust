import type { CommandSection, SectionConsumer } from "./types.ts";

/** Define a token for a command-section renderer. */
export function defineSectionConsumer(id: string): SectionConsumer {
	return Object.freeze({ id }) as SectionConsumer;
}

/** Select sections visible to any of the requested consumers. */
export function sectionsFor(
	sections: readonly CommandSection[] | undefined,
	...consumers: readonly [SectionConsumer, ...SectionConsumer[]]
): readonly CommandSection[] {
	return (sections ?? []).filter((section) => {
		if (section.only) {
			return consumers.some((consumer) => section.only?.some(({ id }) => id === consumer.id));
		}
		if (section.except) {
			return consumers.some((consumer) => !section.except?.some(({ id }) => id === consumer.id));
		}
		return true;
	});
}
