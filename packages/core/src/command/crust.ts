import {
	buildContexts,
	type ContextInstance,
	type ContextMap,
	type ContextRequirements,
	type ContextsOutput,
	type MergeContext,
	type RequirementCtxOf,
	type RequirementFlagsOf,
} from "../api/context.ts";
import {
	finishInvocation,
	type Extension,
	type ExtensionContext,
	type InvocationOutcome,
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
	/** Readonly snapshot of the application root, including Extension contributions */
	rootCommand: CommandSnapshot;
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
// Reusable command definitions
// ────────────────────────────────────────────────────────────────────────────

/**
 * Requirements a command definition declares about its mount site: flags
 * it expects to inherit (as named flag definitions) and Contexts it
 * expects on its path (as their factories). Flag requirements are
 * compile-time checks at `.mount()`; ctx requirement names are also
 * verified at runtime when the definition is mounted.
 *
 * Structurally identical to {@link ContextRequirements} — the shared
 * shape is defined once in `api/context.ts`.
 */
export type CommandRequirements = ContextRequirements;

type RequirementFlags<R extends CommandRequirements> = RequirementFlagsOf<R>;

type RequirementContext<R extends CommandRequirements> = RequirementCtxOf<R>;

type AnyCommandDefinitionBuilder = CommandDefinitionBuilder<any, any, any, any, any>;

type CommandRecipe<R extends CommandRequirements> = (
	command: CommandDefinitionBuilder<
		RequirementFlags<R>,
		{},
		[],
		EffectiveFlags<RequirementFlags<R>, {}>,
		RequirementContext<R>
	>,
) => AnyCommandDefinitionBuilder;

const commandDefinitionInternal: unique symbol = Symbol("crust.commandDefinition");

interface CommandDefinitionInternal {
	readonly recipe: (command: AnyCommandDefinitionBuilder) => AnyCommandDefinitionBuilder;
	/** Context requirement names, runtime-checked at each mount site */
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

type FlagValue<D extends FlagDef> = InferFlags<{ value: D }>["value"];

type MissingFlagNames<Provided extends FlagsDef, Required extends FlagsDef> = Exclude<
	keyof Required,
	keyof Provided
> &
	string;

type IncompatibleFlagNames<Provided extends FlagsDef, Required extends FlagsDef> = {
	[K in keyof Required & keyof Provided]: FlagValue<Provided[K]> extends FlagValue<Required[K]>
		? never
		: K;
}[keyof Required & keyof Provided] &
	string;

/** Flag-requirement errors vs. the attach site's inheritable effective flags. */
type FlagRequirementErrors<
	ParentEff extends FlagsDef,
	Required extends FlagsDef,
	Provided extends FlagsDef = InheritableFlags<ParentEff>,
> = ([MissingFlagNames<Provided, Required>] extends [never]
	? {}
	: { readonly "missing inherited flags": MissingFlagNames<Provided, Required> }) &
	([IncompatibleFlagNames<Provided, Required>] extends [never]
		? {}
		: { readonly "incompatible inherited flags": IncompatibleFlagNames<Provided, Required> });

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
		: { readonly "incompatible Contexts": IncompatibleContextNames<Ctx, Required> });

type Mountable<
	ParentEff extends FlagsDef,
	Ctx extends ContextMap,
	R extends CommandRequirements,
> = FlagRequirementErrors<ParentEff, RequirementFlags<R>> &
	ContextRequirementErrors<Ctx, RequirementContext<R>>;

type DefinitionRequirements<D> = D extends CommandDefinition<infer R> ? R : never;

/** Per-definition mount checks (compile-time counterpart of the runtime attach checks). */
type MountChecks<
	ParentEff extends FlagsDef,
	Ctx extends ContextMap,
	Ds extends readonly CommandDefinition<any>[],
> = { [I in keyof Ds]: Ds[I] & Mountable<ParentEff, Ctx, DefinitionRequirements<Ds[I]>> };

type ContextRequiredFlags<C> = C extends ContextInstance<any, any, infer RF, any> ? RF : {};

/** Per-instance provide checks: declared flag requirements vs. the builder's inheritable flags. */
type ProvideChecks<ParentEff extends FlagsDef, Cs extends readonly ContextInstance[]> = {
	[I in keyof Cs]: Cs[I] & FlagRequirementErrors<ParentEff, ContextRequiredFlags<Cs[I]>>;
};

export interface CommandDefinitionBuilder<
	Inherited extends FlagsDef = FlagsDef,
	Local extends FlagsDef = FlagsDef,
	A extends ArgsDef = ArgsDef,
	Eff extends FlagsDef = EffectiveFlags<Inherited, Local>,
	Ctx extends ContextMap = {},
> {
	meta(meta: Omit<CommandMeta, "name">): CommandDefinitionBuilder<Inherited, Local, A, Eff, Ctx>;

	flags<const Defs extends readonly NamedFlagDef[]>(
		...defs: ValidateNamedFlagDefs<Defs>
	): CommandDefinitionBuilder<
		Inherited,
		NamedFlagsRecord<Defs>,
		A,
		EffectiveFlags<Inherited, NamedFlagsRecord<Defs>>,
		Ctx
	>;

	args<const NewA extends ArgsDef>(
		...defs: NewA & ValidateVariadicArgs<NewA>
	): CommandDefinitionBuilder<Inherited, Local, NewA, Eff, Ctx>;

	provide<const Cs extends readonly ContextInstance[]>(
		...instances: ProvideChecks<Eff, Cs>
	): CommandDefinitionBuilder<Inherited, Local, A, Eff, MergeContext<Ctx, ContextsOutput<Cs>>>;

	mount<const Ds extends readonly CommandDefinition<any>[]>(
		...definitions: MountChecks<Eff, Ctx, Ds>
	): CommandDefinitionBuilder<Inherited, Local, A, Eff, Ctx>;

	handle(
		handler: (ctx: NoInfer<CrustCommandContext<A, Eff, Ctx>>) => void | Promise<void>,
	): CommandDefinitionBuilder<Inherited, Local, A, Eff, Ctx>;
}

/**
 * Define a reusable, inert command under a required name.
 *
 * The recipe runs once per `.mount()`, receiving a fresh builder typed by
 * the declared requirements: `requirements.flags` (named flag definitions
 * the mount site must provide as inheritable flags) and `requirements.ctx`
 * (Context factories whose instances must be provided on the mount path).
 *
 * Use `.as(name)` to mount one definition under a different name.
 */
export function defineCommand(name: string, recipe: CommandRecipe<{}>): CommandDefinition;
export function defineCommand<const R extends CommandRequirements>(
	name: string,
	requirements: R,
	recipe: CommandRecipe<R>,
): CommandDefinition<R>;
export function defineCommand(
	name: string,
	requirementsOrRecipe: CommandRequirements | CommandRecipe<CommandRequirements>,
	maybeRecipe?: CommandRecipe<CommandRequirements>,
): CommandDefinition<CommandRequirements> {
	const hasRequirements = typeof requirementsOrRecipe !== "function";
	const requirements = hasRequirements ? requirementsOrRecipe : {};
	const recipe = hasRequirements ? maybeRecipe : requirementsOrRecipe;
	if (typeof recipe !== "function") {
		throw new CrustError("DEFINITION", `Command definition "${name}" requires a recipe function`, {
			subject: "command",
			name,
			reason: "missing-recipe",
		});
	}
	const internal: CommandDefinitionInternal = {
		recipe: recipe as CommandDefinitionInternal["recipe"],
		requiredCtxNames: (requirements.ctx ?? []).map((dep) => dep.contextName),
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
 * - `Inherited` — flags inherited from a parent command (populated when mounted)
 * - `Local` — flags defined on this command via `.flags()`
 * - `A` — positional argument definitions
 * - `Eff` — effective flags (merged inherited + local flags, computed internally)
 *
 * @example
 * ```ts
 * const app = new Crust("my-cli")
 *   .flags({ name: "verbose", type: "boolean", short: "v", inherit: true })
 *   .args({ name: "file", type: "string", required: true })
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
			contexts: [...this._node.contexts],
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
	 * defineCommand("issue", (cmd) =>
	 *   cmd.meta({ aliases: ["issues", "i"] }).handle(() => {})
	 * )
	 * ```
	 */
	meta(meta: Omit<CommandMeta, "name">): Crust<Inherited, Local, A, Eff, Ctx> {
		return this._clone({
			meta: { ...this._node.meta, ...meta },
		}) as Crust<Inherited, Local, A, Eff, Ctx>;
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
	 * NOTE: Compile-time inherited/local cross-collision checks are intentionally
	 * omitted here to reduce TypeScript type-check cost in large projects.
	 * Runtime collision checks still run during parsing and command-tree validation.
	 *
	 * @param defs - Named flag definitions
	 * @returns A new `Crust` instance with the given flags
	 * @throws {CrustError} `DEFINITION` on duplicate names or schema-exclusivity violations
	 */
	flags<const Defs extends readonly NamedFlagDef[]>(
		...defs: ValidateNamedFlagDefs<Defs>
	): Crust<
		Inherited,
		NamedFlagsRecord<Defs>,
		A,
		EffectiveFlags<Inherited, NamedFlagsRecord<Defs>>,
		Ctx
	> {
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
			copiedFlags[name] = rest as FlagDef;
		}

		return this._clone({
			localFlags: copiedFlags,
			effectiveFlags: computeEffectiveFlags(this._inheritedFlags, copiedFlags),
		}) as unknown as Crust<
			Inherited,
			NamedFlagsRecord<Defs>,
			A,
			EffectiveFlags<Inherited, NamedFlagsRecord<Defs>>,
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
	): Crust<Inherited, Local, NewA, Eff, Ctx> {
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
		}) as unknown as Crust<Inherited, Local, NewA, Eff, Ctx>;
	}

	/**
	 * Attach Contexts — named command dependencies — to this command.
	 *
	 * Contexts are inherited by descendant commands, constructed
	 * topologically (by declared ctx requirements) only for the resolved
	 * command path, and exposed to the Command Handler as `ctx`. Provide
	 * order is free: dependencies may be provided after their dependents.
	 * Values implementing `Symbol.dispose` or `Symbol.asyncDispose` are
	 * disposed in reverse construction order after success or failure.
	 *
	 * A Context's declared flag requirements are checked here: each
	 * required flag must already be declared with `inherit: true` on this
	 * builder — declare flags before `.provide()`.
	 *
	 * @throws {CrustError} `DEFINITION` when a name is already provided on
	 *                      this command path or a required flag is missing
	 */
	provide<const Cs extends readonly ContextInstance[]>(
		...instances: ProvideChecks<Eff, Cs>
	): Crust<Inherited, Local, A, Eff, MergeContext<Ctx, ContextsOutput<Cs>>> {
		const contexts = [...this._node.contexts];
		for (const instance of instances) {
			this._assertContextProvidable(instance as ContextInstance, contexts);
			contexts.push(instance as ContextInstance);
		}
		return this._clone({ contexts }) as unknown as Crust<
			Inherited,
			Local,
			A,
			Eff,
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
				{ subject: "context", name: instance.name, reason: "duplicate-context" },
			);
		}
		for (const flagName of Object.keys(instance.requiredFlags)) {
			if (this._node.effectiveFlags[flagName]?.inherit !== true) {
				throw new CrustError(
					"DEFINITION",
					`Context "${instance.name}" requires flag "--${flagName}", which is not declared with inherit: true on "${this._node.meta.name}" — declare flags before .provide()`,
					{ subject: "context", name: instance.name, reason: "missing-required-flag" },
				);
			}
		}
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
		}) as Crust<Inherited, Local, A, Eff, Ctx>;
	}

	/**
	 * Register one or more CLI Extensions on the application root.
	 *
	 * Extensions are application-wide: they own the flags and commands they
	 * contribute. Command definition builders do not expose this method.
	 */
	extend(...extensions: readonly Extension[]): Crust<Inherited, Local, A, Eff, Ctx> {
		return this._clone({
			extensions: [...this._node.extensions, ...extensions],
		}) as Crust<Inherited, Local, A, Eff, Ctx>;
	}

	/**
	 * Materialize and register inert reusable command definitions, each
	 * under its own carried name (use `.as(name)` to rename).
	 *
	 * Each definition's Context requirement names must already be provided
	 * on this builder's path — call `.provide()` before `.mount()`.
	 */
	mount<const Ds extends readonly CommandDefinition<any>[]>(
		...definitions: MountChecks<Eff, Ctx, Ds>
	): Crust<Inherited, Local, A, Eff, Ctx> {
		let result = this as Crust<Inherited, Local, A, Eff, Ctx>;
		for (const definition of definitions) {
			result = result._mountDefinition(definition as CommandDefinition);
		}
		return result;
	}

	private _mountDefinition(definition: CommandDefinition): Crust<Inherited, Local, A, Eff, Ctx> {
		const internal = (definition as Partial<CommandDefinition> | null)?.[commandDefinitionInternal];
		if (internal === undefined) {
			throw new CrustError(
				"DEFINITION",
				"mount() requires a command definition created by defineCommand()",
			);
		}
		const name = definition.name;
		if (this._node.subCommands[name]) {
			throw new CrustError("DEFINITION", `Subcommand "${name}" is already registered`);
		}

		// Runtime counterpart of the compile-time Mountable check: a mounted
		// definition's Context requirements must already be provided on this
		// path, so a missing dependency fails here instead of surfacing as a
		// silently-undefined ctx value at dispatch.
		const providedNames = new Set(this._node.contexts.map((context) => context.name));
		for (const ctxName of internal.requiredCtxNames) {
			if (!providedNames.has(ctxName)) {
				throw new CrustError(
					"DEFINITION",
					`Command "${name}" requires Context "${ctxName}", which is not provided on "${this._node.meta.name}" — call .provide() before .mount()`,
					{ subject: "context", name: ctxName, reason: "missing-context" },
				);
			}
		}

		const recipe = internal.recipe;
		const parentEffective = computeEffectiveFlags(this._inheritedFlags, this._node.localFlags);
		const child = new Crust(name);
		(child as { _inheritedFlags: FlagsDef })._inheritedFlags = parentEffective;
		child._node.effectiveFlags = computeEffectiveFlags(parentEffective, {});
		(child._node as { contexts: ContextInstance[] }).contexts = [...this._node.contexts];

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
		}) as Crust<Inherited, Local, A, Eff, Ctx>;
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
	 * @param options - Optional overrides (e.g. custom `argv` for testing)
	 */
	async execute(options?: { argv?: string[] }): Promise<void> {
		const argv = options?.argv ?? process.argv.slice(2);
		const io = DEFAULT_IO;

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
				process.exitCode = EXIT_CODE_CANCELLED;
				return;
			}
			// Core always preserves a nonzero failure outcome, regardless of
			// what Extension onError hooks do (ADR-0001).
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
			// transformation (ADR-0005); the handler receives schema outputs.
			const validated = await applySchemas(resolvedNode, parsed);

			// Native resource protocol: Context values implementing
			// Symbol.dispose/asyncDispose are disposed in reverse construction
			// order after success or failure (`await using` semantics).
			await using disposal = new AsyncDisposableStack();

			const context: CrustCommandContext = {
				args: validated.args as CrustCommandContext["args"],
				flags: validated.flags as CrustCommandContext["flags"],
				// Context setups receive the same validated flags the handler gets
				ctx: await buildContexts(
					resolvedNode.contexts,
					validated.flags as Record<string, unknown>,
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
): Promise<void> {
	const renderDefault = (): void => {
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
