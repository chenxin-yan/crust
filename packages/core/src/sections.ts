import type { CommandSnapshot } from "./command/snapshot.ts";
import { CrustError } from "./errors.ts";
import type { ExtensionId } from "./identity.ts";
import type { CommandSection, RuntimeCommandSectionInput, SectionConsumer } from "./types.ts";

/** Whether a command belongs in user-facing listings. */
export function isListed(command: CommandSnapshot): boolean {
	return command.meta.hidden !== true;
}

/** Select and merge sections visible to the given consumer. */
export function sectionsFor(
	sections: readonly CommandSection[] | undefined,
	consumer: ExtensionId,
): readonly CommandSection[] {
	const visible = (sections ?? []).filter((section) => {
		if (section.only) return section.only.includes(consumer);
		if (section.except) return !section.except.includes(consumer);
		return true;
	});
	const merged = new Map<string, CommandSection>();
	for (const section of visible) {
		const existing = merged.get(section.title);
		merged.set(
			section.title,
			existing ? { title: section.title, body: `${existing.body}\n${section.body}` } : section,
		);
	}
	return [...merged.values()];
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
			if (isListed(child)) visit(child, [...path, name]);
		}
	}
	visit(snapshot, []);
	return groups;
}

/** Who authored the sections being validated; error labels derive from this. */
export type SectionOwner = { subject: "command" | "context" | "extension"; name: string };

const sectionOwnerLabels = { command: "Command", context: "Context", extension: "Extension" };

function invalidSections({ subject, name }: SectionOwner): CrustError {
	const label = sectionOwnerLabels[subject];
	return new CrustError(
		"DEFINITION",
		`${label} "${name}" contains invalid documentation sections`,
		{ subject, name, reason: "invalid-sections" },
	);
}

export function normalizeSection(
	section: RuntimeCommandSectionInput,
	owner: SectionOwner,
): CommandSection {
	const { title, body, only, except } = section;
	if (
		!title.trim() ||
		/[\r\n]/.test(title) ||
		!body.trim() ||
		only?.length === 0 ||
		except?.length === 0 ||
		(only !== undefined && except !== undefined)
	) {
		throw invalidSections(owner);
	}
	const audience = (ids: readonly SectionConsumer[]): readonly [ExtensionId, ...ExtensionId[]] => {
		// SAFETY: normalization establishes nonemptiness; consumers carry minted IDs.
		/* oxlint-disable anti-slop/no-runtime-typeof -- SectionConsumer is a typed minted ID or an object carrying one, not unvalidated data. */
		return Object.freeze(
			ids.map((consumer) => (typeof consumer === "string" ? consumer : consumer.id)),
		) as readonly [ExtensionId, ...ExtensionId[]];
		/* oxlint-enable anti-slop/no-runtime-typeof */
	};
	return Object.freeze({
		title,
		body,
		...(only ? { only: audience(only) } : except ? { except: audience(except) } : {}),
	});
}

export function validateCommandSections(
	name: string,
	sections: readonly RuntimeCommandSectionInput[],
	subject: "command" | "context" = "command",
): CommandSection[] {
	return sections.map((section) => normalizeSection(section, { subject, name }));
}
