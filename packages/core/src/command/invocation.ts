import { isSignalIgnored } from "@crustjs/utils/signals";
import { withAmbientTerminalIO, writeProcessOutput } from "@crustjs/utils/terminal";

import { validateContextAvailability } from "../api/context.ts";
import type {
	ExtensionData,
	ExtensionHandler,
	ExtensionHooks,
	ExtensionSetupContext,
	ExtensionContext,
	InvocationOutcome,
	Renderer,
} from "../api/extension.ts";
import { CrustError, type CaughtError } from "../errors.ts";
import type { ExtensionId } from "../identity.ts";
import {
	bindStructuredInput,
	parseArgs,
	parseStructured,
	validateParsed,
	type ArgvParseResult,
} from "../parsing/parser.ts";
import { applyOutputSchema, applySchemas } from "../parsing/schema.ts";
import type { ExecuteOptions, InvocationIO, InvocationOptions, RunInputPayload } from "../types.ts";
import { createContextResolver } from "./context-resolver.ts";
import type { CommandDefinition, CrustCommandContext } from "./crust.ts";
import {
	applyExtensionSections,
	applyNodeContextSections,
	installExtensionProviders,
	sectionContextsFor,
	type ExtensionProvider,
	type MaterializeCommandDefinition,
} from "./extensions-install.ts";
import {
	addedChildrenOf,
	checkProvidedContextFlags,
	childEntriesOf,
	cloneFlagRegistry,
	commandDefinitionInternal,
	commandPathOf,
	demandedFactories,
	installContextFlags,
	lazyChildRecord,
	registerFlag,
	type AddedChild,
	type ChildEntry,
	type CommandNode,
} from "./node.ts";
import { commandNotFound, resolveCommand, type CommandRoute } from "./router.ts";
import { createSnapshotProjector, type CommandSnapshot } from "./snapshot.ts";
import type { CommandShape, ShapeRunOutcome } from "./typed-run.ts";

const DEFAULT_IO: InvocationIO = {
	stdout: (text) => writeProcessOutput(1, `${text}\n`),
	stderr: (text) => writeProcessOutput(2, `${text}\n`),
};

/** A flag handler with the Extension that registered it. */
interface BoundHandler extends ExtensionHandler<any, any, any> {
	readonly by: ExtensionId;
	/** A `recursive: false` flag; a child may own an unrelated flag with the same name. */
	readonly rootOnly: boolean;
	/** Only a boolean can be negated; `false` or `[]` is a supplied value of any other type. */
	readonly boolean: boolean;
}

/** One cloned, extension-applied, frozen command tree; children are prepared on first access. */
interface PreparedInvocation {
	rootNode: CommandNode;
	extensions: readonly ExtensionData[];
	/** Handlers by flag name; Extension flags never collide, so each flag has at most one. */
	handlers: ReadonlyMap<string, BoundHandler>;
	noAction?: { readonly by: ExtensionId; readonly run: ExtensionHandler<any, any, any>["run"] };
	renderer?: {
		readonly by: ExtensionId;
		readonly select: NonNullable<ExtensionHooks<any, any, any>["renderer"]>;
	};
}

/**
 * Routes the Command Action's and Contexts' output through the invocation's Renderer.
 * Writes made before it is chosen, such as by a Context a setup pulled, wait in order.
 */
interface InvocationOutput {
	/** The invocation's IO, which Extensions write to directly. */
	readonly io: InvocationIO;
	/** What the Command Action and Contexts write through. */
	readonly routed: InvocationIO;
	/** `undefined` until {@link InvocationOutput.choose} runs. */
	readonly renderer: Renderer | undefined;
	/** Choose the renderer (`undefined` keeps the default) and flush waiting writes through it. */
	choose(renderer: Renderer | undefined): void;
}

function createInvocationOutput(io: InvocationIO): InvocationOutput {
	let waiting: (readonly [kind: "text" | "diag", line: string])[] = [];
	let renderer: Renderer | undefined;
	const write = (kind: "text" | "diag", line: string) => {
		if (renderer) renderer[kind](line);
		else waiting.push([kind, line]);
	};
	return {
		io,
		// Spread first, as Context setups receive it: injected io may carry runtime extras.
		routed: { ...io, stdout: (line) => write("text", line), stderr: (line) => write("diag", line) },
		get renderer() {
			return renderer;
		},
		choose(selected) {
			const chosen = selected ?? { text: io.stdout, diag: io.stderr };
			renderer = chosen;
			const flushed = waiting;
			waiting = [];
			for (const [kind, line] of flushed) chosen[kind](line);
		},
	};
}

/**
 * Snapshot subprocess protocol used by first-party build tooling.
 *
 * When set to a non-empty file path, `.execute()` prepares the command tree,
 * validates its documentation sections, optionally runs Extension build hooks when the
 * build output directory is set, writes its final JSON snapshot and Build Report, and exits
 * without dispatching a Command Action. In-process callers use `Crust.snapshot()`.
 *
 * Only source entries run by `crust build` honor it: finished Bun/Node bundles carry
 * `process.env.CRUST_INTERNAL_BUILD === "1"` as a literal and compile the protocol out.
 */
