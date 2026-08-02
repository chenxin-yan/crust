import type {
	Extension,
	ExtensionContext,
	ExtensionErrorHandler,
	ExtensionIntercept,
} from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import { parseArgs, validateParsed } from "../parsing/parser.ts";
import { applySchemas } from "../parsing/schema.ts";
import { validateCommandTree, validateIncomingAliases } from "../parsing/validation.ts";
import type {
	ArgDef,
	ArgsDef,
	CommandMeta,
	EffectiveFlags,
	FlagDef,
	FlagsDef,
	InferArgs,
	InferFlags,
	InheritableFlags,
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
export interface CrustCommandContext<A extends ArgsDef = ArgsDef, F extends FlagsDef = FlagsDef> {
	/** Resolved positional arguments, keyed by arg name */
	args: InferArgs<A>;
	/** Resolved flags, keyed by flag name */
	flags: InferFlags<F>;
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
const DEFAULT_IO: InvocationIO = {
	stdout: (text) => console.log(text),
	stderr: (text) => console.error(text),
};

/** One cloned, extension-applied, frozen command tree. */
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
 * Runtime guard for untyped callers: schema mode is exclusive — the schema
 * owns coercion, defaults, requiredness, choices, and validation (ADR-0005).
 * The type system already rejects mixing; this catches plain-JS misuse.
 */
function validateSchemaExclusivity(
	subject: "arg" | "flag",
	name: string,
	def: Record<string, unknown>,
): void {
	if (def.schema === undefined) return;
	for (const key of ["default", "required", "choices", "parse"] as const) {
		if (def[key] !== undefined) {
			throw new CrustError(
				"DEFINITION",
				`${subject} "${name}" mixes core option "${key}" with a schema — the schema exclusively owns coercion, defaults, requiredness, choices, and validation`,
				{ subject, name, reason: "schema-exclusive" },
			);
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
	Object.freeze(node.extensions);
	if (node.args) Object.freeze(node.args);
	for (const sub of Object.values(node.subCommands)) {
		freezeTree(sub);
	}
	Object.freeze(node.subCommands);
}

// ────────────────────────────────────────────────────────────────────────────
// Reusable command definitions
// ────────────────────────────────────────────────────────────────────────────

export interface CommandRequirements {
	readonly flags?: Record<string, FlagDef & { inherit: true }>;
}

type RequirementFlags<R extends CommandRequirements> = R extends {
	flags: infer F extends FlagsDef;
}
	? F
	: {};

type AnyCommandDefinitionBuilder = CommandDefinitionBuilder<any, any, any, any>;

type CommandRecipe<R extends CommandRequirements> = (
	command: CommandDefinitionBuilder<
		RequirementFlags<R>,
		{},
		[],
		EffectiveFlags<RequirementFlags<R>, {}>
	>,
) => AnyCommandDefinitionBuilder;

const commandDefinitionRecipe: unique symbol = Symbol("crust.commandDefinitionRecipe");

export interface CommandDefinition<R extends CommandRequirements = {}> {
	readonly [commandDefinitionRecipe]: CommandRecipe<R>;
}

type FlagValue<D extends FlagDef> = InferFlags<{ value: D }>["value"];

type MissingInheritedFlagNames<ParentEff extends FlagsDef, R extends CommandRequirements> = Exclude<
	keyof RequirementFlags<R>,
	keyof InheritableFlags<ParentEff>
> &
	string;

type IncompatibleInheritedFlagNames<
	ParentEff extends FlagsDef,
	R extends CommandRequirements,
	Provided extends FlagsDef = InheritableFlags<ParentEff>,
	Required extends FlagsDef = RequirementFlags<R>,
> = {
	[K in keyof Required & keyof Provided]: FlagValue<Provided[K]> extends FlagValue<Required[K]>
		? never
		: K;
}[keyof Required & keyof Provided] &
	string;

type Mountable<ParentEff extends FlagsDef, R extends CommandRequirements> = ([
	MissingInheritedFlagNames<ParentEff, R>,
] extends [never]
	? {}
	: { readonly "missing inherited flags": MissingInheritedFlagNames<ParentEff, R> }) &
	([IncompatibleInheritedFlagNames<ParentEff, R>] extends [never]
		? {}
		: {
				readonly "incompatible inherited flags": IncompatibleInheritedFlagNames<ParentEff, R>;
			});

export interface CommandDefinitionBuilder<
	Inherited extends FlagsDef = FlagsDef,
	Local extends FlagsDef = FlagsDef,
	A extends ArgsDef = ArgsDef,
	Eff extends FlagsDef = EffectiveFlags<Inherited, Local>,
> {
	meta(meta: Omit<CommandMeta, "name">): CommandDefinitionBuilder<Inherited, Local, A, Eff>;

	flags<const F extends FlagsDef>(
		defs: F & ValidateNoPrefixedFlags<ValidateFlagAliases<F>>,
	): CommandDefinitionBuilder<Inherited, F, A, EffectiveFlags<Inherited, F>>;

	args<const NewA extends ArgsDef>(
		defs: NewA & ValidateVariadicArgs<NewA>,
	): CommandDefinitionBuilder<Inherited, Local, NewA, Eff>;

	handle(
		handler: (ctx: NoInfer<CrustCommandContext<A, Eff>>) => void | Promise<void>,
	): CommandDefinitionBuilder<Inherited, Local, A, Eff>;

	command<N extends string>(
		name: N,
		cb: (
			command: CommandDefinitionBuilder<Eff, {}, [], EffectiveFlags<Eff, {}>>,
		) => AnyCommandDefinitionBuilder,
	): CommandDefinitionBuilder<Inherited, Local, A, Eff>;

	mount<const R extends CommandRequirements>(
		name: string,
		definition: CommandDefinition<R> & Mountable<Eff, NoInfer<R>>,
	): CommandDefinitionBuilder<Inherited, Local, A, Eff>;
}

export function defineCommand<const R extends CommandRequirements = {}>(
	configure: CommandRecipe<R>,
): CommandDefinition<R> {
	return Object.freeze({ [commandDefinitionRecipe]: configure });
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
> {
	/** @internal — Phantom property exposing generic parameters for type-level testing */
	declare readonly _types: {
		inherited: Inherited;
		local: Local;
		args: A;
		effective: Eff;
	};

	/** @internal */
	readonly _node: CommandNode;

	/** @internal — The inherited flags record (runtime counterpart of Inherited generic) */
	readonly _inheritedFlags: FlagsDef;

	/**
	 * Create a new root command builder.
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
			extensions: [...this._node.extensions],
			meta: { ...this._node.meta },
			args: this._node.args ? [...this._node.args] : undefined,
			...nodeOverrides,
		};
		(cloned as { _node: CommandNode })._node = newNode;
		(cloned as { _inheritedFlags: FlagsDef })._inheritedFlags = this._inheritedFlags;
		return cloned;
	}

	/**
	 * Set metadata (description, usage) for this command.
	 *
	 * The command name is already set by the constructor or mount call.
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
	meta(meta: Omit<CommandMeta, "name">): Crust<Inherited, Local, A, Eff> {
		return this._clone({
			meta: { ...this._node.meta, ...meta },
		}) as Crust<Inherited, Local, A, Eff>;
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
	): Crust<Inherited, F, A, EffectiveFlags<Inherited, F>> {
		// Runtime validation
		for (const [name, def] of Object.entries(defs)) {
			validateSchemaExclusivity("flag", name, def as unknown as Record<string, unknown>);
		}

		// Deep copy flag defs to decouple from caller
		const copiedFlags: FlagsDef = {};
		for (const [key, def] of Object.entries(defs)) {
			copiedFlags[key] = { ...def };
		}

		return this._clone({
			localFlags: copiedFlags,
			effectiveFlags: computeEffectiveFlags(this._inheritedFlags, copiedFlags),
		}) as unknown as Crust<Inherited, F, A, EffectiveFlags<Inherited, F>>;
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
	): Crust<Inherited, Local, NewA, Eff> {
		for (const def of defs) {
			const record = def as unknown as Record<string, unknown>;
			validateSchemaExclusivity("arg", (def as ArgDef).name, record);
			// Schema args receive raw strings: a parser `type` would coerce first
			if (record.schema !== undefined && record.type !== undefined) {
				throw new CrustError(
					"DEFINITION",
					`arg "${(def as ArgDef).name}" mixes core option "type" with a schema — schema args receive the raw string token`,
					{ subject: "arg", name: (def as ArgDef).name, reason: "schema-exclusive" },
				);
			}
		}
		// Deep copy arg defs to decouple from caller
		const copiedArgs = defs.map((def) => ({ ...def })) as unknown as ArgsDef;

		return this._clone({
			args: copiedArgs,
		}) as unknown as Crust<Inherited, Local, NewA, Eff>;
	}

	/**
	 * Define the Command Handler — the function that implements this
	 * command's behavior after its inputs are ready.
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
		handler: (ctx: NoInfer<CrustCommandContext<A, Eff>>) => void | Promise<void>,
	): Crust<Inherited, Local, A, Eff> {
		return this._clone({
			run: handler as (ctx: unknown) => void | Promise<void>,
		}) as Crust<Inherited, Local, A, Eff>;
	}

	/**
	 * Register one or more CLI Extensions on the application root.
	 *
	 * Extensions are application-wide: they own the flags and commands they
	 * contribute. Command definition builders do not expose this method.
	 */
	extend(...extensions: readonly Extension[]): Crust<Inherited, Local, A, Eff> {
		return this._clone({
			extensions: [...this._node.extensions, ...extensions],
		}) as Crust<Inherited, Local, A, Eff>;
	}

	/** Register a named inline subcommand through the definition materializer. */
	command<N extends string>(
		name: N,
		cb: (
			command: CommandDefinitionBuilder<Eff, {}, [], EffectiveFlags<Eff, {}>>,
		) => AnyCommandDefinitionBuilder,
	): Crust<Inherited, Local, A, Eff> {
		if (typeof cb !== "function") {
			throw new CrustError("DEFINITION", "command(name, cb) requires a callback");
		}
		return this._mountDefinition(name, cb);
	}

	/** Materialize and register an inert reusable command definition. */
	mount<const R extends CommandRequirements>(
		name: string,
		definition: CommandDefinition<R> & Mountable<Eff, NoInfer<R>>,
	): Crust<Inherited, Local, A, Eff> {
		const recipe = (definition as Partial<CommandDefinition> | null)?.[commandDefinitionRecipe];
		if (typeof recipe !== "function") {
			throw new CrustError(
				"DEFINITION",
				"mount(name, definition) requires a command definition created by defineCommand()",
			);
		}
		return this._mountDefinition(name, recipe);
	}

	private _mountDefinition(
		name: string,
		recipe: (command: AnyCommandDefinitionBuilder) => AnyCommandDefinitionBuilder,
	): Crust<Inherited, Local, A, Eff> {
		if (!name.trim()) {
			throw new CrustError("DEFINITION", "Subcommand name must be a non-empty string");
		}
		if (this._node.subCommands[name]) {
			throw new CrustError("DEFINITION", `Subcommand "${name}" is already registered`);
		}

		const parentEffective = computeEffectiveFlags(this._inheritedFlags, this._node.localFlags);
		const child = new Crust(name);
		(child as { _inheritedFlags: FlagsDef })._inheritedFlags = parentEffective;
		child._node.effectiveFlags = computeEffectiveFlags(parentEffective, {});

		const configured = recipe(child as unknown as AnyCommandDefinitionBuilder) as unknown as
			| Crust
			| undefined;
		if (configured?._inheritedFlags !== parentEffective) {
			throw new CrustError(
				"DEFINITION",
				"Command definition must return the same command builder it received",
			);
		}
		if (configured._node.extensions.length > 0) {
			throw new CrustError(
				"DEFINITION",
				"Extensions cannot be registered inside command definitions",
			);
		}

		validateIncomingAliases(
			{ canonicalName: name, aliases: configured._node.meta.aliases },
			this._node.subCommands,
			name,
		);

		const childNode = deepCloneCommandNode(configured._node);
		childNode.meta.name = name;

		return this._clone({
			subCommands: { ...this._node.subCommands, [name]: childNode },
		}) as Crust<Inherited, Local, A, Eff>;
	}

	/**
	 * Invoke this application programmatically: resolve, parse, run the
	 * Extension intercept chain and the Command Handler for `argv`.
	 *
	 * Unlike {@link Crust.execute}, `run()` throws the original definition,
	 * parse, or handler failure without rendering it (Extension
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
		const resolvedIO: InvocationIO = { ...DEFAULT_IO, ...io };
		const prepared = prepareInvocation(this._node);
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
		const io = DEFAULT_IO;

		let prepared: PreparedInvocation;
		try {
			prepared = prepareInvocation(this._node);
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
			await this._dispatch(argv, prepared, io, (context) => {
				extensionContext = context;
			});
		} catch (error) {
			if (isAbortError(error)) {
				process.exitCode = EXIT_CODE_CANCELLED;
				return;
			}
			// Core always preserves a nonzero failure outcome, regardless of
			// what Extension handleError hooks do (ADR-0001).
			process.exitCode = 1;
			await renderFailure(error, argv, prepared, io, extensionContext);
		}
	}

	/**
	 * Resolve, parse, run the Extension intercept chain and the Command
	 * Handler for one invocation. Throws the original failure (definition,
	 * parse, or handler error) without rendering it or touching
	 * `process.exitCode`. Routing and syntax failures throw directly —
	 * intercept hooks never observe them.
	 */
	private async _dispatch(
		argv: readonly string[],
		prepared: PreparedInvocation,
		io: InvocationIO,
		onExtensionContext?: (context: ExtensionContext) => void,
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
		onExtensionContext?.(extensionContext);

		// Extension-owned inputs are validated before the hooks run (ADR-0001)
		const routedRoot = resolved.commandPath[1];
		if (routedRoot !== undefined && ownedCommands.has(routedRoot)) {
			validateParsed(resolvedNode, parsed);
		}

		const terminal = async (): Promise<void> => {
			validateParsed(resolvedNode, parsed);

			if (!resolvedNode.run) return;

			// Standard Schemas on arg/flag definitions own value validation and
			// transformation (ADR-0005); the handler receives schema outputs.
			const validated = await applySchemas(resolvedNode, parsed);

			const context: CrustCommandContext = {
				args: validated.args as CrustCommandContext["args"],
				flags: validated.flags as CrustCommandContext["flags"],
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
	extensionContext: ExtensionContext | undefined,
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

	// Routing or parsing may have failed before an invocation context existed.
	let context = extensionContext;
	if (context === undefined) {
		const rootSnapshot = snapshotCommand(prepared.rootNode);
		context = Object.freeze({
			argv: [...argv] as readonly string[],
			rootCommand: rootSnapshot,
			command: rootSnapshot,
			commandPath: Object.freeze([prepared.rootNode.meta.name]),
			args: Object.freeze({}),
			flags: Object.freeze({}),
			rawArgs: [],
			stdout: io.stdout,
			stderr: io.stderr,
		} satisfies ExtensionContext);
	}

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

/** Shared prepare step: clone, apply Extensions, freeze. */
function prepareInvocation(node: CommandNode): PreparedInvocation {
	const rootNode = deepCloneCommandNode(node);
	const extensions = node.extensions;

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
 * Prepare a frozen, validated Command Snapshot of an application with all
 * Extension contributions applied. Does not call Command Handlers.
 *
 * Explicitly unsupported tooling bridge (ADR-0006), exposed only via
 * `@crustjs/core/tooling` for man-page/skill generators and build tooling.
 * The parameter is structural so any `Crust` builder satisfies it.
 */
export async function prepareCommandSnapshot(app: {
	readonly _node: CommandNode;
}): Promise<CommandSnapshot> {
	const prepared = prepareInvocation(app._node);
	validateCommandTree(prepared.rootNode);

	return snapshotCommand(prepared.rootNode);
}
