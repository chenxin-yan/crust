import {
	buildContexts,
	type AnyContextFactory,
	type ContextInstance,
	type ContextMap,
	type ContextsOutput,
	type ContextsOwnedFlags,
	type MergeContext,
	type RequirementCtxOf,
} from "../api/context.ts";
import {
	finishInvocation,
	type Extension,
	type ExtensionContext,
	type InvocationOutcome,
} from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import { validateIncomingFlag } from "../parsing/flag-validation.ts";
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
	InvocationIO,
	MergeFlags,
	NamedFlagDef,
	NamedFlagsRecord,
	ValidateNamedFlagDefs,
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
 * - `F` — the effective (Context-owned + local merged) flag definitions
 */
export interface CrustCommandContext<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
	Ctx extends ContextMap = {},
> extends InvocationIO {
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
	/** Readonly snapshot of the application root, including Extension contributions */
	rootCommand: CommandSnapshot;
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
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers — runtime flag validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Runtime guard for untyped callers: schema mode is exclusive — the schema
 * owns coercion, defaults, requiredness, choices, and validation.
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

/**
 * Inject an Extension-owned flag into a node's effective flags (and, when
 * `recursive`, into every descendant). Name collisions with application or
 * other Extension definitions are definition errors.
 */
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
function applyExtensionCommands(root: CommandNode, ext: Extension): void {
	for (const definition of ext.commands ?? []) {
		const node = materializeCommandDefinition(definition, root, ext.name);
		root.subCommands[definition.name] = node;
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
		ownedFlags: deepCloneFlags(node.ownedFlags),
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
	Object.freeze(node.ownedFlags);
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
// Reusable command definitions
// ────────────────────────────────────────────────────────────────────────────

/** Context capabilities a command definition requires from its mount path. */
export interface CommandRequirements {
	readonly requires?: readonly AnyContextFactory[];
}

type RequirementContext<R extends CommandRequirements> = RequirementCtxOf<R>;

type AnyCommandDefinitionBuilder = CommandDefinitionBuilder<any, any, any, any, any>;

type CommandRecipe<R extends CommandRequirements> = (
	command: CommandDefinitionBuilder<{}, {}, [], EffectiveFlags<{}, {}>, RequirementContext<R>>,
) => AnyCommandDefinitionBuilder;

const commandDefinitionInternal: unique symbol = Symbol.for("crust.commandDefinition");

interface CommandDefinitionInternal {
	readonly recipe: (command: AnyCommandDefinitionBuilder) => AnyCommandDefinitionBuilder;
	/** Requirement names, runtime-checked at each mount site */
	readonly requiredCtxNames: readonly string[];
}

export interface CommandDefinition<R extends CommandRequirements = {}> {
	/** The subcommand name this definition mounts under */
	readonly name: string;
	/** The same definition under a different name (mount one definition twice) */
	as(name: string): CommandDefinition<R>;
	/** @internal */
	readonly [commandDefinitionInternal]: CommandDefinitionInternal;
	/** @internal — phantom carrying the requirements for mount-site checks */
	readonly _requirements?: R;
}

function materializeCommandDefinition(
	definition: CommandDefinition,
	parent: CommandNode,
	extensionName?: string,
): CommandNode {
	const internal = (definition as Partial<CommandDefinition> | null)?.[commandDefinitionInternal];
	if (internal === undefined) {
		if (extensionName) {
			throw new CrustError(
				"DEFINITION",
				`Extension "${extensionName}" commands must be created by defineCommand()`,
				{
					subject: "extension",
					name: extensionName,
					reason: "invalid-command-definition",
				},
			);
		}
		throw new CrustError(
			"DEFINITION",
			"mount() requires a command definition created by defineCommand()",
		);
	}

	const name = definition.name;
	if (parent.subCommands[name]) {
		if (extensionName) {
			throw new CrustError(
				"DEFINITION",
				`Extension "${extensionName}" command "${name}" collides with an existing root command`,
				{ subject: "command", name, reason: "extension-command-collision" },
			);
		}
		throw new CrustError("DEFINITION", `Subcommand "${name}" is already registered`);
	}

	const providedNames = new Set(parent.contexts.map((context) => context.name));
	for (const ctxName of internal.requiredCtxNames) {
		if (!providedNames.has(ctxName)) {
			const message = extensionName
				? `Extension "${extensionName}" command "${name}" requires Context "${ctxName}", which is not provided on application root "${parent.meta.name}"`
				: `Command "${name}" requires Context "${ctxName}", which is not provided on "${parent.meta.name}" — call .provide() before .mount()`;
			throw new CrustError("DEFINITION", message, {
				subject: "context",
				name: ctxName,
				reason: "missing-context",
			});
		}
	}

	const child = new Crust(name);
	(child as { _ancestorOwnedFlags: FlagsDef })._ancestorOwnedFlags = parent.ownedFlags;
	child._node.ownedFlags = { ...parent.ownedFlags };
	child._node.effectiveFlags = computeEffectiveFlags(child._node.ownedFlags, {});
	(child._node as { contexts: ContextInstance[] }).contexts = [...parent.contexts];

	const configured = internal.recipe(
		child as unknown as AnyCommandDefinitionBuilder,
	) as unknown as Crust;
	if (configured?._ancestorOwnedFlags !== parent.ownedFlags) {
		if (extensionName) {
			throw new CrustError(
				"DEFINITION",
				`Extension "${extensionName}" command "${name}" definition must return the same command builder it received`,
				{
					subject: "extension",
					name: extensionName,
					reason: "foreign-command-builder",
				},
			);
		}
		throw new CrustError(
			"DEFINITION",
			"Command definition must return the same command builder it received",
		);
	}
	if (configured._node.extensions.length > 0) {
		if (extensionName) {
			throw new CrustError(
				"DEFINITION",
				`Extension "${extensionName}" command "${name}" cannot register Extensions inside command definitions`,
				{
					subject: "extension",
					name: extensionName,
					reason: "nested-command-extension",
				},
			);
		}
		throw new CrustError(
			"DEFINITION",
			"Extensions cannot be registered inside command definitions",
		);
	}

	validateIncomingAliases(
		{ canonicalName: name, aliases: configured._node.meta.aliases },
		parent.subCommands,
		name,
	);

	const childNode = deepCloneCommandNode(configured._node);
	childNode.meta.name = name;
	return childNode;
}

type MissingContextNames<Ctx extends ContextMap, Required extends ContextMap> = Exclude<
	keyof Required,
	keyof Ctx
> &
	string;

type IncompatibleContextNames<Ctx extends ContextMap, Required extends ContextMap> = {
	[K in keyof Required & keyof Ctx]: Ctx[K] extends Required[K] ? never : K;
}[keyof Required & keyof Ctx] &
	string;

type ContextRequirementErrors<Ctx extends ContextMap, Required extends ContextMap> = ([
	MissingContextNames<Ctx, Required>,
] extends [never]
	? {}
	: { readonly "missing Contexts": MissingContextNames<Ctx, Required> }) &
	([IncompatibleContextNames<Ctx, Required>] extends [never]
		? {}
		: {
				readonly "incompatible Contexts": IncompatibleContextNames<Ctx, Required>;
			});

type DefinitionRequirements<D> = D extends CommandDefinition<infer R> ? R : never;

/** Per-definition mount checks (compile-time counterpart of the runtime attach checks). */
type MountChecks<Ctx extends ContextMap, Ds extends readonly CommandDefinition<any>[]> = {
	[I in keyof Ds]: Ds[I] &
		ContextRequirementErrors<Ctx, RequirementContext<DefinitionRequirements<Ds[I]>>>;
};

export interface CommandDefinitionBuilder<
	Local extends FlagsDef = {},
	Owned extends FlagsDef = {},
	A extends ArgsDef = ArgsDef,
	Eff extends FlagsDef = EffectiveFlags<Local, Owned>,
	Ctx extends ContextMap = {},
> {
	meta(meta: Omit<CommandMeta, "name">): CommandDefinitionBuilder<Local, Owned, A, Eff, Ctx>;

	flags<const Defs extends readonly NamedFlagDef[]>(
		...defs: ValidateNamedFlagDefs<Defs>
	): CommandDefinitionBuilder<
		NamedFlagsRecord<Defs>,
		Owned,
		A,
		EffectiveFlags<NamedFlagsRecord<Defs>, Owned>,
		Ctx
	>;

	args<const NewA extends ArgsDef>(
		...defs: NewA & ValidateVariadicArgs<NewA>
	): CommandDefinitionBuilder<Local, Owned, NewA, Eff, Ctx>;

	provide<const Cs extends readonly ContextInstance[]>(
		...instances: Cs
	): CommandDefinitionBuilder<
		Local,
		MergeFlags<Owned, ContextsOwnedFlags<Cs>>,
		A,
		EffectiveFlags<Local, MergeFlags<Owned, ContextsOwnedFlags<Cs>>>,
		MergeContext<Ctx, ContextsOutput<Cs>>
	>;

	mount<const Ds extends readonly CommandDefinition<any>[]>(
		...definitions: MountChecks<Ctx, Ds>
	): CommandDefinitionBuilder<Local, Owned, A, Eff, Ctx>;

	handle(
		handler: (ctx: NoInfer<CrustCommandContext<A, Eff, Ctx>>) => void | Promise<void>,
	): CommandDefinitionBuilder<Local, Owned, A, Eff, Ctx>;
}

/**
 * Define a reusable, inert command under a required name.
 *
 * The recipe runs once per `.mount()`, receiving a fresh builder typed by
 * the declared Context capabilities, which must be provided on the mount path.
 *
 * Use `.as(name)` to mount one definition under a different name.
 */
export function defineCommand(name: string, recipe: CommandRecipe<{}>): CommandDefinition;
export function defineCommand<const R extends CommandRequirements>(
	name: string,
	config: R,
	recipe: CommandRecipe<R>,
): CommandDefinition<R>;
export function defineCommand(
	name: string,
	configOrRecipe: CommandRequirements | CommandRecipe<CommandRequirements>,
	maybeRecipe?: CommandRecipe<CommandRequirements>,
): CommandDefinition<CommandRequirements> {
	const hasConfig = typeof configOrRecipe !== "function";
	const config = hasConfig ? configOrRecipe : {};
	const recipe = hasConfig ? maybeRecipe : configOrRecipe;
	if (typeof recipe !== "function") {
		throw new CrustError("DEFINITION", `Command definition "${name}" requires a recipe function`, {
			subject: "command",
			name,
			reason: "missing-recipe",
		});
	}
	const internal: CommandDefinitionInternal = {
		recipe: recipe as CommandDefinitionInternal["recipe"],
		requiredCtxNames: (config.requires ?? []).map((dep) => dep.contextName),
	};
	const named = (defName: string): CommandDefinition<CommandRequirements> => {
		if (!defName.trim()) {
			throw new CrustError("DEFINITION", "Command name must be a non-empty string", {
				subject: "command",
				reason: "empty-name",
			});
		}
		return Object.freeze({
			name: defName,
			as: (newName: string) => named(newName),
			[commandDefinitionInternal]: internal,
		});
	};
	return named(name);
}

// ────────────────────────────────────────────────────────────────────────────
// Crust — Chainable builder class
// ────────────────────────────────────────────────────────────────────────────

/**
 * Chainable builder for defining CLI commands with full type inference.
 *
 * Generic parameters:
 * - `Local` — flags defined on this command via `.flags()`
 * - `Owned` — flags installed by Contexts provided on this command path
 * - `A` — positional argument definitions
 * - `Eff` — effective flags (merged local + owned flags)
 *
 * @example
 * ```ts
 * const app = new Crust("my-cli")
 *   .flags({ name: "verbose", type: "boolean", short: "v" })
 *   .args({ name: "file", type: "string", required: true })
 *   .handle(({ args, flags }) => {
 *     console.log(args.file, flags.verbose);
 *   });
 * ```
 */
export class Crust<
	Local extends FlagsDef = {},
	Owned extends FlagsDef = {},
	A extends ArgsDef = ArgsDef,
	Eff extends FlagsDef = EffectiveFlags<Local, Owned>,
	Ctx extends ContextMap = {},
> {
	/** @internal — Phantom property exposing generic parameters for type-level testing */
	declare readonly _types: {
		local: Local;
		owned: Owned;
		args: A;
		effective: Eff;
		ctx: Ctx;
	};

	/** @internal */
	readonly _node: CommandNode;

	/** @internal — Runtime identity anchor for the ancestor-owned flag carrier */
	readonly _ancestorOwnedFlags: FlagsDef;

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
		this._ancestorOwnedFlags = {};
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
			ownedFlags: { ...this._node.ownedFlags },
			effectiveFlags: { ...this._node.effectiveFlags },
			subCommands: { ...this._node.subCommands },
			contexts: [...this._node.contexts],
			extensions: [...this._node.extensions],
			meta: { ...this._node.meta },
			args: this._node.args ? [...this._node.args] : undefined,
			...nodeOverrides,
		};
		(cloned as { _node: CommandNode })._node = newNode;
		(cloned as { _ancestorOwnedFlags: FlagsDef })._ancestorOwnedFlags = this._ancestorOwnedFlags;
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
	 * defineCommand("issue", (cmd) =>
	 *   cmd.meta({ aliases: ["issues", "i"] }).handle(() => {})
	 * )
	 * ```
	 */
	meta(meta: Omit<CommandMeta, "name">): Crust<Local, Owned, A, Eff, Ctx> {
		return this._clone({
			meta: { ...this._node.meta, ...meta },
		}) as Crust<Local, Owned, A, Eff, Ctx>;
	}

	/**
	 * Define local flags for this command from named flag definitions
	 * (created with `defineFlag(name, def)` or written inline as
	 * `{ name: "dry-run", type: "boolean" }`).
	 *
	 * Repeated `.flags()` calls replace the local flags. Returns a new
	 * builder with updated local flag types. The original builder is not
	 * mutated.
	 *
	 * NOTE: Compile-time ancestor-owned/local cross-collision checks are intentionally
	 * omitted here to reduce TypeScript type-check cost in large projects.
	 * Runtime collision checks still run during parsing and command-tree validation.
	 *
	 * @param defs - Named flag definitions
	 * @returns A new `Crust` instance with the given flags
	 * @throws {CrustError} `DEFINITION` on duplicate names or schema-exclusivity violations
	 */
	flags<const Defs extends readonly NamedFlagDef[]>(
		...defs: ValidateNamedFlagDefs<Defs>
	): Crust<NamedFlagsRecord<Defs>, Owned, A, EffectiveFlags<NamedFlagsRecord<Defs>, Owned>, Ctx> {
		const copiedFlags: FlagsDef = {};
		for (const def of defs) {
			// Destructuring also decouples the stored def from the caller's object
			const { name, ...rest } = def as NamedFlagDef;
			if (typeof name !== "string" || name.length === 0) {
				throw new CrustError("DEFINITION", "Every flag definition must carry a non-empty name", {
					subject: "flag",
					reason: "missing-name",
				});
			}
			if (name in copiedFlags) {
				throw new CrustError(
					"DEFINITION",
					`Flag "--${name}" is defined more than once in one .flags() call`,
					{ subject: "flag", name, reason: "duplicate-flag" },
				);
			}
			validateSchemaExclusivity("flag", name, rest as Record<string, unknown>);
			// Include same-call siblings so short/alias collisions between two
			// definitions in one .flags() call fail here (DEFINITION errors throw
			// at the definition site), not at first run() via validateCommandTree.
			validateIncomingFlag(
				{ name, def: rest as FlagDef },
				{ ...this._node.ownedFlags, ...copiedFlags },
				`Command "${this._node.meta.name}"`,
			);
			copiedFlags[name] = rest as FlagDef;
		}

		return this._clone({
			localFlags: copiedFlags,
			effectiveFlags: computeEffectiveFlags(this._node.ownedFlags, copiedFlags),
		}) as unknown as Crust<
			NamedFlagsRecord<Defs>,
			Owned,
			A,
			EffectiveFlags<NamedFlagsRecord<Defs>, Owned>,
			Ctx
		>;
	}

	/**
	 * Define positional arguments for this command; argument order is the
	 * order they are passed (created with `defineArg(name, def)` or written
	 * inline).
	 *
	 * Returns a new builder with updated args types. The original
	 * builder is not mutated.
	 *
	 * @param defs - Positional argument definitions, in positional order
	 * @returns A new `Crust` instance with the given args
	 */
	args<const NewA extends ArgsDef>(
		...defs: NewA & ValidateVariadicArgs<NewA>
	): Crust<Local, Owned, NewA, Eff, Ctx> {
		for (const def of defs) {
			const record = def as unknown as Record<string, unknown>;
			validateSchemaExclusivity("arg", (def as ArgDef).name, record);
			// Schema args receive raw strings: a parser `type` would coerce first
			if (record.schema !== undefined && record.type !== undefined) {
				throw new CrustError(
					"DEFINITION",
					`arg "${(def as ArgDef).name}" mixes core option "type" with a schema — schema args receive the raw string token`,
					{
						subject: "arg",
						name: (def as ArgDef).name,
						reason: "schema-exclusive",
					},
				);
			}
		}
		// Deep copy arg defs to decouple from caller
		const copiedArgs = defs.map((def) => ({ ...def })) as unknown as ArgsDef;

		return this._clone({
			args: copiedArgs,
		}) as unknown as Crust<Local, Owned, NewA, Eff, Ctx>;
	}

	/**
	 * Attach Contexts — named command dependencies — to this command.
	 *
	 * Contexts are inherited by descendant commands, constructed
	 * topologically (by declared capability requirements) only for the resolved
	 * command path, and exposed to the Command Handler as `ctx`. Provide
	 * order is free: dependencies may be provided after their dependents.
	 * Values implementing `Symbol.dispose` or `Symbol.asyncDispose` are
	 * disposed in reverse construction order after success or failure.
	 *
	 * @throws {CrustError} `DEFINITION` when a name is already provided on
	 *                      this command path
	 */
	provide<const Cs extends readonly ContextInstance[]>(
		...instances: Cs
	): Crust<
		Local,
		MergeFlags<Owned, ContextsOwnedFlags<Cs>>,
		A,
		EffectiveFlags<Local, MergeFlags<Owned, ContextsOwnedFlags<Cs>>>,
		MergeContext<Ctx, ContextsOutput<Cs>>
	> {
		const contexts = [...this._node.contexts];
		const ownedFlags = { ...this._node.ownedFlags };
		const effectiveFlags = { ...this._node.effectiveFlags };
		for (const instance of instances) {
			this._assertContextProvidable(instance as ContextInstance, contexts);
			for (const [name, def] of Object.entries(instance.ownedFlags)) {
				validateIncomingFlag({ name, def }, effectiveFlags, `Context "${instance.name}"`);
				ownedFlags[name] = def;
				effectiveFlags[name] = def;
			}
			contexts.push(instance as ContextInstance);
		}
		return this._clone({
			contexts,
			ownedFlags,
			effectiveFlags,
		}) as unknown as Crust<
			Local,
			MergeFlags<Owned, ContextsOwnedFlags<Cs>>,
			A,
			EffectiveFlags<Local, MergeFlags<Owned, ContextsOwnedFlags<Cs>>>,
			MergeContext<Ctx, ContextsOutput<Cs>>
		>;
	}

	private _assertContextProvidable(
		instance: ContextInstance,
		existing: readonly ContextInstance[],
	): void {
		// Catches plain-JS misuse, most commonly passing the factory instead
		// of an instance (.provide(db) instead of .provide(db())).
		if ((instance as Partial<ContextInstance> | null)?.kind !== "context") {
			throw new CrustError(
				"DEFINITION",
				"provide() requires Context instances — invoke the factory returned by defineContext() (e.g. .provide(db(options)))",
				{ subject: "context", reason: "not-a-context" },
			);
		}
		if (existing.some((entry) => entry.name === instance.name)) {
			throw new CrustError(
				"DEFINITION",
				`Context "${instance.name}" is already provided on this command path`,
				{
					subject: "context",
					name: instance.name,
					reason: "duplicate-context",
				},
			);
		}
	}

	/**
	 * Define the Command Handler — the function that implements this
	 * command's behavior after its inputs and Contexts are ready.
	 *
	 * The handler receives a {@link CrustCommandContext} with `args` typed from
	 * `.args()` and `flags` typed as `EffectiveFlags<Local, Owned>`.
	 *
	 * Returns a new builder with the handler stored. The original builder is
	 * not mutated.
	 *
	 * @param handler - The Command Handler function
	 * @returns A new `Crust` instance with the handler registered
	 */
	handle(
		handler: (ctx: NoInfer<CrustCommandContext<A, Eff, Ctx>>) => void | Promise<void>,
	): Crust<Local, Owned, A, Eff, Ctx> {
		return this._clone({
			run: handler as (ctx: unknown) => void | Promise<void>,
		}) as Crust<Local, Owned, A, Eff, Ctx>;
	}

	/**
	 * Register one or more CLI Extensions on the application root.
	 *
	 * Extensions are application-wide: they own the flags and commands they
	 * contribute. Command definition builders do not expose this method.
	 */
	extend(...extensions: readonly Extension[]): Crust<Local, Owned, A, Eff, Ctx> {
		return this._clone({
			extensions: [...this._node.extensions, ...extensions],
		}) as Crust<Local, Owned, A, Eff, Ctx>;
	}

	/**
	 * Materialize and register inert reusable command definitions, each
	 * under its own carried name (use `.as(name)` to rename).
	 *
	 * Each definition's Context requirement names must already be provided
	 * on this builder's path — call `.provide()` before `.mount()`.
	 */
	mount<const Ds extends readonly CommandDefinition<any>[]>(
		...definitions: MountChecks<Ctx, Ds>
	): Crust<Local, Owned, A, Eff, Ctx> {
		let result = this as Crust<Local, Owned, A, Eff, Ctx>;
		for (const definition of definitions) {
			result = result._mountDefinition(definition as CommandDefinition);
		}
		return result;
	}

	private _mountDefinition(definition: CommandDefinition): Crust<Local, Owned, A, Eff, Ctx> {
		const childNode = materializeCommandDefinition(definition, this._node);

		return this._clone({
			subCommands: { ...this._node.subCommands, [definition.name]: childNode },
		}) as Crust<Local, Owned, A, Eff, Ctx>;
	}

	/**
	 * Invoke this application programmatically: resolve, parse, run the
	 * Extension hooks and the Command Handler for `argv`.
	 *
	 * Unlike {@link Crust.execute}, `run()` throws the original definition,
	 * parse, Context, or handler failure without rendering it (Extension
	 * `onError` hooks are a terminal presentation concern and never run
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
	 * renders a failure once (through Extension `onError` hooks, ending in
	 * Core's default renderer), sets `process.exitCode` (`1`, or
	 * `130` for an `AbortError` cancellation), and resolves.
	 *
	 * @param options - Optional overrides (e.g. custom `argv` and captured
	 *                   `io` for in-process testing of exit codes and
	 *                   rendered failures)
	 */
	async execute(options?: {
		argv?: string[];
		io?: { stdout?: (text: string) => void; stderr?: (text: string) => void };
	}): Promise<void> {
		const argv = options?.argv ?? process.argv.slice(2);
		const io: InvocationIO = { ...DEFAULT_IO, ...options?.io };

		let prepared: PreparedInvocation;
		try {
			prepared = prepareInvocation(this._node);
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

	/**
	 * Resolve and parse one invocation, then run Extension hooks and the
	 * Command Handler. Throws the original failure without rendering it or
	 * touching `process.exitCode`. Routing and syntax failures throw directly
	 * before hooks observe the invocation.
	 */
	private async _dispatch(
		argv: readonly string[],
		prepared: PreparedInvocation,
		io: InvocationIO,
		onExtensionContext?: (context: ExtensionContext) => void,
	): Promise<void> {
		const { rootNode, extensions } = prepared;

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
			finish: finishInvocation,
			stdout: io.stdout,
			stderr: io.stderr,
		});
		onExtensionContext?.(extensionContext);

		const terminal = async (): Promise<void> => {
			validateParsed(resolvedNode, parsed);

			if (!resolvedNode.run) return;

			// Standard Schemas on arg/flag definitions own value validation and
			// transformation; the handler receives schema outputs.
			const validated = await applySchemas(resolvedNode, parsed);

			// Native resource protocol: Context values implementing
			// Symbol.dispose/asyncDispose are disposed in reverse construction
			// order after success or failure (`await using` semantics).
			await using disposal = new AsyncDisposableStack();

			const context: CrustCommandContext = {
				args: validated.args as CrustCommandContext["args"],
				flags: validated.flags as CrustCommandContext["flags"],
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

	freezeTree(rootNode);

	return { rootNode, extensions };
}

/**
 * Prepare a frozen, validated Command Snapshot of an application with all
 * Extension contributions applied. Does not call Command Handlers.
 *
 * Explicitly unsupported tooling bridge, exposed only via
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
