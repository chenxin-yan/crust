import type { CommandSnapshot } from "./command/snapshot.ts";
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

/** Collect section-bearing visible commands in canonical path order. The root path is `[]`. */
export function visibleSectionsFor(
	snapshot: CommandSnapshot,
	consumer: ExtensionId,
): readonly {
	readonly path: readonly string[];
	readonly sections: readonly CommandSection[];
}[] {
	const groups: { path: readonly string[]; sections: readonly CommandSection[] }[] = [];
	function visit(command: CommandSnapshot, path: readonly string[]): void {
		const sections = sectionsFor(command.meta.sections, consumer);
		if (sections.length > 0) groups.push({ path, sections });
		for (const [name, child] of Object.entries(command.subCommands).sort(([a], [b]) =>
			a.localeCompare(b),
		)) {
			if (child.meta.hidden !== true) visit(child, [...path, name]);
		}
	}
	visit(snapshot, []);
	return groups;
}
