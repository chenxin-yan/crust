import { writeFile } from "node:fs/promises";

import { withAmbientTerminalIO } from "@crustjs/utils/terminal";

import { createContextResolver, DisposalStack } from "../api/context.ts";
import {
	finishInvocation,
	type Extension,
	type ExtensionContext,
	type ExtensionSectionContribution,
	type InvocationOutcome,
} from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import { defineExtensionId, type ExtensionId } from "../identity.ts";
import { parseArgs, validateParsed } from "../parsing/parser.ts";
import { applySchemas } from "../parsing/schema.ts";
import { addFlagSpellingEntries, cloneFlagSpellings } from "../parsing/spellings.ts";
import { isText } from "../sections.ts";
import type { CommandSection, FlagDef, FlagsDef, InvocationIO } from "../types.ts";
import type { CommandDefinition } from "./crust.ts";
import type { CommandNode } from "./node.ts";
import { resolveCommand } from "./router.ts";
import { type CommandSnapshot, snapshotCommand } from "./snapshot.ts";

/** Terminal defaults: line-oriented writes to the process streams. */
const DEFAULT_IO: InvocationIO = {
	stdout: (text) => console.log(text),
	stderr: (text) => console.error(text),
};

/** One cloned, extension-applied, frozen command tree. */
interface PreparedInvocation {
	rootNode: CommandNode;
	extensions: readonly Extension[];
}

type MaterializeCommandDefinition = (
	definition: CommandDefinition,
	parent: CommandNode,
	extensionName?: string,
) => CommandNode;

/**
 * Snapshot subprocess protocol used by first-party build tooling.
 *
 * When set to a non-empty file path, `.execute()` prepares the command tree,
 * validates its documentation sections, optionally runs Extension build hooks when the
 * build output directory is set, writes its final JSON snapshot, and exits without dispatching
 * a Command Action. In-process callers use `Crust.snapshot()`.
 */
export const SNAPSHOT_PATH_ENV = "CRUST_INTERNAL_SNAPSHOT_PATH";
export const BUILD_OUT_DIR_ENV = "CRUST_INTERNAL_BUILD_OUT_DIR";
const EXIT_CODE_CANCELLED = 130;

function isAbortError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return error.name === "AbortError";
}

/** Inject an Extension-owned flag into a node and, when recursive, its descendants. */
function injectExtensionFlag(
	node: CommandNode,
	name: string,
	def: FlagDef,
	recursive: boolean,
): void {
	// ValidateExtensionFlags owns literal collisions at .extend()/.add(); this
	// owns dynamic Extensions, where a silent overwrite retypes the owning
	// command's (or another Extension's) flag at parse time.
	if (Object.hasOwn(node.effectiveFlags, name)) {
		throw new CrustError(
			"DEFINITION",
			`Extension flag "${name}" collides with a flag already defined on command "${node.meta.name}"`,
			{ subject: "extension", name, reason: "flag-collision" },
		);
	}
	// The canonical name is checked against the spelling table too: an existing
	// flag's *alias* equal to the incoming canonical would otherwise be silently
	// stolen (effectiveFlags only has canonical keys).
	for (const spelling of [name, def.short, ...(def.aliases ?? [])]) {
		const existing = spelling === undefined ? undefined : node.flagSpellings.get(spelling);
		if (existing !== undefined && existing.canonicalName !== name) {
			throw new CrustError(
				"DEFINITION",
				`Extension flag spelling "${spelling}" collides with existing flag "${existing.canonicalName}" on command "${node.meta.name}"`,
				{ subject: "extension", name, reason: "flag-collision" },
			);
		}
	}
	node.effectiveFlags[name] = def;
	addFlagSpellingEntries(node.flagSpellings, name, def);
	if (!recursive) return;
	for (const sub of Object.values(node.subCommands)) {
		injectExtensionFlag(sub, name, def, true);
	}
}