export const SNAPSHOT_PATH_ENV = "CRUST_INTERNAL_SNAPSHOT_PATH";

/** A SIGINT this soon after the first is the same Ctrl-C relayed by a parent process. */
const RELAYED_SIGINT_WINDOW_MS = 50;
const EXIT_CODE_CANCELLED = 130;

function isAbortError(error: CaughtError): boolean {
	if (!(error instanceof Error)) return false;
	return error.name === "AbortError";
}

/**
 * Structural: down-level bundles can implement `await using` with a plain `Error`
 * carrying `error`/`suppressed`, so `instanceof SuppressedError` cannot be used.
 */
function isSuppressedError(error: CaughtError): error is { error: unknown; suppressed: unknown } {
	return (
		isObjectLike(error) &&
		"error" in error &&
		"suppressed" in error &&
		// SAFETY: structural probe of an arbitrary thrown value; callers guard the getter with try.
		(error as { name?: unknown }).name === "SuppressedError"
	);
}

/**
 * A failure is cancellation when it is an `AbortError`, or a `SuppressedError` whose
 * `suppressed` side is cancellation: cleanup that failed while unwinding it. Returns
 * those cleanup failures (outermost first), or `undefined` when it is not cancellation.
 */
function cancellationCleanupFailures(error: CaughtError): CaughtError[] | undefined {
	const failures: CaughtError[] = [];
	const seen = new Set<object>();
	try {
		let current = error;
		while (!isAbortError(current)) {
			if (!isSuppressedError(current) || seen.has(current)) return undefined;
			seen.add(current);
			failures.push(current.error);
			current = current.suppressed;
		}
	} catch {
		// A throwing getter on an arbitrary thrown value makes it an ordinary failure.
		return undefined;
	}
	return failures;
}

function isObjectLike(value: CaughtError): value is object {
	return typeof value === "object" && value !== null;
}

/**
 * One `label: message` line per underlying failure. `SuppressedError` chains and
 * `AggregateError`s contribute their members, not their own boilerplate message,
 * so a disposal failure never renders as a bare `Error: `.
 */
function describeFailure(error: CaughtError, label = "Error"): string {
	const messages: string[] = [];
	// Arbitrary thrown values: every read below may hit a throwing getter or Proxy
	// trap, and members may reference their container, so each node is visited
	// inside its own try with an identity guard. A shared node budget bounds both
	// depth and width without cutting off ordinary linear disposal chains. Reads
	// count too, so unreadable members cannot bypass the budget.
	const seen = new Set<object>();
	let remaining = 256;
	let truncated = false;
	const visitMember = (read: () => CaughtError): void => {
		if (truncated) return;
		if (remaining === 0) {
			truncated = true;
			messages.push("[additional failures omitted]");
			return;
		}
		remaining--;
		let member: CaughtError;
		try {
			member = read();
		} catch {
			messages.push("[unreadable failure]");
			return;
		}
		visit(member);
	};
	const visit = (value: CaughtError): void => {
		try {
			if (isObjectLike(value)) {
				if (seen.has(value)) return;
				seen.add(value);
			}
			const before = messages.length;
			if (isSuppressedError(value)) {
				visitMember(() => value.error);
				visitMember(() => value.suppressed);
				if (messages.length > before) return;
			} else if (value instanceof AggregateError) {
				// Only a genuine AggregateError expands: an ordinary error that happens to
				// carry an `errors` array keeps its own message. The property is writable,
				// so a hostile value may have replaced the array.
				const members: unknown = value.errors;
				if (Array.isArray(members)) {
					for (let index = 0; index < members.length; index++) {
						visitMember(() => members[index]);
						if (truncated) break;
					}
					if (messages.length > before) return;
				}
			}
			// Empty containers fall back to their own string form rather than an
			// empty line. Coerce inside the try: a message object's toString may throw.
			messages.push(String((value instanceof Error && value.message) || value));
		} catch {
			messages.push("[unreadable failure]");
		}
	};
	visitMember(() => error);
	return messages.map((message) => `${label}: ${message}`).join("\n");
}

function freezeNode(node: CommandNode): void {
	Object.freeze(node);
	Object.freeze(node.localFlags);
	Object.freeze(node.ownedFlags);
	Object.freeze(node.effectiveFlags);
	// Section objects are already frozen during normalization.
	if (node.meta.sections) Object.freeze(node.meta.sections);
	Object.freeze(node.meta);
	Object.freeze(node.contexts);
	Object.freeze(node.extensions);
	Object.freeze(node.args);
}

function isSymbol<T>(value: T): value is T & symbol {
	return typeof value === "symbol";
}

