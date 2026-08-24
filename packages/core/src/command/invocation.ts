import { writeFile } from "node:fs/promises";

import { withAmbientTerminalIO } from "@crustjs/utils/terminal";

import { createContextResolver, DisposalStack } from "../api/context.ts";
import {
	finishInvocation,
	type Extension,
	type ExtensionContext,
	type InvocationOutcome,
} from "../api/extension.ts";
import { CrustError, type CaughtError } from "../errors.ts";
import type { ExtensionId } from "../identity.ts";
import { parseArgs, validateParsed } from "../parsing/parser.ts";
import { applySchemas } from "../parsing/schema.ts";
import type { InvocationIO } from "../types.ts";
import type { CrustCommandContext, RunOutcome } from "./crust.ts";
import {
	applyExtensionCommands,
	applyExtensionFlags,
	applyExtensionSections,
	cloneCommandNode,
	type MaterializeCommandDefinition,
	validateAuthoredSections,
} from "./extensions-install.ts";
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

function isAbortError(error: CaughtError): boolean {
	if (!(error instanceof Error)) return false;
	return error.name === "AbortError";
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
	Object.freeze(node.contextExtensionIds);
	Object.freeze(node.extensions);
	if (node.args) Object.freeze(node.args);
	for (const sub of Object.values(node.subCommands)) freezeTree(sub);
	Object.freeze(node.subCommands);
}

function isSymbol<T>(value: T): value is T & symbol {
	return typeof value === "symbol";
}

const preparedInvocations = new WeakMap<CommandNode, PreparedInvocation>();

/** Clone and apply Extension commands and flags; recipes run exactly once here. */
function buildExtensionTree(
	node: CommandNode,
	materializeCommandDefinition: MaterializeCommandDefinition,
): PreparedInvocation {
	const rootNode = cloneCommandNode(node);
	const extensions = Object.freeze([...node.extensions]);

	for (const extension of extensions) {
		applyExtensionCommands(rootNode, extension, materializeCommandDefinition);
	}
	for (const extension of extensions) applyExtensionFlags(rootNode, extension);

	validateAuthoredSections(rootNode);
	return { rootNode, extensions };
}

/** Evaluate Extension section callbacks against current state and freeze the tree. */
function applySectionsAndFreeze(
	rootNode: CommandNode,
	extensions: readonly Extension[],
): CommandNode {
	const authoredSnapshot = snapshotCommand(rootNode);
	for (const extension of extensions) {
		applyExtensionSections(rootNode, extension, authoredSnapshot);
	}
	freezeTree(rootNode);
	return rootNode;
}

/** Clone, apply Extensions and sections, freeze, and cache ordinary invocation preparation. */
function prepareInvocation(
	node: CommandNode,
	materializeCommandDefinition: MaterializeCommandDefinition,
): PreparedInvocation {
	const cached = preparedInvocations.get(node);
	if (cached) return cached;

	const prepared = buildExtensionTree(node, materializeCommandDefinition);
	applySectionsAndFreeze(prepared.rootNode, prepared.extensions);
	preparedInvocations.set(node, prepared);
	return prepared;
}

/** Resolve, parse, and run one invocation without rendering failures. */
async function dispatch(
	argv: readonly string[],
	prepared: PreparedInvocation,
	io: InvocationIO,
	onExtensionContext?: (context: ExtensionContext) => void,
	onFailure?: (error: CaughtError, context: ExtensionContext) => Promise<ExtensionId | undefined>,
): Promise<RunOutcome<unknown>> {
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

	const terminal = async () => {
		validateParsed(resolvedNode, parsed);

		// Standard Schemas on arg/flag definitions own value validation and
		// transformation; actions and flag-owning Contexts receive schema outputs.
		const validated = await applySchemas(resolvedNode, parsed);
		resolver.setValidatedFlags(validated.flags);
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
		} satisfies CrustCommandContext;

		return await resolvedNode.run(context);
	};

	let result: unknown;
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
				result = await terminal();
			}
		} catch (error) {
			const by = await onFailure?.(error, extensionContext);
			outcome = { status: "failed", error, ...(by === undefined ? {} : { by }) };
		}

		// Frozen so a mutating post-run hook cannot rewrite the outcome Core
		// trusts below (e.g. flipping "failed" to "completed" to mask an error).
		Object.freeze(outcome);

		let postRunFailed = false;
		let postRunError: CaughtError;
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
	return outcome.status === "finished"
		? { status: "finished", by: outcome.by }
		: { status: "completed", result };
}

/** Render one failure through Extension onError hooks, ending in Core's default renderer. */
async function renderFailure(
	error: CaughtError,
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
				property === "then" || isSymbol(property) ? undefined : unavailable(property),
		},
	);
	const context =
		extensionContext ??
		Object.freeze({
			argv: [...argv],
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

/** Prepare the cached runtime command tree for structured programmatic serialization. */
export function prepareInvocationRoot(
	node: CommandNode,
	materializeCommandDefinition: MaterializeCommandDefinition,
): CommandNode {
	return prepareInvocation(node, materializeCommandDefinition).rootNode;
}

/** Programmatic boundary: throw raw failures and leave process status untouched. */
export async function runInvocation(
	node: CommandNode,
	argv: readonly string[],
	io: Partial<InvocationIO> | undefined,
	materializeCommandDefinition: MaterializeCommandDefinition,
): Promise<RunOutcome<unknown>> {
	const resolvedIO: InvocationIO = { ...DEFAULT_IO, ...io };
	const prepared = prepareInvocation(node, materializeCommandDefinition);
	const invoke = () => dispatch(argv, prepared, resolvedIO);
	return await (hasInjectedIO(io) ? withAmbientTerminalIO(resolvedIO, invoke) : invoke());
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
			// Commands and flags materialize once so recipes keep their
			// once-per-`.add()` lifecycle; only section callbacks re-evaluate.
			const base = buildExtensionTree(node, materializeCommandDefinition);
			const takeSnapshot = () =>
				snapshotCommand(applySectionsAndFreeze(cloneCommandNode(base.rootNode), base.extensions));
			let snapshot = takeSnapshot();
			const buildOutDir = process.env[BUILD_OUT_DIR_ENV];
			if (buildOutDir) {
				for (const extension of base.extensions) {
					if (!extension.build) continue;
					try {
						await extension.build({ snapshot, outDir: buildOutDir });
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						throw new Error(`Extension "${extension.id}" build failed: ${message}`, {
							cause: error,
						});
					}
					// The hook sees the snapshot from before it starts; re-evaluating sections
					// afterwards lets later hooks observe its outputs without mutating the frozen tree.
					snapshot = takeSnapshot();
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