/** Attach one Extension's owned root commands to a cloned tree. */
function applyExtensionCommands(
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
function applyExtensionFlags(root: CommandNode, extension: Extension): void {
	for (const [name, defWithScope] of Object.entries(extension.flags ?? {})) {
		const { recursive = true, ...def } = defWithScope;
		injectExtensionFlag(root, name, def as FlagDef, recursive);
	}
}

function cloneFlags(flags: FlagsDef): FlagsDef {
	const out: FlagsDef = {};
	for (const [key, def] of Object.entries(flags)) {
		out[key] = {
			...def,
			aliases: def.aliases ? [...def.aliases] : undefined,
		};
	}
	return out;
}

/** Deep-clone a command subtree without mutating the builder graph. */
export function cloneCommandNode(node: CommandNode): CommandNode {
	const subCommands: Record<string, CommandNode> = {};
	for (const [name, sub] of Object.entries(node.subCommands)) {
		subCommands[name] = cloneCommandNode(sub);
	}

	const effectiveFlags = cloneFlags(node.effectiveFlags);
	// Spread first, then override every structural field with a decoupled copy.
	return {
		...node,
		// Section objects/arrays are never mutated in place (prepare replaces
		// them wholesale), so sharing them here is safe.
		meta: { ...node.meta },
		localFlags: cloneFlags(node.localFlags),
		ownedFlags: cloneFlags(node.ownedFlags),
		effectiveFlags,
		flagSpellings: cloneFlagSpellings(node.flagSpellings, effectiveFlags),
		args: node.args ? node.args.map((def) => ({ ...def })) : undefined,
		subCommands,
		contexts: [...node.contexts],
		extensions: [...node.extensions],
		run: node.run,
	};
}

function freezeTree(node: CommandNode): void {
	Object.freeze(node);
	Object.freeze(node.localFlags);
	Object.freeze(node.ownedFlags);
	Object.freeze(node.effectiveFlags);
	// Section objects are already frozen by validateSection.
	if (node.meta.sections) Object.freeze(node.meta.sections);
	Object.freeze(node.meta);
	Object.freeze(node.contexts);
	Object.freeze(node.extensions);
	if (node.args) Object.freeze(node.args);
	for (const sub of Object.values(node.subCommands)) freezeTree(sub);
	Object.freeze(node.subCommands);
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

function validateSectionAudienceIds(ids: unknown, owner: SectionOwner): readonly ExtensionId[] {
	if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isText)) {
		throw invalidSections(owner);
	}
	// defineExtensionId is the single identity boundary; it rejects untrimmed ids.
	return Object.freeze(ids.map((id) => defineExtensionId(id)));
}

function validateSection(section: unknown, owner: SectionOwner): CommandSection {
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
	return Object.freeze({
		title,
		body,
		...(only !== undefined && { only: validateSectionAudienceIds(only, owner) }),
		...(except !== undefined && { except: validateSectionAudienceIds(except, owner) }),
	}) as CommandSection;
}