const preparedInvocations = new WeakMap<CommandNode, PreparedInvocation>();

/**
 * Root children materialized against Extension providers, by the builder's final
 * Extension list (`extensionPositions` changes with it), then `.add()` cell. Apps
 * derived from one builder that keep the list, such as `app.flags(...)` after
 * `.extend()`, run each recipe once.
 */
const providedChildren = new WeakMap<readonly ExtensionData[], WeakMap<AddedChild, CommandNode>>();

/**
 * Clone the builder tree and apply the final Extension list: providers, commands,
 * and flags reach every command alike, whenever it was added. Nodes are built on
 * first access (see `lazyChildRecord`): an invocation prepares only the path it
 * routes through, while whole-tree readers (snapshots, docs) still build every
 * node. Each node gets its Context sections and is frozen as it is built.
 */
export function buildExtensionTree(
	node: CommandNode,
	materializeCommandDefinition: MaterializeCommandDefinition,
): PreparedInvocation {
	const extensions = Object.freeze([...node.extensions]);
	// By name, not `.extend()` order, so help lists Extension flags the same for every order.
	const extensionFlags = extensions
		.flatMap((extension) =>
			Object.entries(extension.flags).map(([name, { recursive = true, ...def }]) => ({
				name,
				def,
				recursive,
			})),
		)
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	const handlers = new Map<string, BoundHandler>();
	let noAction: PreparedInvocation["noAction"];
	let renderer: PreparedInvocation["renderer"];
	for (const extension of extensions) {
		for (const [flag, handler] of Object.entries(extension.handlers)) {
			const def = extension.flags[flag];
			handlers.set(flag, {
				...handler,
				by: extension.id,
				rootOnly: def?.recursive === false,
				boolean: def?.type === "boolean",
			});
		}
		if (extension.hooks.renderer) {
			// Two renderers could only be ranked by `.extend()` order.
			if (renderer) {
				throw new CrustError(
					"DEFINITION",
					`Extensions "${renderer.by}" and "${extension.id}" both set renderer; an application can have one`,
					{ subject: "extension", name: extension.id, reason: "duplicate-renderer" },
				);
			}
			renderer = { by: extension.id, select: extension.hooks.renderer };
		}
		if (!extension.hooks.noAction) continue;
		// Two fallbacks could only be ranked by `.extend()` order.
		if (noAction) {
			throw new CrustError(
				"DEFINITION",
				`Extensions "${noAction.by}" and "${extension.id}" both set noAction; an application can have one`,
				{ subject: "extension", name: extension.id, reason: "duplicate-no-action" },
			);
		}
		noAction = { by: extension.id, run: extension.hooks.noAction };
	}
	const providers: ExtensionProvider[] = extensions.flatMap((extension) => {
		// SAFETY: .extend() records a position for every id it adds to the list.
		const position = node.extensionPositions!.get(extension.id)!;
		return extension.provide.map((instance) => ({ instance, position, extension: extension.id }));
	});
	const hookContexts = extensions.flatMap((extension) => extension.use);
	// The definitions of one `.add()` call share its parent.
	const installed = new Map<CommandNode, CommandNode>();
	const withProviders = (parent: CommandNode): CommandNode => {
		let seeded = installed.get(parent);
		if (!seeded) installed.set(parent, (seeded = installExtensionProviders(parent, providers)));
		return seeded;
	};
	// A root child's recipe runs against its `.add()`-time parent plus the providers;
	// descendants inherit them from it.
	const rootChild = (cell: AddedChild): CommandNode => {
		// Without providers, the builder's own once-per-`.add()` materialization applies.
		if (providers.length === 0) return cell.resolve();
		let built = providedChildren.get(node.extensions);
		if (!built) providedChildren.set(node.extensions, (built = new WeakMap()));
		let child = built.get(cell);
		if (!child) {
			child = materializeCommandDefinition(cell.definition, withProviders(cell.parent));
			built.set(cell, child);
		}
		return child;
	};

	const prepare = (source: CommandNode, path: string, isRoot: boolean): CommandNode => {
		// Extension providers are application-wide, so an extended Extension's Contexts reach every command.
		for (const id of source.usedExtensions) {
			if (!extensions.some((extension) => extension.id === id)) {
				throw new CrustError(
					"DEFINITION",
					`Command "${path}" uses Extension "${id}", which the application does not extend`,
					{ subject: "extension", name: id, reason: "missing-extension" },
				);
			}
		}
		const entries = new Map<string, ChildEntry>(
			isRoot
				? addedChildrenOf(source).map((cell) => [
						cell.name,
						{
							name: cell.name,
							meta: cell.meta,
							resolve: () => rootChild(cell),
							definition: cell.definition,
						},
					])
				: childEntriesOf(source).map((entry) => [entry.name, entry]),
		);
		if (isRoot) {
			// FIX_COMMAND_COLLISION owns literal names; this owns dynamic ones, where a
			// collision would silently replace or shadow a command. Recipes stay unevaluated.
			const spellings = new Set<string>();
			for (const { meta } of entries.values()) {
				spellings.add(meta.name);
				for (const alias of meta.aliases ?? []) spellings.add(alias);
			}
			for (const extension of extensions) {
				for (const definition of extension.commands) {
					const meta = { name: definition.name, ...definition[commandDefinitionInternal].meta };
					const own = [meta.name, ...(meta.aliases ?? [])];
					if (own.some((spelling) => spellings.has(spelling))) {
						throw new CrustError(
							"DEFINITION",
							`Extension "${extension.id}" command "${definition.name}" collides with an existing command`,
							{ subject: "command", name: definition.name, reason: "command-collision" },
						);
					}
					for (const spelling of own) spellings.add(spelling);
					let child: CommandNode | undefined;
					entries.set(definition.name, {
						name: definition.name,
						meta,
						resolve: () =>
							(child ??= materializeCommandDefinition(definition, source, extension.id)),
						definition,
					});
				}
			}
		}
		const prepared: CommandNode = {
			...source,
			meta: { ...source.meta },
			...cloneFlagRegistry(source),
			args: [...source.args],
			subCommands: lazyChildRecord(entries.values(), (entry) =>
				prepare(entry.resolve(), `${path} ${entry.name}`, false),
			),
			addedChildren: undefined,
			contexts: source.contexts.map((context) => ({ ...context })),
			providedContexts: [...source.providedContexts],
			demands: [...source.demands],
			extensions: [...source.extensions],
		};
		for (const { name, def, recursive } of extensionFlags) {
			if (isRoot || recursive) registerFlag(prepared, name, def, "owned");
		}
		// Extension hooks run on every command, so the Contexts they use parse their flags everywhere.
		installContextFlags(prepared, hookContexts);
		// Its providers and flags are final only now: the recipe may `.provide()` after `.use()`,
		// and hook-used Contexts' flags are parsed by every command.
		checkProvidedContextFlags(prepared, [
			...prepared.inheritedDemands,
			...demandedFactories(prepared.demands),
			...hookContexts,
		]);
		applyNodeContextSections(prepared, path, sectionContextsFor(prepared, isRoot));
		freezeNode(prepared);
		return prepared;
	};

	const root = withProviders(node);
	validateContextAvailability(
		root.contexts.map(({ instance }) => instance),
		extensions.flatMap((extension) => [...extension.use, ...extension.provide]),
	);
	return {
		rootNode: prepare(root, node.meta.name, true),
		extensions,
		handlers,
		...(noAction && { noAction }),
		...(renderer && { renderer }),
	};
}

