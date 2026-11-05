import type { AnyContextInstance } from "../api/context.ts";
import type { ExtensionData } from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import type { ExtensionId } from "../identity.ts";
import { normalizeSection, type SectionOwner } from "../sections.ts";
import type { FlagsDef } from "../types.ts";
import type { CommandDefinition } from "./crust.ts";
import {
	childEntriesOf,
	cloneCommandNode,
	lazyChildRecord,
	registerFlag,
	type CommandContext,
	type CommandNode,
} from "./node.ts";
import { contributeSection, createSnapshotProjector } from "./snapshot.ts";

export type MaterializeCommandDefinition = (
	definition: CommandDefinition,
	parent: CommandNode,
	extensionId?: ExtensionId,
) => CommandNode;

function contributionTarget(
	root: CommandNode,
	command: readonly string[],
	extension: ExtensionData,
): CommandNode {
	let target = root;
	for (const segment of command) {
		// hasOwn: plain-object lookup would resolve inherited keys like "constructor"
		const next = Object.hasOwn(target.subCommands, segment)
			? target.subCommands[segment]
			: undefined;
		if (!next) {
			throw new CrustError(
				"DEFINITION",
				`Extension "${extension.id}" section target "${command.join(" ")}" is not a canonical command path`,
				{
					subject: "extension",
					name: extension.id,
					reason: "invalid-section-path",
				},
			);
		}
		target = next;
	}
	return target;
}

/**
 * Evaluate Extension section callbacks and record their contributions beside the
 * target nodes. Callbacks share one lazily projected authored snapshot, so each
 * builds only the commands it reads and none sees Extension sections.
 */
export function applyExtensionSections(
	root: CommandNode,
	extensions: readonly ExtensionData[],
): void {
	if (!extensions.some((extension) => extension.sections !== undefined)) return;
	const authored = createSnapshotProjector(root, true)(root);
	for (const extension of extensions) {
		if (!extension.sections) continue;
		const owner: SectionOwner = { subject: "extension", name: extension.id };
		for (const contribution of extension.sections(authored)) {
			const section = normalizeSection(contribution, owner);
			contributeSection(contributionTarget(root, contribution.command, extension), section);
		}
	}
}

/** Merge the effective provided Contexts' sections into one node's documentation. */
export function applyNodeContextSections(
	node: CommandNode,
	path: string,
	instances: readonly AnyContextInstance[],
): void {
	// Match Context resolution: the last provider for a name replaces earlier ones.
	const effective = [...new Map(instances.map((instance) => [instance.name, instance])).values()];
	if (!effective.some((instance) => instance.sections.length > 0)) return;
	const titles = new Set((node.meta.sections ?? []).map(({ title }) => title));
	for (const instance of effective) {
		for (const { title } of instance.sections) {
			if (titles.has(title)) {
				throw new CrustError(
					"DEFINITION",
					`Context "${instance.name}" section "${title}" duplicates a section on command "${path}"`,
					{ subject: "context", name: instance.name, reason: "duplicate-section" },
				);
			}
		}
		// One Context may repeat its own titles, like a command's static sections.
		for (const { title } of instance.sections) titles.add(title);
	}
	node.meta.sections = [
		...(node.meta.sections ?? []),
		...effective.flatMap((instance) => instance.sections),
	];
}

/** Context instances whose sections document `node`: its own providers, plus Extension providers at the root. */
export function sectionContextsFor(
	node: CommandNode,
	extensions: readonly ExtensionData[] | undefined,
): readonly AnyContextInstance[] {
	return extensions === undefined
		? node.providedContexts
		: [...node.providedContexts, ...extensions.flatMap((extension) => extension.provide)];
}

export function installExtensionContexts(
	node: CommandNode,
	extensions: readonly ExtensionData[],
	reRegisteredIds: ReadonlySet<ExtensionData["id"]>,
): CommandNode {
	// Rebuild Extension providers from the deduplicated list so replacing an id
	// cannot leave the earlier registration's eager Context installs behind.
	// Registrations that survive dedup unchanged stay at their original
	// positions: Context resolution is last-write-wins and documentation
	// promises flag definition order, so pruning in place (instead of
	// regrouping locals before Extensions) keeps both observable orders.
	const cloned = cloneCommandNode(node);
	const kept = new Set(
		extensions.flatMap((e) =>
			!reRegisteredIds.has(e.id) && node.extensions.includes(e) ? [e.id] : [],
		),
	);
	const prune = (target: CommandNode): void => {
		target.contexts = target.contexts.filter(
			(context) => context.extensionId === undefined || kept.has(context.extensionId),
		);
		const effectiveNames = Object.keys(target.effectiveFlags);
		const localFlags = target.localFlags;
		const ownedFlags: FlagsDef = {};
		for (const { instance } of target.contexts) Object.assign(ownedFlags, instance.ownedFlags);
		target.localFlags = {};
		target.ownedFlags = {};
		target.effectiveFlags = {};
		target.flagSpellings = new Map();
		for (const name of effectiveNames) {
			const source = Object.hasOwn(ownedFlags, name) ? "owned" : "local";
			const flags = source === "owned" ? ownedFlags : localFlags;
			if (Object.hasOwn(flags, name)) registerFlag(target, name, flags[name]!, source);
		}
		target.subCommands = lazyChildRecord(childEntriesOf(target), (entry) => {
			const child = entry.resolve();
			prune(child);
			return child;
		});
	};
	prune(cloned);

	for (const extension of extensions) {
		if (kept.has(extension.id)) continue;
		const instances = extension.provide;
		if (instances.length === 0) continue;
		const walk = (target: CommandNode, skip: ReadonlySet<string>): void => {
			const installed = instances.filter((instance) => !skip.has(instance.name));
			const registrations: CommandContext[] = installed.map((instance) => ({
				instance,
				extensionId: extension.id,
			}));
			target.contexts.push(...registrations);
			for (const instance of installed) {
				for (const [name, def] of Object.entries(instance.ownedFlags)) {
					registerFlag(target, name, def, "owned");
				}
			}
			// A Context provided locally on a descendant is more specific than a
			// root-wide install: skip same-name instances for that subtree.
			const inherited = new WeakSet(target.contexts.map(({ instance }) => instance));
			target.subCommands = lazyChildRecord(childEntriesOf(target), (entry) => {
				const child = entry.resolve();
				const childSkip = new Set(skip);
				for (const { instance } of child.contexts) {
					if (!inherited.has(instance)) childSkip.add(instance.name);
				}
				walk(child, childSkip);
				return child;
			});
		};
		walk(cloned, new Set());
	}
	return cloned;
}
