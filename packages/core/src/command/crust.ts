import {
	buildContexts,
	type ContextInstance,
	type ContextMap,
	type ContextOutput,
	type MergeContext,
} from "../api/context.ts";
import type {
	Extension,
	ExtensionContext,
	ExtensionErrorHandler,
	ExtensionIntercept,
} from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import { parseArgs, validateParsed } from "../parsing/parser.ts";
import { validateIncomingAliases } from "../parsing/validation.ts";
import type {
	ArgsDef,
	CommandMeta,
	EffectiveFlags,
	FlagDef,
	FlagsDef,
	InferArgs,
	InferFlags,
	ValidateFlagAliases,
	ValidateNoPrefixedFlags,
	ValidateVariadicArgs,
} from "../types.ts";
import { type CommandNode, computeEffectiveFlags, createCommandNode } from "./node.ts";
import { resolveCommand } from "./router.ts";
import { type CommandSnapshot, snapshotCommand } from "./snapshot.ts";

// ────────────────────────────────────────────────────────────────────────────
// CrustCommandContext — Runtime context for lifecycle hooks
// ────────────────────────────────────────────────────────────────────────────

/**
 * The runtime context object passed to the Command Handler defined with
 * `.handle()`.
 *
 * Generic parameters:
 * - `A` — positional argument definitions tuple
 * - `F` — the effective (inherited + local merged) flag definitions
 */
export interface CrustCommandContext<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
	Ctx extends ContextMap = {},
> {
	/** Resolved positional arguments, keyed by arg name */
	args: InferArgs<A>;
	/** Resolved flags, keyed by flag name */
	flags: InferFlags<F>;
	/** Context values attached with `.provide()` */
	ctx: Readonly<Ctx>;
	/** Raw arguments that appeared after the `--` separator */
	rawArgs: string[];
	/** Readonly, serializable snapshot of the resolved command */
	command: CommandSnapshot;
	/** Write a line of standard output (injectable text callback) */
	stdout: (text: string) => void;
	/** Write a line of diagnostic output (injectable text callback) */
	stderr: (text: string) => void;
}

/** Injectable output callbacks threaded through one invocation. */
interface InvocationIO {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
}

/** Terminal defaults: line-oriented writes to the process streams. */
function defaultIO(): InvocationIO {
	return {
		stdout: (text) => console.log(text),
		stderr: (text) => console.error(text),
	};
}