/** Clone, apply Extensions and sections, freeze, and cache ordinary invocation preparation. */
export function prepareInvocation(
	node: CommandNode,
	materializeCommandDefinition: MaterializeCommandDefinition,
): PreparedInvocation {
	const cached = preparedInvocations.get(node);
	if (cached) return cached;

	const prepared = buildExtensionTree(node, materializeCommandDefinition);
	applyExtensionSections(prepared.rootNode, prepared.extensions);
	preparedInvocations.set(node, prepared);
	return prepared;
}

/** An invocation starts from terminal argv or a typed path plus structured values. */
type InvocationInput =
	| { readonly argv: readonly string[] }
	| {
			readonly path: readonly string[];
			readonly input: RunInputPayload;
	  };

interface ResolvedInput {
	argv: readonly string[];
	route: CommandRoute;
	parsed: ArgvParseResult;
}

function resolveArgvInput(root: CommandNode, argv: readonly string[]): ResolvedInput {
	const route = resolveCommand(root, argv);
	return { argv, route, parsed: parseArgs(route.command, route.argv) };
}

/** Resolve a typed path, rejecting any element the router cannot consume as a command. */
export function resolveTypedPath(root: CommandNode, path: readonly string[]): CommandRoute {
	const route = resolveCommand(root, path);
	if (route.argv.length > 0) {
		// An unconsumed path element would otherwise silently run the nearest resolved ancestor.
		// SAFETY: the enclosing length check proves the first element exists.
		throw commandNotFound(route.command, route.argv[0]!, route.commandPath);
	}
	return route;
}

function resolveStructuredInput(
	root: CommandNode,
	path: readonly string[],
	input: RunInputPayload,
): ResolvedInput {
	const route = resolveTypedPath(root, path);
	return { argv: path, route, parsed: parseStructured(route.command, input) };
}

/**
 * Lazy `rootCommand` / `command` projections. Most invocations read only the routed
 * command (help checks `hasAction`) or root metadata (version, update checks), so
 * `rootCommand` projects its children, and runs their pending recipes, only when they
 * are read. Both share one cache, so the routed snapshot is the same object inside
 * the root projection.
 */