function validateAuthoredSections(node: CommandNode): void {
	const sections = node.meta.sections;
	if (sections !== undefined) {
		const owner: SectionOwner = { subject: "command", name: node.meta.name };
		if (!Array.isArray(sections)) throw invalidSections(owner);
		node.meta.sections = sections.map((section) => validateSection(section, owner));
	}
	for (const sub of Object.values(node.subCommands)) validateAuthoredSections(sub);
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

function applyExtensionSections(
	root: CommandNode,
	extension: Extension,
	snapshot: CommandSnapshot,
): void {
	if (!extension.sections) return;
	const owner: SectionOwner = { subject: "extension", name: extension.id };
	const contributions = extension.sections(snapshot);
	if (!Array.isArray(contributions)) throw invalidSections(owner);
	for (const contribution of contributions as readonly ExtensionSectionContribution[]) {
		// validateSection rejects null/non-object contributions, so reading
		// `.command` afterwards is safe.
		const section = validateSection(contribution, owner);
		if (
			!Array.isArray(contribution.command) ||
			!contribution.command.every((segment) => typeof segment === "string")
		) {
			throw invalidSections(owner);
		}
		const target = contributionTarget(root, contribution.command, extension);
		target.meta.sections = [...(target.meta.sections ?? []), section];
	}
}

const preparedInvocations = new WeakMap<CommandNode, PreparedInvocation>();

/** Clone, apply Extensions and sections, freeze, and cache ordinary invocation preparation. */
function prepareInvocation(
	node: CommandNode,
	materializeCommandDefinition: MaterializeCommandDefinition,
	useCache = true,
): PreparedInvocation {
	const cached = useCache ? preparedInvocations.get(node) : undefined;
	if (cached) return cached;

	const rootNode = cloneCommandNode(node);
	const extensions = Object.freeze([...node.extensions]);

	for (const extension of extensions) {
		applyExtensionCommands(rootNode, extension, materializeCommandDefinition);
	}
	for (const extension of extensions) applyExtensionFlags(rootNode, extension);

	validateAuthoredSections(rootNode);
	const authoredSnapshot = snapshotCommand(rootNode);
	for (const extension of extensions) {
		applyExtensionSections(rootNode, extension, authoredSnapshot);
	}

	freezeTree(rootNode);
	const prepared = { rootNode, extensions };
	if (useCache) preparedInvocations.set(node, prepared);
	return prepared;
}

/** Resolve, parse, and run one invocation without rendering failures. */
async function dispatch(
	argv: readonly string[],
	prepared: PreparedInvocation,
	io: InvocationIO,
	onExtensionContext?: (context: ExtensionContext) => void,
	onFailure?: (error: unknown, context: ExtensionContext) => Promise<ExtensionId | undefined>,
): Promise<void> {
	const { rootNode, extensions } = prepared;

	// Routing and syntax parsing — failures flow directly to the caller.
	const resolved = resolveCommand(rootNode, [...argv]);
	const resolvedNode = resolved.command;
	const parsed = parseArgs(resolvedNode, resolved.argv);

	// One resource scope and resolver span pre-run, the action, and post-run.
	// DisposalStack (not the bare global): Node 22 has no AsyncDisposableStack.
	await using disposal = new DisposalStack();
	const resolver = createContextResolver(resolvedNode.contexts, io, disposal);

	const rootSnapshot = snapshotCommand(rootNode);
	const extensionContext: ExtensionContext = Object.freeze({
		argv: [...argv],
		rootCommand: rootSnapshot,
		command: resolvedNode === rootNode ? rootSnapshot : snapshotCommand(resolvedNode),
		commandPath: Object.freeze([...resolved.commandPath]),
		args: parsed.args,
		flags: parsed.flags,
		rawArgs: parsed.rawArgs,
		ctx: resolver.bag(extensions.flatMap((extension) => extension.uses ?? [])),
		finish: finishInvocation,
		stdout: io.stdout,
		stderr: io.stderr,
	});
	onExtensionContext?.(extensionContext);

	const terminal = async (): Promise<void> => {
		validateParsed(resolvedNode, parsed);

		// Standard Schemas on arg/flag definitions own value validation and
		// transformation; actions and flag-owning Contexts receive schema outputs.
		const validated = await applySchemas(resolvedNode, parsed);
		resolver.setValidatedFlags(validated.flags as Record<string, unknown>);
		if (!resolvedNode.run) return;

		const context = {
			args: validated.args,
			flags: validated.flags,
			ctx: resolver.bag(resolvedNode.contexts),
			rawArgs: parsed.rawArgs,
			command: extensionContext.command,
			rootCommand: rootSnapshot,
			stdout: io.stdout,
			stderr: io.stderr,
		};

		await resolvedNode.run(context);
	};

	let outcome: InvocationOutcome = { status: "completed" };
	try {
		try {
			for (const extension of extensions) {
				if ((await extension.hooks?.preRun?.(extensionContext)) === finishInvocation()) {
					outcome = { status: "finished", by: extension.id };
					break;
				}
			}
			if (outcome.status !== "finished") {
				await terminal();
			}
		} catch (error) {
			const by = await onFailure?.(error, extensionContext);
			outcome = { status: "failed", error, ...(by === undefined ? {} : { by }) };
		}

		// Frozen so a mutating post-run hook cannot rewrite the outcome Core
		// trusts below (e.g. flipping "failed" to "completed" to mask an error).
		Object.freeze(outcome);

		let postRunFailed = false;
		let postRunError: unknown;
		for (const extension of extensions.toReversed()) {
			try {
				await extension.hooks?.postRun?.(extensionContext, outcome);
			} catch (error) {
				if (outcome.status !== "failed" && !postRunFailed) {
					postRunFailed = true;
					postRunError = error;
				}
			}
		}

		if (outcome.status === "failed") throw outcome.error;
		if (postRunFailed) throw postRunError;
	} finally {
		// A rejected sibling pull can leave another setup in flight; wait for it
		// so its value registers its disposer before the disposal scope exits.
		await resolver.settle();
	}
}

/** Render one failure through Extension onError hooks, ending in Core's default renderer. */
async function renderFailure(
	error: unknown,
	argv: readonly string[],
	prepared: PreparedInvocation,
	io: InvocationIO,
	extensionContext: ExtensionContext | undefined,
	silentDefault = false,
): Promise<ExtensionId | undefined> {
	const renderDefault = (): void => {
		// Cancellation (AbortError) has no default rendering — a user abort
		// is not an error to report unless an onError hook claims it.
		if (silentDefault) return;
		const message = error instanceof Error ? error.message : String(error);
		io.stderr(`Error: ${message}`);
	};

	// Reuse the dispatch context so per-invocation identity (e.g. WeakMap keys
	// set in preRun) survives into onError. During dispatch its Contexts remain
	// live through postRun; errors raised after cleanup see the closed resolver.
	// The synthetic fallback exists only for failures before a context was built.
	function unavailable(property: PropertyKey): Promise<never> {
		return Promise.reject(
			new CrustError(
				"DEFINITION",
				`Context "${String(property)}" cannot be pulled from onError because invocation Contexts have already been disposed.`,
				{
					subject: "context",
					name: String(property),
					reason: "context-after-disposal",
				},
			),
		);
	}
	const unavailableContext = new Proxy(
		{},
		{
			get: (_, property) =>
				property === "then" || typeof property === "symbol" ? undefined : unavailable(property),
		},
	);
	const context =
		extensionContext ??
		Object.freeze({
			argv: [...argv] as readonly string[],
			rootCommand: snapshotCommand(prepared.rootNode),
			command: snapshotCommand(prepared.rootNode),
			commandPath: Object.freeze([prepared.rootNode.meta.name]),
			args: Object.freeze({}),
			flags: Object.freeze({}),
			rawArgs: [],
			finish: finishInvocation,
			stdout: io.stdout,
			stderr: io.stderr,
			ctx: unavailableContext,
		} satisfies ExtensionContext);

	try {
		for (const extension of prepared.extensions) {
			if (await extension.hooks?.onError?.(error, context)) return extension.id;
		}
	} catch {
		// Rendering must not hide the original invocation failure.
	}
	renderDefault();
	return undefined;
}

/** Explicitly injected IO opts an invocation into the ambient terminal scope. */
function hasInjectedIO(io: Partial<InvocationIO> | undefined): boolean {
	return io !== undefined && Object.keys(io).length > 0;
}

/** Programmatic boundary: throw raw failures and leave process status untouched. */
export async function runInvocation(
	node: CommandNode,
	argv: readonly string[],
	io: Partial<InvocationIO> | undefined,
	materializeCommandDefinition: MaterializeCommandDefinition,
): Promise<void> {
	const resolvedIO: InvocationIO = { ...DEFAULT_IO, ...io };
	const prepared = prepareInvocation(node, materializeCommandDefinition);
	const invoke = () => dispatch(argv, prepared, resolvedIO);
	await (hasInjectedIO(io) ? withAmbientTerminalIO(resolvedIO, invoke) : invoke());
}

/** Terminal CLI boundary: render failures and set the process exit status. */
export async function executeInvocation(
	node: CommandNode,
	options:
		| {
				argv?: string[];
				io?: Partial<InvocationIO>;
		  }
		| undefined,
	materializeCommandDefinition: MaterializeCommandDefinition,
): Promise<void> {
	const argv = options?.argv ?? process.argv.slice(2);
	const io: InvocationIO = { ...DEFAULT_IO, ...options?.io };
	const snapshotPath = process.env[SNAPSHOT_PATH_ENV];

	if (snapshotPath) {
		try {
			let prepared = prepareInvocation(node, materializeCommandDefinition);
			let snapshot = snapshotCommand(prepared.rootNode);
			const buildOutDir = process.env[BUILD_OUT_DIR_ENV];
			if (buildOutDir) {
				const extensions = prepared.extensions;
				for (const extension of extensions) {
					if (!extension.build) continue;
					try {
						await extension.build({ snapshot, outDir: buildOutDir });
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						throw new Error(`Extension "${extension.id}" build failed: ${message}`, {
							cause: error,
						});
					}
					// The hook sees the snapshot from before it starts; refreshing afterwards
					// lets later hooks observe its outputs without mutating the frozen tree.
					prepared = prepareInvocation(node, materializeCommandDefinition, false);
					snapshot = snapshotCommand(prepared.rootNode);
				}
			}
			await writeFile(snapshotPath, JSON.stringify(snapshot));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(message);
			return process.exit(1);
		}
		return process.exit(0);
	}

	const invoke = async (): Promise<void> => {
		let prepared: PreparedInvocation;
		try {
			prepared = prepareInvocation(node, materializeCommandDefinition);
		} catch (error) {
			// Extension-application failures render directly: hooks belong to
			// Extensions that just failed to apply.
			if (isAbortError(error)) {
				process.exitCode = EXIT_CODE_CANCELLED;
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			io.stderr(`Error: ${message}`);
			process.exitCode = 1;
			return;
		}

		let extensionContext: ExtensionContext | undefined;
		let renderedInDispatch = false;
		try {
			await dispatch(
				argv,
				prepared,
				io,
				(context) => {
					extensionContext = context;
				},
				async (error, context) => {
					renderedInDispatch = true;
					const cancelled = isAbortError(error);
					process.exitCode = cancelled ? EXIT_CODE_CANCELLED : 1;
					return renderFailure(error, argv, prepared, io, context, cancelled);
				},
			);
		} catch (error) {
			if (isAbortError(error)) {
				// Cancellation keeps its dedicated exit code while allowing Extension
				// onError hooks to render a message. Core's default stays silent.
				if (!renderedInDispatch) {
					await renderFailure(error, argv, prepared, io, extensionContext, true);
				}
				process.exitCode = EXIT_CODE_CANCELLED;
				return;
			}
			// Core always preserves a nonzero failure outcome, regardless of
			// what Extension onError hooks do.
			process.exitCode = 1;
			if (!renderedInDispatch) await renderFailure(error, argv, prepared, io, extensionContext);
		}
	};

	await (hasInjectedIO(options?.io) ? withAmbientTerminalIO(io, invoke) : invoke());
}

/** Prepare a frozen, validated snapshot without invoking a command action. */
export async function prepareInvocationSnapshot(
	node: CommandNode,
	materializeCommandDefinition: MaterializeCommandDefinition,
): Promise<CommandSnapshot> {
	const prepared = prepareInvocation(node, materializeCommandDefinition);
	return snapshotCommand(prepared.rootNode);
}
