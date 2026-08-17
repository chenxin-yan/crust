import type { CommandSection, SectionConsumer } from "./types.ts";

export function isText(value: unknown): value is string {
	return typeof value === "string" && !!value.trim();
}

/** Define a token for a command-section renderer. */
export function defineSectionConsumer(id: string): SectionConsumer {
	if (!isText(id)) throw new Error("Section consumer requires a non-empty id.");
	return Object.freeze({ id }) as SectionConsumer;
}

/** Select sections visible to any of the requested consumers. */
export function sectionsFor(
	sections: readonly CommandSection[] | undefined,
	...consumers: readonly [SectionConsumer, ...SectionConsumer[]]
): readonly CommandSection[] {
	return (sections ?? []).filter((section) => {
		const { only, except } = section;
		if (only) {
			return consumers.some((consumer) => only.some(({ id }) => id === consumer.id));
		}
		if (except) {
			return consumers.some((consumer) => !except.some(({ id }) => id === consumer.id));
		}
		return true;
	});
}
