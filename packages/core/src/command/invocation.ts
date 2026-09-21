import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, posix, win32 } from "node:path";

import { BUILD_OUT_DIR_ENV } from "@crustjs/utils/artifacts";
import { withAmbientTerminalIO } from "@crustjs/utils/terminal";

import { createContextResolver, DisposalStack } from "../api/context.ts";
import {
	finishInvocation,
	type BuildReport,
	type Extension,
	type ExtensionContext,
	type InvocationOutcome,
} from "../api/extension.ts";
import { CrustError, type CaughtError } from "../errors.ts";
import type { ExtensionId } from "../identity.ts";
import {
	parseArgs,
	parseStructured,
	validateParsed,
	type RunInputPayload,
} from "../parsing/parser.ts";
import { applySchemas } from "../parsing/schema.ts";
import { isListed } from "../sections.ts";
import type { ExecuteOptions, InvocationIO, InvocationOptions, ParseResult } from "../types.ts";
import type { CrustCommandContext, RunOutcome } from "./crust.ts";
import {
	applyExtensionCommands,
	applyExtensionFlags,
	applyExtensionSections,
	cloneCommandNode,
	type MaterializeCommandDefinition,
} from "./extensions-install.ts";
import type { CommandNode } from "./node.ts";
import { resolveCommand, type CommandRoute } from "./router.ts";
import { snapshotCommand } from "./snapshot.ts";

const ignoreStreamError = () => {};

/**
 * Line-oriented write to a process stream, with `console.log`'s error tolerance: a
 * downstream that closed early (`cli | head`) surfaces as EPIPE, synchronously or as a
 * later `error` event, and must not crash the CLI. Mirrors Node's Console
 * (`ignoreErrors: true`): a noop listener absorbs the event when nobody else listens.
 */
function writeLine(stream: NodeJS.WriteStream, text: string): void {
	const absorb = () => {
		if (stream.listenerCount("error") === 0) stream.once("error", ignoreStreamError);
	};
	try {
		absorb();
		stream.write(`${text}\n`, (error) => {
			if (error) absorb();
		});
	} catch {
		// Synchronous write failure on an already-destroyed stream.
	} finally {
		// Async failures install their own one-shot listener in the write callback.
		stream.removeListener("error", ignoreStreamError);
	}
}

/**
 * Terminal defaults: stream writes rather than `console.log`. Once anything materializes
 * `process.stdout` (a platform layer, a color library probing `isTTY`), Bun's native
 * console writer silently drops output past the 64 KiB pipe buffer at exit
 * (oven-sh/bun#36419); the stream writer flushes it.
 */