function lazySnapshots(
	prepared: PreparedInvocation,
	command: CommandNode,
): { readonly rootCommand: CommandSnapshot; readonly command: CommandSnapshot } {
	const project = createSnapshotProjector(prepared.rootNode);
	return {
		get rootCommand() {
			return project(prepared.rootNode);
		},
		get command() {
			return project(command);
		},
	};
}

/**
 * The flag handler that takes the invocation: eager handlers first, then the flag given
 * first. A negated boolean (`--no-preview`, or only negations of a repeatable one) or a
 * value that failed conversion selects nothing.
 */
function selectHandler(
	handlers: ReadonlyMap<string, BoundHandler>,
	parsed: ArgvParseResult,
	isRoot: boolean,
): BoundHandler | undefined {
	let first: BoundHandler | undefined;
	for (const flag of parsed.flagOrder) {
		const handler = handlers.get(flag);
		const value = parsed.flags[flag];
		if (!handler || (handler.rootOnly && !isRoot) || value === undefined) continue;
		if (
			handler.boolean &&
			(value === false || (Array.isArray(value) && value.every((item) => item === false)))
		) {
			continue;
		}
		if (handler.eager) return handler;
		first ??= handler;
	}
	return first;
}

/**
 * Strict on purpose: an action may return any other async iterable, such as a stream,
 * as its result. `Symbol.asyncIterator` is probed first so an ordinary result's getters
 * (e.g. `next`) are never read here; serialization reads them exactly once.
 */
function isAsyncGenerator(value: unknown): value is AsyncGenerator {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<AsyncGenerator>;
	try {
		return (
			Symbol.asyncIterator in candidate &&
			typeof candidate[Symbol.asyncIterator] === "function" &&
			typeof candidate.next === "function" &&
			typeof candidate.return === "function" &&
			typeof candidate.throw === "function"
		);
	} catch {
		// A result whose properties throw when read (e.g. a strict Proxy) is an ordinary result.
		return false;
	}
}

/** One invocation's action events: the caller's live callback, and every event once a generator action starts. */
interface ActionEventStream {
	readonly onEvent?: ((event: unknown) => void) | undefined;
	events?: unknown[];
}

/** Resolve, parse, and run one invocation without rendering failures. */
async function dispatch(
	input: InvocationInput,
	prepared: PreparedInvocation,
	output: InvocationOutput,
	signal: AbortSignal,
	stream: ActionEventStream,
	onExtensionContext?: (context: ExtensionContext) => void,
	onFailure?: (error: CaughtError, context: ExtensionContext) => Promise<ExtensionId | undefined>,
): Promise<
	| { status: "completed"; result: unknown; events?: readonly unknown[] }
	| { status: "handled"; by: ExtensionId }
