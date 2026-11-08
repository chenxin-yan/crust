import type { AnyContextInstance } from "../api/context.ts";
import type { ExtensionData } from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import type { ExtensionId } from "../identity.ts";
import { normalizeSection, type SectionOwner } from "../sections.ts";
import type { CommandDefinition } from "./crust.ts";
import { registerFlag, type CommandContext, type CommandNode } from "./node.ts";
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

/**
 * Context instances whose sections document `node`: its own providers. The
 * prepared root's Contexts are exactly its own and the Extensions' providers, in
 * resolution order, so the provider that wins a name also supplies its sections.
 */
export function sectionContextsFor(
	node: CommandNode,
	isRoot: boolean,
): readonly AnyContextInstance[] {
	return isRoot ? node.contexts.map(({ instance }) => instance) : node.providedContexts;
}

/** An Extension-provided Context and its Extension's `extensionPositions` entry. */
export interface ExtensionProvider {
	readonly instance: AnyContextInstance;
	readonly position: number;
	readonly extension: ExtensionId;
}

/**
 * A copy of `parent`, the root or its `.add()`-time state, with Extension
 * providers installed. Context resolution is last-write-wins, as the types infer:
 * each provider follows the root Contexts provided before its Extension's last
 * `.extend()` and precedes later ones, so a command's own `.provide()` always wins.
 * Their owned flags precede the parent's flags.
 */
export function installExtensionProviders(
	parent: CommandNode,
	providers: readonly ExtensionProvider[],
): CommandNode {
	if (providers.length === 0) return parent;
	// Root Contexts only append, so `parent`'s are a prefix of the final root's, and
	// positions never decrease along the final Extension list.
	const contexts: CommandContext[] = [];
	let next = 0;
	for (const { instance, position, extension } of providers) {
		while (next < position && next < parent.contexts.length) {
			contexts.push({ ...parent.contexts[next++]! });
		}
		contexts.push({ instance, extension });
	}
	for (const context of parent.contexts.slice(next)) contexts.push({ ...context });
	// Accumulated per name: a same-name parent provider's flags stay installed beside these.
	const flagContexts = new Map<string, readonly string[]>();
	for (const [name, flags] of [
		...providers.map(({ instance }) => [instance.name, Object.keys(instance.ownedFlags)] as const),
		...parent.flagContexts,
	]) {
		flagContexts.set(name, [...(flagContexts.get(name) ?? []), ...flags]);
	}
	const node: CommandNode = {
		...parent,
		localFlags: {},
		ownedFlags: {},
		flagContexts,
		effectiveFlags: {},
		flagSpellings: new Map(),
		contexts,
	};
	for (const { instance } of providers) {
		for (const [name, def] of Object.entries(instance.ownedFlags)) {
			registerFlag(node, name, def, "owned");
		}
	}
	for (const [name, def] of Object.entries(parent.effectiveFlags)) {
		registerFlag(node, name, def, Object.hasOwn(parent.localFlags, name) ? "local" : "owned");
	}
	return node;
}
