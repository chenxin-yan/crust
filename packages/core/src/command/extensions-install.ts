import type { Extension } from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import type { ExtensionId } from "../identity.ts";
import { cloneFlagSpellings } from "../parsing/spellings.ts";
import { runtimeInputValue } from "../runtime.ts";
import type {
	CommandSection,
	RuntimeCommandSectionInput,
	SectionConsumer,
	FlagDef,
	FlagsDef,
} from "../types.ts";
import type { CommandDefinition } from "./crust.ts";
import { registerFlag, type CommandContext, type CommandNode } from "./node.ts";
import type { CommandSnapshot } from "./snapshot.ts";

export type MaterializeCommandDefinition = (
	definition: CommandDefinition,
	parent: CommandNode,
	extensionName?: string,
	checked?: boolean,
) => CommandNode;

/** Inject an Extension-owned flag into a node and, when recursive, its descendants. */
function injectExtensionFlag(
	node: CommandNode,
	name: string,
	def: FlagDef,
	recursive: boolean,
	checked = false,
): void {
	registerFlag(node, name, def, "owned", checked);
	if (!recursive) return;
	for (const sub of Object.values(node.subCommands)) {
		injectExtensionFlag(sub, name, def, true, checked);
	}
}

/** Attach one Extension's owned root commands to a cloned tree. */
export function applyExtensionCommands(
	root: CommandNode,
	extension: Extension,
	materializeCommandDefinition: MaterializeCommandDefinition,
): void {
	for (const definition of extension.commands ?? []) {
		const node = materializeCommandDefinition(
			definition,
			root,
			extension.id,
			root.checkedExtensions.has(extension.id),
		);
		if (root.checkedExtensions.has(extension.id)) {
			checkExtensionFlagRelations(
				{ ...root, subCommands: { [definition.name]: node } },
				root.extensions,
			);
		}
		root.subCommands[definition.name] = node;
	}
}

/** Inject one Extension's owned flags across a cloned tree. */
export function applyExtensionFlags(
	root: CommandNode,
	extension: Extension,
	checked = false,
): void {
	for (const [name, defWithScope] of Object.entries(extension.flags ?? {})) {
		const { recursive = true, ...def } = defWithScope;
		injectExtensionFlag(root, name, def, recursive, checked);
	}
}

/** Check registered but not yet injected flags without executing future recipes or hooks. */
export function checkExtensionFlagRelations(
	node: CommandNode,
	extensions: readonly Extension[],
): void {
	if (extensions.length === 0) return;
	const copy = cloneCommandNode(node);
	for (const extension of extensions) applyExtensionFlags(copy, extension, true);
}

/** Deep-clone a command subtree without mutating the builder graph. */
export function cloneCommandNode(node: CommandNode): CommandNode {
	const subCommands: Record<string, CommandNode> = {};
	for (const [name, sub] of Object.entries(node.subCommands)) {
		subCommands[name] = cloneCommandNode(sub);
	}

	// Spread first, then override every structural field with a decoupled copy.
	const cloned: CommandNode = {
		...node,
		// Section objects/arrays are never mutated in place (prepare replaces
		// them wholesale), so sharing them here is safe.
		meta: { ...node.meta },
		localFlags: { ...node.localFlags },
		ownedFlags: { ...node.ownedFlags },
		effectiveFlags: { ...node.effectiveFlags },
		flagSpellings: cloneFlagSpellings(node.flagSpellings, node.effectiveFlags),
		args: [...node.args],
		subCommands,
		contexts: node.contexts.map((context) => ({ ...context })),
		demands: [...node.demands],
		extensions: [...node.extensions],
		run: node.run,
	};
	return cloned;
}

/** Who authored the sections being validated; error labels derive from this. */
type SectionOwner = { subject: "command" | "extension"; name: string };

function invalidSections({ subject, name }: SectionOwner): CrustError {
	const label = subject === "command" ? "Command" : "Extension";
	return new CrustError(
		"DEFINITION",
		`${label} "${name}" contains invalid documentation sections`,
		{ subject, name, reason: "invalid-sections" },
	);
}