const DEFAULT_IO: InvocationIO = {
	stdout: (text) => writeLine(process.stdout, text),
	stderr: (text) => writeLine(process.stderr, text),
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
 * build output directory is set, writes its final JSON snapshot and Build Report, and exits
 * without dispatching a Command Action. In-process callers use `Crust.snapshot()`.
 *
 * Only source entries run by `crust build` honor it: finished Bun/Node bundles carry
 * `process.env.CRUST_INTERNAL_BUILD === "1"` as a literal and compile the protocol out.
 */
export const SNAPSHOT_PATH_ENV = "CRUST_INTERNAL_SNAPSHOT_PATH";
const EXIT_CODE_CANCELLED = 130;

function isAbortError(error: CaughtError): boolean {
	if (!(error instanceof Error)) return false;
	return error.name === "AbortError";
}

/**
 * Structural: Node 22 bundles down-level `await using` to a plain `Error`
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
			} else {
				// SAFETY: structural probe of an arbitrary thrown value; reads are protected by this try block.
				const members = (value as Partial<{ errors: unknown }> | null)?.errors;
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

function freezeTree(node: CommandNode): void {
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
	for (const sub of Object.values(node.subCommands)) freezeTree(sub);
	Object.freeze(node.subCommands);
}

function isSymbol<T>(value: T): value is T & symbol {
	return typeof value === "symbol";
}

function normalizeArtifactPath(path: string): string {
	const normalized = posix.normalize(path.replaceAll("\\", "/"));
	const drivePrefix = /^[A-Za-z]:/;
	if (
		posix.isAbsolute(normalized) ||
		win32.isAbsolute(path) ||
		win32.isAbsolute(normalized) ||
		drivePrefix.test(path) ||
		drivePrefix.test(normalized)
	) {
		throw new Error(`Artifact path "${path}" must be relative to outDir.`);
	}
	if (normalized === ".." || normalized.startsWith("../")) {
		throw new Error(`Artifact path "${path}" escapes outDir.`);
	}
	if (normalized === "." || normalized === "./") {
		throw new Error(`Artifact path "${path}" must name a file inside outDir.`);
	}
	return normalized;
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

	return { rootNode, extensions };
}

/** Evaluate Extension section callbacks against current state and freeze the tree. */
function applySectionsAndFreeze(
	rootNode: CommandNode,
	extensions: readonly Extension[],
): CommandNode {
	// The authored snapshot exists only to feed section callbacks; projecting the
	// whole tree when nothing consumes it is wasted work on every fresh preparation.
	if (extensions.some((extension) => extension.sections !== undefined)) {
		const authoredSnapshot = snapshotCommand(rootNode);
		for (const extension of extensions) {
			applyExtensionSections(rootNode, extension, authoredSnapshot);
		}
	}
	freezeTree(rootNode);
	return rootNode;
}

/** Clone, apply Extensions and sections, freeze, and cache ordinary invocation preparation. */
export function prepareInvocation(
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

/** An invocation starts from terminal argv or a typed path plus structured values. */
export type InvocationInput =
	| { readonly argv: readonly string[] }
	| {
			readonly path: readonly string[];
			readonly input: RunInputPayload;
	  };

interface ResolvedInput {
	argv: readonly string[];
	route: CommandRoute;
	parsed: ParseResult;
}

function resolveArgvInput(root: CommandNode, argv: readonly string[]): ResolvedInput {
	const route = resolveCommand(root, [...argv]);
	return { argv, route, parsed: parseArgs(route.command, route.argv) };
}

/** Resolve a typed path, rejecting any element the router cannot consume as a command. */
export function resolveTypedPath(root: CommandNode, path: readonly string[]): CommandRoute {
	const route = resolveCommand(root, [...path]);
	if (route.argv.length > 0) {
		// An unconsumed path element would otherwise silently run the nearest resolved ancestor.
		// SAFETY: the enclosing length check proves the first element exists.
		const candidate = route.argv[0]!;
		const parentCommand = snapshotCommand(route.command);
		throw new CrustError("COMMAND_NOT_FOUND", `Unknown command "${candidate}".`, {
			input: candidate,
			available: Object.entries(parentCommand.subCommands).flatMap(([name, child]) =>
				isListed(child) ? [name] : [],
			),
			commandPath: route.commandPath,
			parentCommand,
		});
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

/** Resolve, parse, and run one invocation without rendering failures. */
async function dispatch(
	input: InvocationInput,
	prepared: PreparedInvocation,
	io: InvocationIO,
	signal: AbortSignal,
	onExtensionContext?: (context: ExtensionContext) => void,
	onFailure?: (error: CaughtError, context: ExtensionContext) => Promise<ExtensionId | undefined>,
): Promise<{ status: "completed"; result: unknown } | { status: "finished"; by: ExtensionId }> {
	const { rootNode, extensions } = prepared;

	// Routing and syntax parsing — failures flow directly to the caller.
	const { argv, route, parsed } =
		"argv" in input
			? resolveArgvInput(rootNode, input.argv)
			: resolveStructuredInput(rootNode, input.path, input.input);
	const resolvedNode = route.command;

	// One resource scope and resolver span pre-run, the action, and post-run.
	// DisposalStack (not the bare global): Node 22 has no AsyncDisposableStack.
	await using disposal = new DisposalStack();
	const contexts = resolvedNode.contexts.map(({ instance }) => instance);
	const resolver = createContextResolver(contexts, io, disposal, signal);

	const rootSnapshot = snapshotCommand(rootNode);
	// The root projection already contains the resolved subtree; walk to it along
	// the canonical route instead of projecting the same nodes a second time.
	let commandSnapshot = rootSnapshot;
	for (const name of route.commandPath.slice(1)) {
		// SAFETY: the router only records canonical names of children it descended into.
		commandSnapshot = commandSnapshot.subCommands[name]!;
	}
	const extensionContext: ExtensionContext = Object.freeze({
		argv: [...argv],
		rootCommand: rootSnapshot,
		command: commandSnapshot,
		commandPath: Object.freeze([...route.commandPath]),
		args: parsed.args,
		flags: parsed.flags,
		rawArgs: parsed.rawArgs,
		signal,
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
			ctx: resolver.bag(contexts),
			rawArgs: parsed.rawArgs,
			signal,
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
	signal: AbortSignal,
	extensionContext: ExtensionContext | undefined,
	silentDefault = false,
): Promise<ExtensionId | undefined> {
	const renderDefault = (): void => {
		// Cancellation (AbortError) has no default rendering — a user abort
		// is not an error to report unless an onError hook claims it.
		if (silentDefault) return;
		io.stderr(describeFailure(error));
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
	let context = extensionContext;
	if (!context) {
		const rootSnapshot = snapshotCommand(prepared.rootNode);
		context = Object.freeze({
			argv: [...argv],
			rootCommand: rootSnapshot,
			command: rootSnapshot,
			commandPath: Object.freeze([prepared.rootNode.meta.name]),
			args: Object.freeze({}),
			flags: Object.freeze({}),
			rawArgs: [],
			signal,
			finish: finishInvocation,
			stdout: io.stdout,
			stderr: io.stderr,
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
	renderDefault();
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
): Promise<RunOutcome<unknown>> {
	const stdout: string[] = [];
	const stderr: string[] = [];
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
			return await dispatch(input, prepared, resolvedIO, signal);
		});
		return { ...outcome, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
	} catch (error) {
		return { status: "failed", error, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
	}
}

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
			// Commands and flags materialize once so recipes keep their
			// once-per-`.add()` lifecycle; only section callbacks re-evaluate.
			const base = buildExtensionTree(node, materializeCommandDefinition);
			const takeSnapshot = () =>
				snapshotCommand(applySectionsAndFreeze(cloneCommandNode(base.rootNode), base.extensions));
			let snapshot = takeSnapshot();
			const buildOutDir = process.env[BUILD_OUT_DIR_ENV];
			if (buildOutDir) {
				const extensions: Array<BuildReport["extensions"][number]> = [];
				// Keyed case-insensitively: the tree may land on a case-insensitive filesystem
				// where `Config.json` and `config.json` are one file and the second write wins.
				const owners = new Map<string, { id: ExtensionId; path: string }>();
				for (const extension of base.extensions) {
					if (!extension.build) continue;
					try {
						const artifacts = await extension.build({ snapshot });
						// Every path is checked before any file is written, so a rejected hook leaves nothing behind.
						const files = artifacts.map((file) => {
							const path = normalizeArtifactPath(file.path);
							const key = path.toLowerCase();
							// A file and a directory cannot share a name, so an ancestor or descendant
							// of an owned path collides just like an equal one.
							for (const [ownedKey, owner] of owners) {
								if (
									ownedKey === key ||
									ownedKey.startsWith(`${key}/`) ||
									key.startsWith(`${ownedKey}/`)
								) {
									throw new Error(
										`Artifact path "${path}" collides with "${owner.path}" produced by Extension "${owner.id}".`,
									);
								}
							}
							owners.set(key, { id: extension.id, path });
							return { path, content: file.content };
						});
						// ponytail: in-memory files; stream if an extension ever ships large binaries
						for (const file of files) {
							const target = join(buildOutDir, file.path);
							await mkdir(dirname(target), { recursive: true });
							await writeFile(target, file.content);
						}
						extensions.push({ id: extension.id, files: files.map((file) => file.path) });
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						throw new Error(`Extension "${extension.id}" build failed: ${message}`, {
							cause: error,
						});
					}
					// The hook sees the snapshot from before it starts; re-evaluating sections
					// after its files are on disk lets later hooks observe its outputs without
					// mutating the frozen tree.
					snapshot = takeSnapshot();
				}
				await writeFile(
					join(dirname(snapshotPath), "build-report.json"),
					JSON.stringify({ extensions } satisfies BuildReport),
				);
			}
			await writeFile(snapshotPath, JSON.stringify(snapshot));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(message);
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
		const onSigint = (): void => {
			if (!controller.signal.aborted) {
				controller.abort(new DOMException("Interrupted by SIGINT.", "AbortError"));
				return;
			}
			process.removeListener("SIGINT", onSigint);
			if (process.listenerCount("SIGINT") === 0) process.kill(process.pid, "SIGINT");
		};
		process.on("SIGINT", onSigint);

		let extensionContext: ExtensionContext | undefined;
		let renderedInDispatch = false;
		let renderedError: CaughtError;
		try {
			await dispatch(
				{ argv },
				prepared,
				io,
				signal,
				(context) => {
					extensionContext = context;
				},
				async (error, context) => {
					renderedInDispatch = true;
					renderedError = error;
					const cancelled = isAbortError(error);
					process.exitCode = cancelled ? EXIT_CODE_CANCELLED : 1;
					return renderFailure(error, argv, prepared, io, signal, context, cancelled);
				},
			);
		} catch (error) {
			// Disposal wraps the failure rendered above as `suppressed` (Object.is: the
			// body may have thrown NaN or any primitive). Render only the cleanup side;
			// onError hooks already ran and never saw it. A SuppressedError is never an
			// AbortError, so cancellation with failed cleanup keeps exit code 1 below.
			let cleanupFailure: { error: unknown } | undefined;
			try {
				if (
					renderedInDispatch &&
					!Object.is(error, renderedError) &&
					isSuppressedError(error) &&
					Object.is(error.suppressed, renderedError)
				) {
					cleanupFailure = { error: error.error };
				}
			} catch {
				// A throwing getter on an arbitrary thrown value must not replace the failure.
			}
			if (cleanupFailure) io.stderr(describeFailure(cleanupFailure.error, "Cleanup failed"));
			if (isAbortError(error)) {
				// Cancellation keeps its dedicated exit code while allowing Extension
				// onError hooks to render a message. Core's default stays silent.
				if (!renderedInDispatch) {
					await renderFailure(error, argv, prepared, io, signal, extensionContext, true);
				}
				process.exitCode = EXIT_CODE_CANCELLED;
				return EXIT_CODE_CANCELLED;
			}
			// Core always preserves a nonzero failure outcome, regardless of
			// what Extension onError hooks do.
			process.exitCode = 1;
			if (!renderedInDispatch) {
				await renderFailure(error, argv, prepared, io, signal, extensionContext);
			}
			return 1;
		} finally {
			process.removeListener("SIGINT", onSigint);
		}
		return 0;
	};

	return await (hasInjectedIO(options?.io) ? withAmbientTerminalIO(io, invoke) : invoke());
}