> {
	const { rootNode, extensions } = prepared;
	// Nothing to wait for without a selector: action-side output stays immediate and in order.
	if (!prepared.renderer) output.choose(undefined);

	// Routing and syntax parsing — failures flow directly to the caller. Value errors
	// wait in `parsed.valueErrors` for `terminal()`, so a `--help` handler still wins.
	const { argv, route, parsed } =
		"argv" in input
			? resolveArgvInput(rootNode, input.argv)
			: resolveStructuredInput(rootNode, input.path, input.input);
	const resolvedNode = route.command;
	// `bindInput` replaces this; hooks and `terminal()` read it live.
	let bound = parsed;

	// One resource scope and resolver span pre-run, the action, and post-run.
	await using disposal = new AsyncDisposableStack();
	const contexts = resolvedNode.contexts.map(({ instance }) => instance);
	const resolver = createContextResolver(
		contexts,
		resolvedNode.flagContexts,
		output.routed,
		disposal,
		signal,
	);

	const snapshots = lazySnapshots(prepared, resolvedNode);
	// Setups register cleanup only while they run; one shared object keeps per-invocation
	// identity (e.g. WeakMap keys) from setup through onError.
	let settingUp = false;
	const extensionContext: ExtensionSetupContext = Object.freeze({
		argv: [...argv],
		get rootCommand() {
			return snapshots.rootCommand;
		},
		get command() {
			return snapshots.command;
		},
		commandPath: Object.freeze([...route.commandPath]),
		commandPathOf: (definition: CommandDefinition) => commandPathOf(rootNode, definition),
		get args() {
			return bound.args;
		},
		get flags() {
			return bound.flags;
		},
		get rawArgs() {
			return bound.rawArgs;
		},
		get sources() {
			return bound.sources;
		},
		signal,
		ctx: resolver.bag(extensions.flatMap((extension) => extension.use)),
		bindInput(payload: RunInputPayload) {
			bound = bindStructuredInput(resolvedNode, parsed, payload);
		},
		stdout: output.io.stdout,
		stderr: output.io.stderr,
		defer(cleanup: () => void | PromiseLike<void>) {
			if (!settingUp) {
				throw new CrustError(
					"DEFINITION",
					"Extension cleanup can only be registered while Extension setups run.",
					{ subject: "extension", reason: "extension-defer-after-setup" },
				);
			}
			disposal.defer(cleanup);
		},
	});
	onExtensionContext?.(extensionContext);

	const terminal = async () => {
		validateParsed(resolvedNode, bound);

		// Standard Schemas on arg/flag definitions own value validation and
		// transformation; actions and flag-owning Contexts receive schema outputs.
		const validated = await applySchemas(resolvedNode, bound);
		resolver.setValidatedFlags(validated.flags);

		let result: unknown;
		if (resolvedNode.run) {
			const context = {
				args: validated.args,
				flags: validated.flags,
				ctx: resolver.bag(contexts),
				rawArgs: bound.rawArgs,
				signal,
				get command() {
					return snapshots.command;
				},
				get rootCommand() {
					return snapshots.rootCommand;
				},
				stdout: output.routed.stdout,
				stderr: output.routed.stderr,
			} satisfies CrustCommandContext;
			result = await resolvedNode.run(context);
			if (isAsyncGenerator(result)) result = await drain(result, (stream.events = []));
		}
		// An actionless command's `undefined` result still meets its `.output()` contract.
		const checked = resolvedNode.outputSchema
			? await applyOutputSchema(resolvedNode.outputSchema, result)
			: result;
		// A renderer only sees results of an action that ran.
		if (resolvedNode.run) output.renderer?.result?.(checked);
		return checked;
	};

	/** Deliver each yielded event live and return the generator's `return` value. */
	const drain = async (generator: AsyncGenerator, events: unknown[]): Promise<unknown> => {
		let done = false;
		try {
			output.renderer?.stream?.();
			for (;;) {
				signal.throwIfAborted();
				const step = await generator.next();
				done = step.done === true;
				// Also after the step: an abort during the final step must not complete the invocation.
				signal.throwIfAborted();
				if (step.done) return step.value;
				events.push(step.value);
				output.renderer?.event?.(step.value);
				stream.onEvent?.(step.value);
			}
		} catch (error) {
			if (done) throw error;
			// Runs the generator's own `finally` on abort or a throwing consumer; a no-op once it threw.
			// A `finally` that yields suspends `return()`, so resume it to the end; values it
			// yields while closing are not events.
			try {
				for (let step = await generator.return(undefined); !step.done;) {
					step = await generator.next();
				}
			} catch (closeError) {
				// Same shape as a failed disposal: the cleanup failure wraps the original as `suppressed`.
				throw new SuppressedError(closeError, error, "Closing the action's generator failed.");
			}
			throw error;
		}
	};

	let outcome: InvocationOutcome;
	try {
		try {
			// Setups only configure, so their order cannot change what runs. Their cleanups share
			// the disposal stack with Contexts: a Context a setup pulled is disposed after it.
			settingUp = true;
			try {
				for (const extension of extensions) await extension.hooks.setup?.(extensionContext);
			} catch (error) {
				settingUp = false;
				// Flags are bound, so the selector still chooses how a setup failure renders. The setup
				// failure is the root cause: a failing selector or flush must not replace it.
				try {
					if (prepared.renderer) output.choose(await prepared.renderer.select(extensionContext));
				} catch {
					// No renderer yet means the default below; a chosen one still renders the failure.
				}
				throw error;
			} finally {
				settingUp = false;
			}
			// After every setup, so the selector sees what setups bound; before any handler output.
			if (prepared.renderer) output.choose(await prepared.renderer.select(extensionContext));
			const handler =
				selectHandler(prepared.handlers, parsed, resolvedNode === rootNode) ??
				(resolvedNode.run ? undefined : prepared.noAction);
			if (handler) {
				await handler.run(extensionContext);
				outcome = { status: "handled", by: handler.by };
			} else {
				// Gates such as login checks precede only an action, never `--help` or a fallback.
				if (resolvedNode.run) {
					for (const extension of extensions) await extension.hooks.preRun?.(extensionContext);
				}
				const result = await terminal();
				outcome = { status: "completed", result, ...eventsOf(stream) };
			}
		} catch (error) {
			// A failing selector leaves no renderer: the failure and the output waiting for it render by default.
			if (!output.renderer) output.choose(undefined);
			const by = await onFailure?.(error, extensionContext);
			outcome = {
				status: "failed",
				error,
				...(by === undefined ? {} : { by }),
				...eventsOf(stream),
			};
		}

		// Frozen so a mutating post-run hook cannot rewrite the outcome Core
		// trusts below (e.g. flipping "failed" to "completed" to mask an error).
		Object.freeze(outcome);

		let postRunFailure: { error: CaughtError } | undefined;
		for (const extension of extensions.toReversed()) {
			try {
				await extension.hooks?.postRun?.(extensionContext, outcome);
			} catch (error) {
				if (outcome.status !== "failed") postRunFailure ??= { error };
			}
		}

		if (outcome.status === "failed") throw outcome.error;
		if (postRunFailure) throw postRunFailure.error;
	} finally {
		// A rejected sibling pull can leave another setup in flight; wait for it
		// so its value registers its disposer before the disposal scope exits.
		await resolver.settle();
	}
	return outcome.status === "handled"
		? { status: "handled", by: outcome.by }
		: { status: "completed", result: outcome.result, ...eventsOf(stream) };
}