/** Output of `_prepare`: one cloned, extension-applied, frozen tree. */
interface PreparedInvocation {
	rootNode: CommandNode;
	extensions: readonly Extension[];
	/** Names of Extension-owned root commands (inputs validated pre-hook) */
	ownedCommands: ReadonlySet<string>;
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers — runtime flag validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Runtime guard: reject flag names starting with "no-".
 * Mirrors the compile-time `ValidateNoPrefixedFlags` type.
 */
function validateNoPrefixFlags(flags: FlagsDef): void {
	for (const [name, def] of Object.entries(flags)) {
		if (name.startsWith("no-")) {
			const base = name.slice(3);
			throw new CrustError(
				"DEFINITION",
				`Flag "--${name}" must not use "no-" prefix; define "${base}" and negate with "--no-${base}"`,
			);
		}
		if (def.short?.startsWith("no-")) {
			throw new CrustError(
				"DEFINITION",
				`Short alias "-${def.short}" on "--${name}" must not use "no-" prefix (reserved for negation)`,
			);
		}
		if (def.aliases) {
			for (const alias of def.aliases) {
				if (alias.startsWith("no-")) {
					throw new CrustError(
						"DEFINITION",
						`Alias "--${alias}" on "--${name}" must not use "no-" prefix (reserved for negation)`,
					);
				}
			}
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers — execution pipeline
// ────────────────────────────────────────────────────────────────────────────

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

/** Key for storing validation result on globalThis (for in-process tests) */
const VALIDATION_RESULT_GLOBAL_KEY = "__CRUST_VALIDATE_RESULT__";

function isAbortError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	return error.name === "AbortError";
}

function applyInheritedFlagsToSubtree(node: CommandNode, inheritedFlags: FlagsDef): void {
	node.effectiveFlags = computeEffectiveFlags(inheritedFlags, node.localFlags);

	for (const sub of Object.values(node.subCommands)) {
		applyInheritedFlagsToSubtree(sub, node.effectiveFlags);
	}
}

/**
 * Inject an Extension-owned flag into a node's effective flags (and, when
 * `recursive`, into every descendant). Name collisions with application or
 * other Extension definitions are definition errors (ADR-0001).
 */
function injectExtensionFlag(
	node: CommandNode,
	name: string,
	def: FlagDef,
	recursive: boolean,
	extensionName: string,
): void {
	if (name in node.effectiveFlags) {
		throw new CrustError(
			"DEFINITION",
			`Extension "${extensionName}" flag "--${name}" collides with an existing flag on "${node.meta.name}"`,
			{ subject: "flag", name, reason: "extension-flag-collision" },
		);
	}
	// Alias/short collisions are definition errors too (ADR-0001)
	const incoming = new Set(
		[def.short, ...(def.aliases ?? [])].filter((alias): alias is string => alias !== undefined),
	);
	if (incoming.size > 0) {
		for (const [existingName, existing] of Object.entries(node.effectiveFlags)) {
			for (const alias of [existing.short, ...(existing.aliases ?? [])]) {
				if (alias !== undefined && incoming.has(alias)) {
					throw new CrustError(
						"DEFINITION",
						`Extension "${extensionName}" flag "--${name}" alias "${alias}" collides with flag "--${existingName}" on "${node.meta.name}"`,
						{ subject: "flag", name, reason: "extension-flag-collision" },
					);
				}
			}
		}
	}
	node.effectiveFlags[name] = def;
	if (!recursive) return;
	for (const sub of Object.values(node.subCommands)) {
		injectExtensionFlag(sub, name, def, true, extensionName);
	}
}

/** Attach one Extension's owned root commands to a cloned tree. */
function applyExtensionCommands(root: CommandNode, ext: Extension): void {
	for (const builder of ext.commands ?? []) {
		const name = builder._node.meta.name;
		if (root.subCommands[name]) {
			throw new CrustError(
				"DEFINITION",
				`Extension "${ext.name}" command "${name}" collides with an existing root command`,
				{ subject: "command", name, reason: "extension-command-collision" },
			);
		}
		// Alias collisions with existing root commands are definition errors too
		validateIncomingAliases(
			{ canonicalName: name, aliases: builder._node.meta.aliases },
			root.subCommands,
			name,
		);
		const node = deepCloneCommandNode(builder._node);
		applyInheritedFlagsToSubtree(node, root.effectiveFlags);
		root.subCommands[name] = node;
	}
}

/** Inject one Extension's owned flags across a cloned tree. */
function applyExtensionFlags(root: CommandNode, ext: Extension): void {
	for (const [name, defWithScope] of Object.entries(ext.flags ?? {})) {
		const { recursive = true, ...def } = defWithScope;
		injectExtensionFlag(root, name, def as FlagDef, recursive, ext.name);
	}
}

/**
 * Deep-clone flag definitions (decoupled objects for a tree copy).
 */
function deepCloneFlags(flags: FlagsDef): FlagsDef {
	const out: FlagsDef = {};
	for (const [key, def] of Object.entries(flags)) {
		out[key] = {
			...def,
			aliases: def.aliases ? [...def.aliases] : undefined,
		};
	}
	return out;
}

/**
 * Deep-clone a command subtree so plugin `setup()` can run without mutating
 * the original builder graph.
 */
/**
 * Recursively merge parent-path Contexts into an attached subtree.
 *
 * Builders made with `.sub()` already carry the parent's Context instances —
 * identical instances are inheritance, not duplicates; a same-name different
 * instance anywhere on the path is a definition error per the
 * one-name-per-path rule (ADR-0002).
 */
function mergeContextsIntoSubtree(
	node: CommandNode,
	parentContexts: readonly ContextInstance[],
): CommandNode {
	const merged = [...parentContexts];
	for (const contextInstance of node.contexts) {
		if (merged.includes(contextInstance)) continue;
		if (merged.some((existing) => existing.name === contextInstance.name)) {
			throw new CrustError(
				"DEFINITION",
				`Context "${contextInstance.name}" is already provided on this command path`,
				{ subject: "context", name: contextInstance.name, reason: "duplicate-context" },
			);
		}
		merged.push(contextInstance);
	}

	const subCommands: Record<string, CommandNode> = {};
	for (const [name, sub] of Object.entries(node.subCommands)) {
		subCommands[name] = mergeContextsIntoSubtree(sub, merged);
	}

	return { ...node, contexts: merged, subCommands };
}

function deepCloneCommandNode(node: CommandNode): CommandNode {
	const subCommands: Record<string, CommandNode> = {};
	for (const [name, sub] of Object.entries(node.subCommands)) {
		subCommands[name] = deepCloneCommandNode(sub);
	}

	// Spread first so enumerable symbol-keyed annotations (e.g. skills'
	// command annotations) survive the clone; then override every structural
	// field with a decoupled copy.
	return {
		...node,
		meta: { ...node.meta },
		localFlags: deepCloneFlags(node.localFlags),
		effectiveFlags: deepCloneFlags(node.effectiveFlags),
		args: node.args ? node.args.map((def) => ({ ...def })) : undefined,
		subCommands,
		contexts: [...node.contexts],
		extensions: [...node.extensions],
		run: node.run,
	};
}

/**
 * Recursively freeze a CommandNode tree (shallow freeze per node).
 */
function freezeTree(node: CommandNode): void {
	Object.freeze(node);
	Object.freeze(node.localFlags);
	Object.freeze(node.effectiveFlags);
	Object.freeze(node.meta);
	Object.freeze(node.contexts);
	Object.freeze(node.extensions);
	if (node.args) Object.freeze(node.args);
	for (const sub of Object.values(node.subCommands)) {
		freezeTree(sub);
	}
	Object.freeze(node.subCommands);
}

// ────────────────────────────────────────────────────────────────────────────
// Crust — Chainable builder class
// ────────────────────────────────────────────────────────────────────────────

/**
 * Chainable builder for defining CLI commands with full type inference.
 *
 * Generic parameters:
 * - `Inherited` — flags inherited from a parent command (populated by `.command()`)
 * - `Local` — flags defined on this command via `.flags()`
 * - `A` — positional argument definitions
 * - `Eff` — effective flags (merged inherited + local flags, computed internally)
 *
 * @example
 * ```ts
 * const app = new Crust("my-cli")
 *   .flags({
 *     verbose: { type: "boolean", short: "v", inherit: true },
 *   })
 *   .args([{ name: "file", type: "string", required: true }])
 *   .handle(({ args, flags }) => {
 *     console.log(args.file, flags.verbose);
 *   });
 * ```
 */
export class Crust<
	Inherited extends FlagsDef = FlagsDef,
	Local extends FlagsDef = FlagsDef,
	A extends ArgsDef = ArgsDef,
	Eff extends FlagsDef = EffectiveFlags<Inherited, Local>,
	Ctx extends ContextMap = {},
> {
	/** @internal — Phantom property exposing generic parameters for type-level testing */
	declare readonly _types: {
		inherited: Inherited;
		local: Local;
		args: A;
		effective: Eff;
		ctx: Ctx;
	};

	/** @internal */
	readonly _node: CommandNode;

	/** @internal — The inherited flags record (runtime counterpart of Inherited generic) */
	readonly _inheritedFlags: FlagsDef;

	/** @internal — True for builders created via `.sub()` / `.command(name, cb)`; gates root-only APIs */
	readonly _isChild: boolean = false;

	/**
	 * Create a new root or standalone command builder.
	 *
	 * @param name - The command name.
	 * @throws {CrustError} `DEFINITION` if name is empty or whitespace-only
	 */
	constructor(name: string) {
		if (!name.trim()) {
			throw new CrustError("DEFINITION", "meta.name must be a non-empty string");
		}
		this._node = createCommandNode(name);
		this._inheritedFlags = {};
	}

	/**
	 * @internal — Create a child builder with pre-populated inherited flags.
	 * Used by `.command()` to propagate parent flags to the child.
	 */
	static _createChild<I extends FlagsDef, Ctx extends ContextMap = {}>(
		name: string,
		inheritedFlags: FlagsDef,
		contexts: readonly ContextInstance[] = [],
		// oxlint-disable-next-line typescript/no-empty-object-type -- empty initial state for child builder's Local generic
	): Crust<I, {}, [], EffectiveFlags<I, {}>, Ctx> {
		// oxlint-disable-next-line typescript/no-empty-object-type -- empty initial state for child builder's Local generic
		const instance = new Crust<I, {}, [], EffectiveFlags<I, {}>, Ctx>(name);
		// Override constructor defaults with parent-provided state.
		(instance as { _inheritedFlags: FlagsDef })._inheritedFlags = inheritedFlags;
		(instance as { _isChild: boolean })._isChild = true;
		(instance._node as { contexts: ContextInstance[] }).contexts = [...contexts];
		return instance;
	}

	/**
	 * @internal — Clone this builder with a new node, preserving generics.
	 */
	private _clone(nodeOverrides: Partial<CommandNode>): this {
		const cloned = Object.create(Object.getPrototypeOf(this)) as this;
		const newNode: CommandNode = {
			...this._node,
			// Shallow copy collections so mutations don't affect the original
			localFlags: { ...this._node.localFlags },
			effectiveFlags: { ...this._node.effectiveFlags },
			subCommands: { ...this._node.subCommands },
			contexts: [...this._node.contexts],
			extensions: [...this._node.extensions],
			meta: { ...this._node.meta },
			args: this._node.args ? [...this._node.args] : undefined,
			...nodeOverrides,
		};
		(cloned as { _node: CommandNode })._node = newNode;
		(cloned as { _inheritedFlags: FlagsDef })._inheritedFlags = this._inheritedFlags;
		(cloned as { _isChild: boolean })._isChild = this._isChild;
		return cloned;
	}

	/**
	 * Set metadata (description, usage) for this command.
	 *
	 * The command name is already set by the builder source (constructor,
	 * `.sub()`, or the child builder passed into `.command(name, cb)`).
	 * Provide `description`, `usage`, and/or `aliases` here.
	 *
	 * Returns a new builder with updated metadata. The original builder
	 * is not mutated.
	 *
	 * @param meta - Metadata fields to set (description, usage, aliases)
	 * @returns A new `Crust` instance with updated metadata
	 * @example
	 * ```ts
	 * .command("issue", (cmd) =>
	 *   cmd.meta({ aliases: ["issues", "i"] }).handle(() => {})
	 * )
	 * ```
	 */
	meta(meta: Omit<CommandMeta, "name">): Crust<Inherited, Local, A, Eff, Ctx> {
		return this._clone({
			meta: { ...this._node.meta, ...meta },
		}) as unknown as Crust<Inherited, Local, A, Eff, Ctx>;
	}

	/**
	 * Define local flags for this command.
	 *
	 * Returns a new builder with updated local flag types. The original
	 * builder is not mutated.
	 *
	 * NOTE: Compile-time inherited/local cross-collision checks are intentionally
	 * omitted here to reduce TypeScript type-check cost in large projects.
	 * Runtime collision checks still run during parsing and command-tree validation.
	 *
	 * @param defs - Flag definitions record
	 * @returns A new `Crust` instance with the given flags
	 * @throws {CrustError} `DEFINITION` if flag names/aliases violate constraints
	 */
	flags<const F extends FlagsDef>(
		defs: F & ValidateNoPrefixedFlags<ValidateFlagAliases<F>>,
	): Crust<Inherited, F, A, EffectiveFlags<Inherited, F>, Ctx> {
		// Runtime validation
		validateNoPrefixFlags(defs);

		// Deep copy flag defs to decouple from caller
		const copiedFlags: FlagsDef = {};
		for (const [key, def] of Object.entries(defs)) {
			copiedFlags[key] = { ...def };
		}

		return this._clone({
			localFlags: copiedFlags,
			effectiveFlags: computeEffectiveFlags(this._inheritedFlags, copiedFlags),
		}) as unknown as Crust<Inherited, F, A, EffectiveFlags<Inherited, F>, Ctx>;
	}

	/**
	 * Define positional arguments for this command.
	 *
	 * Returns a new builder with updated args types. The original
	 * builder is not mutated.
	 *
	 * @param defs - Ordered tuple of positional argument definitions
	 * @returns A new `Crust` instance with the given args
	 */
	args<const NewA extends ArgsDef>(
		defs: NewA & ValidateVariadicArgs<NewA>,
	): Crust<Inherited, Local, NewA, Eff, Ctx> {
		// Deep copy arg defs to decouple from caller
		const copiedArgs = defs.map((def) => ({ ...def })) as unknown as ArgsDef;

		return this._clone({
			args: copiedArgs,
		}) as unknown as Crust<Inherited, Local, NewA, Eff, Ctx>;
	}

	/**
	 * Attach a Context — a named command dependency — to this command.
	 *
	 * Contexts are inherited by descendant commands, constructed in
	 * registration order only for the resolved command path, and exposed to
	 * the Command Handler as `ctx`. Values implementing `Symbol.dispose` or
	 * `Symbol.asyncDispose` are disposed in reverse construction order after
	 * success or failure.
	 *
	 * @throws {CrustError} `DEFINITION` when the name is already provided on
	 *                      this command path
	 */
	provide<const C extends ContextInstance>(
		context: C,
	): Crust<Inherited, Local, A, Eff, MergeContext<Ctx, ContextOutput<C>>> {
		if (this._node.contexts.some((existing) => existing.name === context.name)) {
			throw new CrustError(
				"DEFINITION",
				`Context "${context.name}" is already provided on this command path`,
				{ subject: "context", name: context.name, reason: "duplicate-context" },
			);
		}
		return this._clone({
			contexts: [...this._node.contexts, context],
		}) as unknown as Crust<Inherited, Local, A, Eff, MergeContext<Ctx, ContextOutput<C>>>;
	}

	/**
	 * Define the Command Handler — the function that implements this
	 * command's behavior after its inputs and Contexts are ready.
	 *
	 * The handler receives a {@link CrustCommandContext} with `args` typed from
	 * `.args()` and `flags` typed as `EffectiveFlags<Inherited, Local>` (inherited
	 * flags merged with local flags).
	 *
	 * Returns a new builder with the handler stored. The original builder is
	 * not mutated.
	 *
	 * @param handler - The Command Handler function
	 * @returns A new `Crust` instance with the handler registered
	 */
	handle(
		handler: (ctx: NoInfer<CrustCommandContext<A, Eff, Ctx>>) => void | Promise<void>,
	): Crust<Inherited, Local, A, Eff, Ctx> {
		return this._clone({
			run: handler as (ctx: unknown) => void | Promise<void>,
		}) as unknown as Crust<Inherited, Local, A, Eff, Ctx>;
	}

	/**
	 * Register one or more CLI Extensions on the application root.
	 *
	 * Extensions are application-wide: they own the flags and commands they
	 * contribute. Registering an Extension on a child builder is a definition
	 * error.
	 *
	 * @throws {CrustError} `DEFINITION` when called on a child builder
	 */
	extend(...extensions: readonly Extension[]): Crust<Inherited, Local, A, Eff, Ctx> {
		if (this._isChild) {
			throw new CrustError(
				"DEFINITION",
				"Extensions are application-wide: call .extend() on the root builder, not on a subcommand",
				{ subject: "command", name: this._node.meta.name, reason: "extend-on-child" },
			);
		}
		return this._clone({
			extensions: [...this._node.extensions, ...extensions],
		}) as unknown as Crust<Inherited, Local, A, Eff, Ctx>;
	}

	/**
	 * Create a subcommand builder pre-typed with this command's inheritable flags.
	 *
	 * This is the factory method for the file-splitting pattern. The returned
	 * builder carries this command's effective flags (filtered for `inherit: true`)
	 * as its `Inherited` generic, enabling full type inference in split files
	 * without needing `Crust<any, any, any>`.
	 *
	 * Register the resulting builder with `.command(builder)` on the parent.
	 *
	 * @param name - Subcommand name (must be non-empty)
	 * @returns A new `Crust` builder pre-typed with inherited flags
	 * @throws {CrustError} `DEFINITION` if name is empty or whitespace-only
	 *
	 * @example
	 * ```ts
	 * // shared.ts
	 * export const app = new Crust("my-cli")
	 *   .flags({ verbose: { type: "boolean", inherit: true } });
	 *
	 * // commands/deploy.ts
	 * export const deployCmd = app.sub("deploy")
	 *   .flags({ env: { type: "string", required: true } })
	 *   .handle(({ flags }) => {
	 *     flags.verbose; // boolean | undefined  — typed!
	 *     flags.env;     // string               — typed!
	 *   });
	 *
	 * // cli.ts
	 * app.command(deployCmd).execute();
	 * ```
	 */
	sub<N extends string>(
		name: N,
		// oxlint-disable-next-line typescript/no-empty-object-type -- empty initial state for child builder's Local generic
	): Crust<Eff, {}, [], EffectiveFlags<Eff, {}>, Ctx> {
		if (!name.trim()) {
			throw new CrustError("DEFINITION", "Subcommand name must be a non-empty string");
		}

		const parentEffective = computeEffectiveFlags(this._inheritedFlags, this._node.localFlags);

		return Crust._createChild<Eff, Ctx>(name, parentEffective, this._node.contexts);
	}

	/**
	 * Register a named subcommand via inline callback.
	 *
	 * The callback receives a fresh `Crust` builder pre-typed with this
	 * command's effective inheritable flags, enabling TypeScript contextual
	 * typing to flow inherited flag types into subcommand definitions.
	 *
	 * @param name - Subcommand name (must be non-empty, unique among siblings)
	 * @param cb - Callback that receives a child builder and returns the configured builder
	 * @returns A new `Crust` instance with the subcommand registered
	 * @throws {CrustError} `DEFINITION` if name is empty or already registered
	 */
	command<N extends string>(
		name: N,
		cb: (
			// oxlint-disable-next-line typescript/no-empty-object-type -- empty initial state for child builder's Local generic
			cmd: Crust<Eff, {}, [], EffectiveFlags<Eff, {}>, Ctx>,
		) => Crust<
			// oxlint-disable-next-line typescript/no-explicit-any -- needed for type-erased child builder return
			any,
			// oxlint-disable-next-line typescript/no-explicit-any -- needed for type-erased child builder return
			any,
			// oxlint-disable-next-line typescript/no-explicit-any -- needed for type-erased child builder return
			any,
			// oxlint-disable-next-line typescript/no-explicit-any -- needed for type-erased child builder return
			any,
			// oxlint-disable-next-line typescript/no-explicit-any -- needed for type-erased child builder return
			any
		>,
	): Crust<Inherited, Local, A, Eff, Ctx>;

	/**
	 * Register a pre-built subcommand builder.
	 *
	 * The builder's name (from its constructor or `.sub()`) is used as the
	 * subcommand name. Builders created with `.sub()` inherit the parent's
	 * `inherit: true` flags; standalone `new Crust(name)` builders remain
	 * isolated. This is the complement to `.sub()` for the file-splitting
	 * pattern.
	 *
	 * @param builder - A pre-configured `Crust` builder instance
	 * @returns A new `Crust` instance with the subcommand registered
	 * @throws {CrustError} `DEFINITION` if builder name is empty or already registered
	 */
	command(
		// oxlint-disable-next-line typescript/no-explicit-any -- accepts any Crust builder instance
		builder: Crust<any, any, any, any, any>,
	): Crust<Inherited, Local, A, Eff, Ctx>;

	// Implementation
	command(
		// oxlint-disable-next-line typescript/no-explicit-any -- union of overload parameter types
		nameOrBuilder: string | Crust<any, any, any, any, any>,
		// oxlint-disable-next-line typescript/no-explicit-any -- callback parameter from first overload
		cb?: (cmd: Crust<any, any, any, any, any>) => Crust<any, any, any, any, any>,
	): Crust<Inherited, Local, A, Eff, Ctx> {
		if (typeof nameOrBuilder === "string") {
			// ── Inline callback path ──────────────────────────────────────────
			const name = nameOrBuilder;

			if (!cb) {
				throw new CrustError("DEFINITION", "command(name, cb) requires a callback");
			}

			// Validate name
			if (!name.trim()) {
				throw new CrustError("DEFINITION", "Subcommand name must be a non-empty string");
			}

			// Check for duplicate subcommand
			if (this._node.subCommands[name]) {
				throw new CrustError("DEFINITION", `Subcommand "${name}" is already registered`);
			}

			// Compute the effective flags for this node (inherited + local merged)
			const parentEffective = computeEffectiveFlags(this._inheritedFlags, this._node.localFlags);

			// Create a child builder pre-typed with the parent's effective flags
			const childBuilder = Crust._createChild<Eff, Ctx>(name, parentEffective, this._node.contexts);

			// Pass the child builder to the callback to let the user configure it
			const configuredChild = cb(childBuilder);

			// Eager alias collision detection. Mirrors commander v12:
			// fail at registration time rather than risk silent shadowing at
			// resolve time. Also catches the reverse-order case where a previously
			// registered sibling reserved an alias that equals this command's name.
			validateIncomingAliases(
				{ canonicalName: name, aliases: configuredChild._node.meta.aliases },
				this._node.subCommands,
				name,
			);

			// Extract the internal node from the configured child and register it
			// Clone the node to avoid mutating the original builder's _node
			const childNode = {
				...configuredChild._node,
				effectiveFlags: computeEffectiveFlags(
					configuredChild._inheritedFlags,
					configuredChild._node.localFlags,
				),
			};

			return this._clone({
				subCommands: {
					...this._node.subCommands,
					[name]: childNode,
				},
			}) as unknown as Crust<Inherited, Local, A, Eff, Ctx>;
		}

		// ── Pre-built builder path ──────────────────────────────────────────
		const builder = nameOrBuilder;
		const name = builder._node.meta.name;

		if (!name.trim()) {
			throw new CrustError("DEFINITION", "Subcommand name must be a non-empty string");
		}

		// Extensions are application-wide and root-only. A standalone builder
		// that called .extend() cannot be attached as a subcommand.
		if (builder._node.extensions.length > 0) {
			throw new CrustError(
				"DEFINITION",
				`Subcommand "${name}" carries Extensions: call .extend() on the root builder instead`,
				{ subject: "command", name, reason: "extend-on-child" },
			);
		}

		if (this._node.subCommands[name]) {
			throw new CrustError("DEFINITION", `Subcommand "${name}" is already registered`);
		}

		// Eager alias collision detection for the pre-built builder path.
		validateIncomingAliases(
			{ canonicalName: name, aliases: builder._node.meta.aliases },
			this._node.subCommands,
			name,
		);

		// Merge parent-path Contexts into the whole attached subtree (also
		// clones the node so the original builder's _node is not mutated).
		const childNode = {
			...mergeContextsIntoSubtree(builder._node, this._node.contexts),
			effectiveFlags: computeEffectiveFlags(builder._inheritedFlags, builder._node.localFlags),
		};

		return this._clone({
			subCommands: {
				...this._node.subCommands,
				[name]: childNode,
			},
		}) as unknown as Crust<Inherited, Local, A, Eff, Ctx>;
	}

	/**
	 * Build a frozen, validated copy of the command tree with all Extension
	 * contributions applied. Does not call Command Handlers.
	 *
	 * Unsupported tooling surface (used by man-page/skill generators); moves
	 * fully behind `@crustjs/core/tooling`.
	 */
	async prepareCommandTree(_options?: {
		argv?: readonly string[];
	}): Promise<{ root: CommandNode; warnings: readonly string[] }> {
		const prepared = await this._prepare();

		const { validateCommandTree } = await import("../parsing/validation.ts");
		validateCommandTree(prepared.rootNode);

		return { root: prepared.rootNode, warnings: [] };
	}

	/**
	 * Invoke this application programmatically: resolve, parse, run the
	 * Extension intercept chain and the Command Handler for `argv`.
	 *
	 * Unlike {@link Crust.execute}, `run()` throws the original definition,
	 * parse, Context, or handler failure without rendering it (Extension
	 * `handleError` hooks are a terminal presentation concern and never run
	 * here) and without changing process status. It resolves with no value
	 * after successful cleanup. Prompt cancellation surfaces as a standard
	 * `AbortError`.
	 *
	 * @param argv - Arguments to parse (no `process.argv` default — pass them explicitly)
	 * @param io - Optional `stdout(text)` / `stderr(text)` callbacks, also
	 *             exposed to Command Handlers and Extensions
	 */
	async run(
		argv: readonly string[],
		io?: {
			stdout?: (text: string) => void;
			stderr?: (text: string) => void;
		},
	): Promise<void> {
		const resolvedIO: InvocationIO = { ...defaultIO(), ...io };
		const prepared = await this._prepare();
		await this._dispatch(argv, prepared, resolvedIO);
	}

	/**
	 * Parse `process.argv`, resolve subcommands, run Extension hooks, and
	 * execute the matched Command Handler.
	 *
	 * This is the terminal CLI boundary — call it on the root builder. It
	 * renders a failure once (through the Extension `handleError` chain,
	 * ending in Core's default renderer), sets `process.exitCode` (`1`, or
	 * `130` for an `AbortError` cancellation), and resolves.
	 *
	 * @param options - Optional overrides (e.g. custom `argv` for testing)
	 */
	async execute(options?: { argv?: string[] }): Promise<void> {
		const argv = options?.argv ?? process.argv.slice(2);
		const io = defaultIO();

		let prepared: PreparedInvocation;
		try {
			prepared = await this._prepare();
		} catch (error) {
			// Extension-application failures render directly: the handleError
			// chain belongs to Extensions that just failed to apply.
			if (isAbortError(error)) {
				process.exitCode = EXIT_CODE_CANCELLED;
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			io.stderr(`Error: ${message}`);
			process.exitCode = 1;
			return;
		}

		// ── Build-time validation mode ─────────────────────────────────────
		if (process.env[VALIDATION_MODE_ENV] === "1") {
			const result = (async () => {
				try {
					const { validateCommandTree } = await import("../parsing/validation.ts");
					validateCommandTree(prepared.rootNode);
					return { ok: true } as const;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					console.error(message);
					process.exitCode = 1;
					return { ok: false, error } as const;
				}
			})();

			// Store for in-process consumers (tests)
			(globalThis as Record<string, unknown>)[VALIDATION_RESULT_GLOBAL_KEY] = result;
			await result;

			// Build validation subprocesses opt in to force-exit so user code
			// after `await app.execute()` is skipped (see VALIDATION_FORCE_EXIT_ENV).
			if (process.env[VALIDATION_FORCE_EXIT_ENV] === "1") {
				return process.exit(process.exitCode ?? 0);
			}
			return;
		}

		try {
			await this._dispatch(argv, prepared, io);
		} catch (error) {
			if (isAbortError(error)) {
				process.exitCode = EXIT_CODE_CANCELLED;
				return;
			}
			// Core always preserves a nonzero failure outcome, regardless of
			// what Extension handleError hooks do (ADR-0001).
			process.exitCode = 1;
			await renderFailure(error, argv, prepared, io);
		}
	}

	/**
	 * Clone the tree, apply Extension-owned commands and flags, and freeze
	 * the result. Collisions with application or other Extension definitions
	 * throw DEFINITION errors; failures propagate unrendered.
	 */
	private async _prepare(): Promise<PreparedInvocation> {
		const rootNode = deepCloneCommandNode(this._node);
		const extensions = this._node.extensions;

		// Commands first, then flags, so recursive Extension flags also reach
		// Extension-contributed commands (e.g. --help on "completion").
		for (const ext of extensions) {
			applyExtensionCommands(rootNode, ext);
		}
		for (const ext of extensions) {
			applyExtensionFlags(rootNode, ext);
		}

		const ownedCommands = new Set<string>();
		for (const ext of extensions) {
			for (const builder of ext.commands ?? []) {
				ownedCommands.add(builder._node.meta.name);
			}
		}

		freezeTree(rootNode);

		return { rootNode, extensions, ownedCommands };
	}

	/**
	 * Resolve, parse, run the Extension intercept chain and the Command
	 * Handler for one invocation. Throws the original failure (definition,
	 * parse, Context, or handler error) without rendering it or touching
	 * `process.exitCode`. Routing and syntax failures throw directly —
	 * intercept hooks never observe them.
	 */
	private async _dispatch(
		argv: readonly string[],
		prepared: PreparedInvocation,
		io: InvocationIO,
	): Promise<void> {
		const { rootNode, extensions, ownedCommands } = prepared;

		// Routing and syntax parsing — failures flow directly to the caller
		const resolved = resolveCommand(rootNode, [...argv]);
		// Safe cast: rootNode is always CommandNode, so all resolved descendants are too
		const resolvedNode = resolved.command as CommandNode;
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
			stdout: io.stdout,
			stderr: io.stderr,
		});

		// Extension-owned inputs are validated before the hooks run (ADR-0001)
		const routedRoot = resolved.commandPath[1];
		if (routedRoot !== undefined && ownedCommands.has(routedRoot)) {
			validateParsed(resolvedNode, parsed);
		}

		const terminal = async (): Promise<void> => {
			validateParsed(resolvedNode, parsed);

			if (!resolvedNode.run) return;

			// Native resource protocol: Context values implementing
			// Symbol.dispose/asyncDispose are disposed in reverse construction
			// order after success or failure (`await using` semantics).
			await using disposal = new AsyncDisposableStack();

			const context: CrustCommandContext = {
				args: parsed.args,
				flags: parsed.flags,
				ctx: await buildContexts(resolvedNode.contexts, disposal),
				rawArgs: parsed.rawArgs,
				command: extensionContext.command,
				stdout: io.stdout,
				stderr: io.stderr,
			};

			await resolvedNode.run(context);
		};

		await runInterceptChain(
			extensions
				.map((ext) => ext.intercept)
				.filter((hook): hook is ExtensionIntercept => hook !== undefined),
			extensionContext,
			terminal,
		);
	}
}

/** Run the Extension intercept chain, terminating in `terminal`. */
async function runInterceptChain(
	hooks: readonly ExtensionIntercept[],
	context: ExtensionContext,
	terminal: () => Promise<void>,
): Promise<void> {
	let index = -1;
	const dispatch = async (i: number): Promise<void> => {
		if (i <= index) {
			throw new CrustError("DEFINITION", "Extension intercept called next() multiple times", {
				subject: "extension",
				reason: "duplicate-next",
			});
		}
		index = i;
		if (i === hooks.length) {
			await terminal();
			return;
		}
		await (hooks[i] as ExtensionIntercept)(context, () => dispatch(i + 1));
	};
	await dispatch(0);
}

/**
 * Render one failure through the Extension handleError chain, ending in
 * Core's default renderer. Presentation only — the caller has already set
 * the nonzero exit code.
 */
async function renderFailure(
	error: unknown,
	argv: readonly string[],
	prepared: PreparedInvocation,
	io: InvocationIO,
): Promise<void> {
	const renderDefault = (): void => {
		const message = error instanceof Error ? error.message : String(error);
		io.stderr(`Error: ${message}`);
	};

	const handlers = prepared.extensions
		.map((ext) => ext.handleError)
		.filter((hook): hook is ExtensionErrorHandler => hook !== undefined);
	if (handlers.length === 0) {
		renderDefault();
		return;
	}

	// Best-effort context: the failure may predate routing, so the resolved
	// command falls back to the root snapshot with empty inputs.
	const rootSnapshot = snapshotCommand(prepared.rootNode);
	const context: ExtensionContext = Object.freeze({
		argv: [...argv] as readonly string[],
		rootCommand: rootSnapshot,
		command: rootSnapshot,
		commandPath: Object.freeze([prepared.rootNode.meta.name]),
		args: Object.freeze({}),
		flags: Object.freeze({}),
		rawArgs: [],
		stdout: io.stdout,
		stderr: io.stderr,
	});

	let index = -1;
	const dispatch = async (i: number): Promise<void> => {
		// Unlike the intercept chain, duplicate next() is ignored rather than
		// thrown: the presentation chain must never create new failures.
		if (i <= index) return;
		index = i;
		if (i === handlers.length) {
			renderDefault();
			return;
		}
		await (handlers[i] as ExtensionErrorHandler)(error, context, () => dispatch(i + 1));
	};

	try {
		await dispatch(0);
	} catch {
		// The presentation chain itself failed — fall back to the default
		// rendering of the original failure so it is never lost.
		renderDefault();
	}
}
