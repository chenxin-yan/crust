import { buildContexts } from "../api/context.ts";
import {
	finishInvocation,
	type Extension,
	type ExtensionContext,
	type InvocationOutcome,
} from "../api/extension.ts";
import { parseArgs, validateParsed } from "../parsing/parser.ts";
import { applySchemas } from "../parsing/schema.ts";
import type { FlagDef, FlagsDef, InvocationIO } from "../types.ts";
import { validateIncomingFlag } from "../validation/flags.ts";
import { validateCommandTree } from "../validation/tree.ts";
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
 * Build-time validation protocol.
 *
 * `crust build` spawns the user's entrypoint as a subprocess with
 * `CRUST_INTERNAL_VALIDATE_ONLY=1` (and the companion
 * {@link VALIDATION_FORCE_EXIT_ENV}=`1`). When `.execute()` detects
 * `VALIDATION_MODE_ENV` it runs the validation pipeline and surfaces errors
 * via stderr and `process.exitCode`.
 *
 * Process termination is opt-in via {@link VALIDATION_FORCE_EXIT_ENV} so
 * that in-process callers (tests, embedders) that set only this env get
 * the validation result without having their host process killed.
 */
export const VALIDATION_MODE_ENV = "CRUST_INTERNAL_VALIDATE_ONLY";

/**
 * Companion to {@link VALIDATION_MODE_ENV}. When set to `"1"` _alongside_
 * `VALIDATION_MODE_ENV`, `.execute()` calls `process.exit()` after the
 * validation pipeline completes — ensuring any code that follows
 * `await app.execute()` in the user's entrypoint does not run during
 * `crust build`'s pre-compile validation subprocess.
 *
 * Without this flag, `.execute()` only sets `process.exitCode` and returns,
 * matching the rest of `.execute()`'s error handling. This is the path
 * in-process callers (tests that toggle `VALIDATION_MODE_ENV`, programmatic
 * embedders) take so the host event loop is not terminated.
 */
export const VALIDATION_FORCE_EXIT_ENV = "CRUST_INTERNAL_VALIDATE_FORCE_EXIT";
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
	extensionName: string,
): void {
	validateIncomingFlag(
		{ name, def },
		node.effectiveFlags,
		`Extension "${extensionName}" on "${node.meta.name}"`,
	);
	node.effectiveFlags[name] = def;
	if (!recursive) return;
	for (const sub of Object.values(node.subCommands)) {
		injectExtensionFlag(sub, name, def, true, extensionName);
	}
}

/** Attach one Extension's owned root commands to a cloned tree. */
function applyExtensionCommands(
	root: CommandNode,
	extension: Extension,
	materializeCommandDefinition: MaterializeCommandDefinition,
): void {
	for (const definition of extension.commands ?? []) {
		const node = materializeCommandDefinition(definition, root, extension.name);
		root.subCommands[definition.name] = node;
	}
}