/** `events` only after a generator action started: its presence is what marks one. */
function eventsOf(stream: ActionEventStream): { readonly events?: readonly unknown[] } {
	return stream.events ? { events: Object.freeze(stream.events) } : {};
}

/** Render one failure through Extension onError hooks, ending in the Renderer's `error` or Core's default. */
async function renderFailure(
	error: CaughtError,
	argv: readonly string[],
	prepared: PreparedInvocation,
	output: InvocationOutput,
	signal: AbortSignal,
	extensionContext: ExtensionContext | undefined,
): Promise<ExtensionId | undefined> {
	// Reuse the dispatch context so per-invocation identity (e.g. WeakMap keys
	// set in preRun) survives into onError. During dispatch its Contexts remain
	// live through postRun; errors raised after cleanup see the closed resolver.
	// The synthetic fallback exists only for failures before a context was built.
	let context = extensionContext;
	if (!context) {
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
		// Routing is pure, so redoing it recovers the command whose argv failed to parse.
		let route: CommandRoute | undefined;
		try {
			route = resolveCommand(prepared.rootNode, argv);
		} catch {
			// Routing itself failed: the root stands in, as documented on `ExtensionContext.command`.
		}
		const snapshots = lazySnapshots(prepared, route?.command ?? prepared.rootNode);
		context = Object.freeze({
			argv: [...argv],
			get rootCommand() {
				return snapshots.rootCommand;
			},
			get command() {
				return snapshots.command;
			},
			commandPath: Object.freeze(route ? [...route.commandPath] : [prepared.rootNode.meta.name]),
			commandPathOf: (definition) => commandPathOf(prepared.rootNode, definition),
			args: Object.freeze({}),
			flags: Object.freeze({}),
			rawArgs: [],
			sources: Object.freeze({ args: Object.freeze({}), flags: Object.freeze({}), raw: undefined }),
			signal,
			stdout: output.io.stdout,
			stderr: output.io.stderr,
			// No action runs after a failure this early, so there is nothing to bind.
			bindInput() {},
			ctx: unavailableContext,
		} satisfies ExtensionContext);
	}

	try {
		for (const extension of prepared.extensions) {
			if (await extension.hooks?.onError?.(error, context)) return extension.id;
		}
	} catch {
		// Rendering must not hide the original invocation failure.
	}
	// A user abort is not an error to report unless an onError hook claims it. Cleanup
	// that failed while unwinding it renders as Core's default lines: a Renderer's
	// `error` never receives a cancellation.
	const cleanupFailures = cancellationCleanupFailures(error);
	if (cleanupFailures) {
		for (const failure of cleanupFailures) output.io.stderr(describeFailure(failure));
		return undefined;
	}
	const renderer = output.renderer;
	if (renderer?.error) {
		try {
			renderer.error(error);
			return undefined;
		} catch {
			// As with onError: rendering must not hide the original invocation failure.
		}
	}
	output.io.stderr(describeFailure(error));
	return undefined;
}

/** Explicitly injected IO opts an invocation into the ambient terminal scope. */
function hasInjectedIO(io: Partial<InvocationIO> | undefined): boolean {
	return io !== undefined && Object.keys(io).length > 0;
}