function normalizeSection(
	section: RuntimeCommandSectionInput,
	owner: SectionOwner,
	checked: boolean,
): CommandSection {
	const { title, body, only, except } = section;
	if (
		checked &&
		(!title.trim() ||
			/[\r\n]/.test(title) ||
			!body.trim() ||
			only?.length === 0 ||
			except?.length === 0)
	) {
		throw invalidSections(owner);
	}
	const audience = (ids: readonly SectionConsumer[]): readonly [ExtensionId, ...ExtensionId[]] => {
		// SAFETY: trusted signatures or checked consumption establish nonemptiness; consumers carry minted IDs.
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
	checked = false,
): CommandSection[] {
	return sections.map((section) =>
		normalizeSection(section, { subject: "command", name }, checked),
	);
}

function contributionTarget(
	root: CommandNode,
	command: readonly string[],
	extension: Extension,
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

export function applyExtensionSections(
	root: CommandNode,
	extension: Extension,
	snapshot: CommandSnapshot,
): void {
	if (!extension.sections) return;
	const owner: SectionOwner = { subject: "extension", name: extension.id };
	const contributions = runtimeInputValue(extension.sections(snapshot));
	for (const contribution of contributions) {
		const section = normalizeSection(contribution, owner, true);
		const target = contributionTarget(root, contribution.command, extension);
		target.meta.sections = [...(target.meta.sections ?? []), section];
	}
}

/** Record only retired canonical keys; value validation remains owned by typed or checked input. */
function retireExtensionFlags(root: CommandNode, removed: Extension, replacement: Extension): void {
	for (const [name, def] of Object.entries(removed.flags ?? {})) {
		const current =
			replacement.flags && Object.hasOwn(replacement.flags, name)
				? replacement.flags[name]
				: undefined;
		const recursive = def.recursive !== false && (!current || current.recursive === false);
		const walk = (node: CommandNode, local: boolean): void => {
			if (local) node.retiredFlagNames = new Set([...node.retiredFlagNames, name]);
			if (!recursive) return;
			node.retiredRecursiveFlagNames = new Set([...node.retiredRecursiveFlagNames, name]);
			for (const child of Object.values(node.subCommands)) walk(child, true);
		};
		walk(root, !current);
	}
	// Already-installed providers are compared per node after pruning/reinstallation below.
	if (root.extensions.includes(removed)) return;
	for (const instance of removed.provides ?? []) {
		const current = replacement.provides?.filter((provider) => provider.name === instance.name);
		const names = Object.keys(instance.ownedFlags).filter(
			(name) => !current?.some((provider) => Object.hasOwn(provider.ownedFlags, name)),
		);
		if (names.length === 0) continue;
		const walk = (node: CommandNode): void => {
			node.retiredFlagNames = new Set([...node.retiredFlagNames, ...names]);
			node.retiredRecursiveFlagNames = new Set([...node.retiredRecursiveFlagNames, ...names]);
			const inherited = new WeakSet(node.contexts.map((context) => context.instance));
			for (const child of Object.values(node.subCommands)) {
				// Match provider installation scope: a more specific Context shadows this provider.
				if (
					child.contexts.some(
						(context) =>
							context.instance.name === instance.name && !inherited.has(context.instance),
					)
				)
					continue;
				walk(child);
			}
		};
		walk(root);
	}
}

export function installExtensionContexts(
	node: CommandNode,
	extensions: readonly Extension[],
	reRegisteredIds: ReadonlySet<Extension["id"]>,
	checked = false,
	replacedExtensions: readonly Extension[] = [],
): CommandNode {
	// Rebuild Extension providers from the deduplicated list so replacing an id
	// cannot leave the earlier registration's eager Context installs behind.
	// Registrations that survive dedup unchanged stay at their original
	// positions: Context resolution is last-write-wins and documentation
	// promises flag definition order, so pruning in place (instead of
	// regrouping locals before Extensions) keeps both observable orders.
	const cloned = cloneCommandNode(node);
	for (const removed of replacedExtensions) {
		// SAFETY: deduplication removes registrations only when a same-ID replacement survives.
		retireExtensionFlags(
			cloned,
			removed,
			extensions.find((entry) => entry.id === removed.id)!,
		);
	}
	// ponytail: O(n²) includes over an already-deduped list, fine for handfuls of extensions.
	const kept = new Set(
		extensions
			.filter((e) => !reRegisteredIds.has(e.id) && node.extensions.includes(e))
			.map((e) => e.id),
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
		for (const child of Object.values(target.subCommands)) prune(child);
	};
	prune(cloned);

	for (const extension of extensions) {
		if (kept.has(extension.id)) continue;
		const instances = extension.provides ?? [];
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
					registerFlag(target, name, def, "owned", checked);
				}
			}
			// A Context provided locally on a descendant is more specific than a
			// root-wide install: skip same-name instances for that subtree.
			const inherited = new WeakSet(target.contexts.map(({ instance }) => instance));
			for (const child of Object.values(target.subCommands)) {
				const childSkip = new Set(skip);
				for (const { instance } of child.contexts) {
					if (!inherited.has(instance)) childSkip.add(instance.name);
				}
				walk(child, childSkip);
			}
		};
		walk(cloned, new Set());
	}
	const retireRemovedProviders = (before: CommandNode, after: CommandNode): void => {
		const names = before.contexts.flatMap(({ instance, extensionId }) =>
			extensionId !== undefined && !kept.has(extensionId)
				? Object.keys(instance.ownedFlags).filter(
						(name) => !Object.hasOwn(after.effectiveFlags, name),
					)
				: [],
		);
		if (names.length > 0) {
			after.retiredFlagNames = new Set([...after.retiredFlagNames, ...names]);
			after.retiredRecursiveFlagNames = new Set([...after.retiredRecursiveFlagNames, ...names]);
		}
		for (const [name, child] of Object.entries(before.subCommands)) {
			// Context installation preserves the existing command tree.
			retireRemovedProviders(child, after.subCommands[name]!);
		}
	};
	if (node.extensions.some((extension) => reRegisteredIds.has(extension.id))) {
		retireRemovedProviders(node, cloned);
	}
	return cloned;
}