/** Inject one Extension's owned flags across a cloned tree. */
function applyExtensionFlags(root: CommandNode, extension: Extension): void {
	for (const [name, defWithScope] of Object.entries(extension.flags ?? {})) {
		const { recursive = true, ...def } = defWithScope;
		injectExtensionFlag(root, name, def as FlagDef, recursive, extension.name);
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

	// Spread first so enumerable symbol-keyed annotations (e.g. skills'
	// command annotations) survive the clone; then override every structural
	// field with a decoupled copy.
	return {
		...node,
		meta: { ...node.meta },
		localFlags: cloneFlags(node.localFlags),
		ownedFlags: cloneFlags(node.ownedFlags),
		effectiveFlags: cloneFlags(node.effectiveFlags),
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
	Object.freeze(node.meta);
	Object.freeze(node.contexts);
	Object.freeze(node.extensions);
	if (node.args) Object.freeze(node.args);
	for (const sub of Object.values(node.subCommands)) freezeTree(sub);
	Object.freeze(node.subCommands);
}

/** Shared prepare step: clone, apply Extensions, freeze. */
function prepareInvocation(
	node: CommandNode,
	materializeCommandDefinition: MaterializeCommandDefinition,
): PreparedInvocation {
	const rootNode = cloneCommandNode(node);
	const extensions = node.extensions;

	// Commands first, then flags, so recursive Extension flags also reach
	// Extension-contributed commands (e.g. --help on "completion").
	for (const extension of extensions) {
		applyExtensionCommands(rootNode, extension, materializeCommandDefinition);
	}
	for (const extension of extensions) applyExtensionFlags(rootNode, extension);

	freezeTree(rootNode);
	return { rootNode, extensions };
}

/** Resolve, parse, and run one invocation without rendering failures. */
async function dispatch(
	argv: readonly string[],
	prepared: PreparedInvocation,
	io: InvocationIO,
	onExtensionContext?: (context: ExtensionContext) => void,
): Promise<void> {
	const { rootNode, extensions } = prepared;

	// Routing and syntax parsing — failures flow directly to the caller.
	const resolved = resolveCommand(rootNode, [...argv]);
	const resolvedNode = resolved.command;
	const parsed = parseArgs(resolvedNode, resolved.argv);

	const rootSnapshot = snapshotCommand(rootNode);
	const extensionContext: ExtensionContext = Object.freeze({
		argv: [...argv] as readonly string[],
		rootCommand: rootSnapshot,
		command: resolvedNode === rootNode ? rootSnapshot : snapshotCommand(resolvedNode),
		commandPath: Object.freeze([...resolved.commandPath]),
		args: parsed.args as Readonly<Record<string, unknown>>,
		flags: parsed.flags as Readonly<Record<string, unknown>>,
		rawArgs: parsed.rawArgs,
		finish: finishInvocation,
		stdout: io.stdout,
		stderr: io.stderr,
	});
	onExtensionContext?.(extensionContext);

	const terminal = async (): Promise<void> => {
		validateParsed(resolvedNode, parsed);
		if (!resolvedNode.run) return;

		// Standard Schemas on arg/flag definitions own value validation and
		// transformation; the action receives schema outputs.
		const validated = await applySchemas(resolvedNode, parsed);

		// Native resource protocol: Context values implementing
		// Symbol.dispose/asyncDispose are disposed in reverse construction
		// order after success or failure (`await using` semantics).
		await using disposal = new AsyncDisposableStack();

		const context = {
			args: validated.args,
			flags: validated.flags,
			// Each Context setup receives its owned slice of the validated flags.
			ctx: await buildContexts(
				resolvedNode.contexts,
				validated.flags as Record<string, unknown>,
				io,
				disposal,
				`"${resolved.commandPath.join(" ")}"`,
			),
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
		for (const extension of extensions) {
			if ((await extension.hooks?.preRun?.(extensionContext)) === finishInvocation()) {
				outcome = { status: "finished", by: extension.name };
				break;
			}
		}
		if (outcome.status !== "finished") {
			await terminal();
			outcome = { status: "completed" };
		}
	} catch (error) {
		outcome = { status: "failed", error };
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
}

/** Render one failure through Extension onError hooks, ending in Core's default renderer. */
async function renderFailure(
	error: unknown,
	argv: readonly string[],
	prepared: PreparedInvocation,
	io: InvocationIO,
	extensionContext: ExtensionContext | undefined,
	silentDefault = false,
): Promise<void> {
	const renderDefault = (): void => {
		// Cancellation (AbortError) has no default rendering — a user abort
		// is not an error to report unless an onError hook claims it.
		if (silentDefault) return;
		const message = error instanceof Error ? error.message : String(error);
		io.stderr(`Error: ${message}`);
	};

	// Routing or parsing may have failed before an invocation context existed.
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
		} satisfies ExtensionContext);

	try {
		for (const extension of prepared.extensions) {
			if (await extension.hooks?.onError?.(error, context)) return;
		}
	} catch {
		// Rendering must not hide the original invocation failure.
	}
	renderDefault();
}

/** Programmatic boundary: throw raw failures and leave process status untouched. */
export async function runInvocation(
	node: CommandNode,
	argv: readonly string[],
	io: { stdout?: (text: string) => void; stderr?: (text: string) => void } | undefined,
	materializeCommandDefinition: MaterializeCommandDefinition,
): Promise<void> {
	const resolvedIO: InvocationIO = { ...DEFAULT_IO, ...io };
	const prepared = prepareInvocation(node, materializeCommandDefinition);
	await dispatch(argv, prepared, resolvedIO);
}

/** Terminal CLI boundary: render failures and set the process exit status. */
export async function executeInvocation(
	node: CommandNode,
	options:
		| {
				argv?: string[];
				io?: { stdout?: (text: string) => void; stderr?: (text: string) => void };
		  }
		| undefined,
	materializeCommandDefinition: MaterializeCommandDefinition,
): Promise<void> {
	const argv = options?.argv ?? process.argv.slice(2);
	const io: InvocationIO = { ...DEFAULT_IO, ...options?.io };

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

	if (process.env[VALIDATION_MODE_ENV] === "1") {
		try {
			validateCommandTree(prepared.rootNode);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(message);
			process.exitCode = 1;
		}

		// Build validation subprocesses opt in to force-exit so user code
		// after `await app.execute()` is skipped (see VALIDATION_FORCE_EXIT_ENV).
		if (process.env[VALIDATION_FORCE_EXIT_ENV] === "1") {
			return process.exit(process.exitCode ?? 0);
		}
		return;
	}

	let extensionContext: ExtensionContext | undefined;
	try {
		await dispatch(argv, prepared, io, (context) => {
			extensionContext = context;
		});
	} catch (error) {
		if (isAbortError(error)) {
			// Cancellation keeps its dedicated exit code, but Extension
			// onError hooks may observe it to render a message (e.g.
			// "Operation cancelled"). Core's default stays silent.
			process.exitCode = EXIT_CODE_CANCELLED;
			await renderFailure(error, argv, prepared, io, extensionContext, true);
			process.exitCode = EXIT_CODE_CANCELLED;
			return;
		}
		// Core always preserves a nonzero failure outcome, regardless of
		// what Extension onError hooks do.
		process.exitCode = 1;
		await renderFailure(error, argv, prepared, io, extensionContext);
	}
}

/** Prepare a frozen, validated snapshot without invoking a command action. */
export async function prepareInvocationSnapshot(
	node: CommandNode,
	materializeCommandDefinition: MaterializeCommandDefinition,
): Promise<CommandSnapshot> {
	const prepared = prepareInvocation(node, materializeCommandDefinition);
	validateCommandTree(prepared.rootNode);
	return snapshotCommand(prepared.rootNode);
}
