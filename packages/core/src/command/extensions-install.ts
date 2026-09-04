import type { Extension } from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import { defineExtensionId, type ExtensionId } from "../identity.ts";
import type { CommandSection, CommandSectionInput, FlagDef, FlagsDef } from "../types.ts";
import type { CommandDefinition } from "./crust.ts";
import { registerFlag, type CommandContext, type CommandNode } from "./node.ts";
import type { CommandSnapshot } from "./snapshot.ts";

export type MaterializeCommandDefinition = (
	definition: CommandDefinition,
	parent: CommandNode,
	extensionName?: string,
) => CommandNode;

/** Inject an Extension-owned flag into a node and, when recursive, its descendants. */
function injectExtensionFlag(
	node: CommandNode,
	name: string,
	def: FlagDef,
	recursive: boolean,
): void {
	registerFlag(node, name, def, "owned");
	if (!recursive) return;
	for (const sub of Object.values(node.subCommands)) {
		injectExtensionFlag(sub, name, def, true);
	}
}

/** Attach one Extension's owned root commands to a cloned tree. */
export function applyExtensionCommands(
	root: CommandNode,
	extension: Extension,
	materializeCommandDefinition: MaterializeCommandDefinition,
): void {
	for (const definition of extension.commands ?? []) {
		const node = materializeCommandDefinition(definition, root, extension.id);
		root.subCommands[definition.name] = node;
	}
}

/** Inject one Extension's owned flags across a cloned tree. */
export function applyExtensionFlags(root: CommandNode, extension: Extension): void {
	for (const [name, defWithScope] of Object.entries(extension.flags ?? {})) {
		const { recursive = true, ...def } = defWithScope;
		injectExtensionFlag(root, name, def, recursive);
	}
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
		localFlags: {},
		ownedFlags: {},
		effectiveFlags: {},
		flagSpellings: new Map(),
		args: node.args.map((def) => ({ ...def })),
		subCommands,
		contexts: node.contexts.map((context) => ({ ...context })),
		extensions: [...node.extensions],
		run: node.run,
	};
	for (const [name, def] of Object.entries(node.effectiveFlags)) {
		const source = Object.hasOwn(node.localFlags, name) ? "local" : "owned";
		registerFlag(
			cloned,
			name,
			{ ...def, aliases: def.aliases ? [...def.aliases] : undefined },
			source,
		);
	}
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

function hasId<T>(value: T): value is T & { readonly id?: unknown } {
	return (
		((typeof value === "object" && value !== null) || typeof value === "function") && "id" in value
	);
}

function isString<T>(value: T): value is T & string {
	return typeof value === "string";
}

function isText<T>(value: T): value is T & string {
	return typeof value === "string" && !!value.trim();
}

function parseExtensionId(consumer: unknown, owner: SectionOwner): ExtensionId {
	const id = isString(consumer) ? consumer : hasId(consumer) ? consumer.id : undefined;
	if (!isText(id) || id !== id.trim()) throw invalidSections(owner);
	return defineExtensionId(id);
}

function validateSectionAudienceIds(ids: unknown, owner: SectionOwner): readonly ExtensionId[] {
	if (!Array.isArray(ids) || ids.length === 0) throw invalidSections(owner);
	return Object.freeze(ids.map((consumer) => parseExtensionId(consumer, owner)));
}

function validateSection(section: unknown, owner: SectionOwner): CommandSection {
	// SAFETY: optional-field probe of an unvalidated section; every field is checked below.
	const { title, body, only, except } = (section ?? {}) as {
		title?: unknown;
		body?: unknown;
		only?: unknown;
		except?: unknown;
	};
	if (!isText(title) || /[\r\n]/.test(title) || !isText(body)) {
		throw invalidSections(owner);
	}
	// The SectionAudience union owns literals; this runtime branch owns the
	// dynamic path (Extension `sections` callbacks, config-built objects), where
	// both fields would otherwise freeze and `sectionsFor()` would silently
	// ignore `except`.
	if (only !== undefined && except !== undefined) {
		throw invalidSections(owner);
	}
	if (only !== undefined) {
		return Object.freeze({ title, body, only: validateSectionAudienceIds(only, owner) });
	}
	if (except !== undefined) {
		return Object.freeze({ title, body, except: validateSectionAudienceIds(except, owner) });
	}
	return Object.freeze({ title, body });
}

export function validateCommandSections(
	name: string,
	sections: readonly CommandSectionInput[],
): CommandSection[] {
	const owner: SectionOwner = { subject: "command", name };
	if (!Array.isArray(sections)) throw invalidSections(owner);
	return sections.map((section) => validateSection(section, owner));
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
	const contributions = extension.sections(snapshot);
	if (!Array.isArray(contributions)) throw invalidSections(owner);
	for (const contribution of contributions) {
		// validateSection rejects null/non-object contributions, so reading
		// `.command` afterwards is safe.
		const section = validateSection(contribution, owner);
		if (!Array.isArray(contribution.command) || !contribution.command.every(isString)) {
			throw invalidSections(owner);
		}
		const target = contributionTarget(root, contribution.command, extension);
		target.meta.sections = [...(target.meta.sections ?? []), section];
	}
}

export function installExtensionContexts(
	node: CommandNode,
	extensions: readonly Extension[],
	reRegisteredIds: ReadonlySet<Extension["id"]>,
): CommandNode {
	// Rebuild Extension providers from the deduplicated list so replacing an id
	// cannot leave the earlier registration's eager Context installs behind.
	// Registrations that survive dedup unchanged stay at their original
	// positions: Context resolution is last-write-wins and documentation
	// promises flag definition order, so pruning in place (instead of
	// regrouping locals before Extensions) keeps both observable orders.
	const cloned = cloneCommandNode(node);
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
					registerFlag(target, name, def, "owned");
				}
			}
			// A Context provided locally on a descendant is more specific than a
			// root-wide install: skip same-name instances for that subtree.
			const inherited = new WeakSet(target.contexts);
			for (const child of Object.values(target.subCommands)) {
				const childSkip = new Set(skip);
				for (const context of child.contexts) {
					if (!inherited.has(context)) childSkip.add(context.instance.name);
				}
				walk(child, childSkip);
			}
		};
		walk(cloned, new Set());
	}
	return cloned;
}