/** Quiet programmatic boundary: capture output and the failure escaping the complete lifecycle. */
export async function runInvocation(
	node: CommandNode,
	input: InvocationInput,
	options: InvocationOptions | undefined,
	materializeCommandDefinition: MaterializeCommandDefinition,
): Promise<ShapeRunOutcome<CommandShape>> {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const stream: ActionEventStream = { onEvent: options?.onEvent };
	try {
		// Keep the same per-invocation callback snapshot semantics as execute.
		const { signal = new AbortController().signal, ...sinks } = options ?? {};
		const resolvedIO: InvocationIO = {
			stdout(text) {
				stdout.push(text);
				sinks.stdout?.(text);
			},
			stderr(text) {
				stderr.push(text);
				sinks.stderr?.(text);
			},
		};
		const outcome = await withAmbientTerminalIO(resolvedIO, async () => {
			const prepared = prepareInvocation(node, materializeCommandDefinition);
			return await dispatch(input, prepared, createInvocationOutput(resolvedIO), signal, stream);
		});
		return { ...outcome, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
	} catch (error) {
		return {
			status: "failed",
			error,
			...eventsOf(stream),
			stdout: stdout.join("\n"),
			stderr: stderr.join("\n"),
		};
	}
}

/** Terminal CLI boundary: render failures and set the process exit status. */
/** Terminal CLI boundary: render failures and set the process exit status. */
export async function executeInvocation(
	node: CommandNode,
	options: ExecuteOptions | undefined,
	materializeCommandDefinition: MaterializeCommandDefinition,
): Promise<number> {
	const argv = options?.argv ?? process.argv.slice(2);
	const io: InvocationIO = { ...DEFAULT_IO, ...options?.io };
	// One controller per invocation so SIGINT and a caller signal share `ctx.signal`.
	const controller = new AbortController();
	const signal = options?.signal
		? AbortSignal.any([options.signal, controller.signal])
		: controller.signal;
	// Literal property access, no destructuring: `crust build` defines the marker
	// as `"1"`, so bundlers fold this to `undefined` and drop the snapshot branch.
	const snapshotPath =
		process.env.CRUST_INTERNAL_BUILD === "1" ? undefined : process.env[SNAPSHOT_PATH_ENV];

	if (snapshotPath) {
		try {
			// Build-only (crust build sets the path), so every other run skips loading it.
			const { writeSnapshotProtocol } = await import("./snapshot-protocol.ts");
			await writeSnapshotProtocol(node, snapshotPath, materializeCommandDefinition);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			io.stderr(message);
			return process.exit(1);
		}
		return process.exit(0);
	}

	const invoke = async (): Promise<number> => {
		let prepared: PreparedInvocation;
		try {
			prepared = prepareInvocation(node, materializeCommandDefinition);
		} catch (error) {
			// Extension-application failures render directly: hooks belong to
			// Extensions that just failed to apply.
			if (isAbortError(error)) {
				process.exitCode = EXIT_CODE_CANCELLED;
				return EXIT_CODE_CANCELLED;
			}
			io.stderr(describeFailure(error));
			process.exitCode = 1;
			return 1;
		}

		// Persistent, not `once`: spinner-style one-shot listeners re-raise SIGINT only when nobody listens.
		let interruptedAt = Number.NEGATIVE_INFINITY;
		const onSigint = (): void => {
			if (!controller.signal.aborted) {
				interruptedAt = performance.now();
				controller.abort(new DOMException("Interrupted by SIGINT.", "AbortError"));
				return;
			}
			// `npm run`, `npx`, `bun run`, and pnpm relay the terminal's SIGINT to their child as well
			// (npm/cli#8164), so one Ctrl-C arrives twice within a millisecond; a person pressing
			// twice takes far longer.
			if (performance.now() - interruptedAt < RELAYED_SIGINT_WINDOW_MS) return;
			process.removeListener("SIGINT", onSigint);
			if (process.listenerCount("SIGINT") === 0) process.kill(process.pid, "SIGINT");
		};
		// An inherited ignore (background job) stays: listening would make SIGINT fatal again.
		if (!isSignalIgnored("SIGINT")) process.on("SIGINT", onSigint);

		const output = createInvocationOutput(io);
		let extensionContext: ExtensionContext | undefined;
		let rendered: { error: CaughtError } | undefined;
		try {
			await dispatch(
				{ argv },
				prepared,
				output,
				signal,
				{ onEvent: options?.onEvent },
				(context) => {
					extensionContext = context;
				},
				async (error, context) => {
					rendered = { error };
					const cancelled = cancellationCleanupFailures(error) !== undefined;
					process.exitCode = cancelled ? EXIT_CODE_CANCELLED : 1;
					return renderFailure(error, argv, prepared, output, signal, context);
				},
			);
		} catch (error) {
			// Disposal wraps the failure rendered above as `suppressed` (Object.is: the
			// body may have thrown NaN or any primitive). Render only the cleanup side;
			// onError hooks already ran and never saw it.
			let cleanupFailure: { error: unknown } | undefined;
			try {
				if (
					rendered &&
					!Object.is(error, rendered.error) &&
					isSuppressedError(error) &&
					Object.is(error.suppressed, rendered.error)
				) {
					cleanupFailure = { error: error.error };
				}
			} catch {
				// A throwing getter on an arbitrary thrown value must not replace the failure.
			}
			if (cleanupFailure) io.stderr(describeFailure(cleanupFailure.error, "Cleanup failed"));
			// Cancellation keeps exit code 130 even when cleanup failed while unwinding it
			// (callers such as shell loops must still see the interrupt). Core always
			// preserves a nonzero failure outcome, regardless of what onError hooks do.
			const exitCode = cancellationCleanupFailures(error) === undefined ? 1 : EXIT_CODE_CANCELLED;
			process.exitCode = exitCode;
			if (!rendered) {
				await renderFailure(error, argv, prepared, output, signal, extensionContext);
				// Reassert: a presentation hook may have reassigned process.exitCode.
				process.exitCode = exitCode;
			}
			return exitCode;
		} finally {
			process.removeListener("SIGINT", onSigint);
		}
		return 0;
	};

	return await (hasInjectedIO(options?.io) ? withAmbientTerminalIO(io, invoke) : invoke());
}
