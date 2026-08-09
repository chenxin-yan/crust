import type {
	AnyContextFactory,
	ContextInstance,
	ContextMap,
	ContextsOutput,
	ContextsOwnedFlags,
	MergeContext,
	RequirementCtxOf,
} from "../api/context.ts";
import type { Extension } from "../api/extension.ts";
import { CrustError } from "../errors.ts";
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
} from "../types.ts";
import {
	type AppendArgsChecks,
	validateSchemaExclusivity,
	validateVariadicArgPosition,
} from "../validation/args.ts";
import {
	type AliasesOf,
	type CommandDefinitionSpellings,
	validateIncomingAliases,
	type ValidateCommandConfig,
	type ValidateCommandDefinitions,
} from "../validation/commands.ts";
import {
	type ContextDeps,
	type MergeContextDeps,
	validateIncomingContext,
	type ValidateContextCycles,
	type ValidateContextNames,
} from "../validation/contexts.ts";
import {
	type ProvideChecks,
	type SpellingsOf,
	validateIncomingFlag,
	type ValidateNamedFlagDefs,
} from "../validation/flags.ts";
import {
	cloneCommandNode,
	executeInvocation,
	prepareInvocationSnapshot,
	runInvocation,
} from "./invocation.ts";
import { type CommandNode, computeEffectiveFlags, createCommandNode } from "./node.ts";
import type { CommandSnapshot } from "./snapshot.ts";

export { SNAPSHOT_PATH_ENV } from "./invocation.ts";

// ────────────────────────────────────────────────────────────────────────────
// CrustCommandContext — Runtime context for lifecycle hooks
// ────────────────────────────────────────────────────────────────────────────

/**
 * The runtime context object passed to the Command Action defined with
 * `.action()`.
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

// ────────────────────────────────────────────────────────────────────────────
// Reusable command definitions
// ────────────────────────────────────────────────────────────────────────────

/** Context capabilities a command definition requires from its parent path. */
export interface CommandRequirements {
	readonly requires?: readonly AnyContextFactory[];
}

/** Static configuration for a reusable command definition. */
export interface CommandConfig extends Omit<CommandMeta, "name">, CommandRequirements {}

/** Static metadata accepted by the root command constructor. */
export type RootCommandMeta = Pick<CommandMeta, "description" | "usage">;

type RequirementContext<R extends CommandRequirements> = RequirementCtxOf<R>;

type ConfigRequirements<C extends CommandConfig> = C extends {
	readonly requires: infer R extends readonly AnyContextFactory[];
}
	? { readonly requires: R }
	: {};

type AnyCommandDefinitionBuilder = CommandDefinitionBuilder<any, any, any, any, any, any, any>;

// Child builders start at `Eff = {}`: collisions with ancestor-owned flags
// are runtime-only (caught by tree validation), since the parent's effective
// flags are unknown until the definition is added.
type CommandRecipe<R extends CommandRequirements> = (
	command: CommandDefinitionBuilder<{}, {}, [], EffectiveFlags<{}>, RequirementContext<R>>,
) => AnyCommandDefinitionBuilder;

const commandDefinitionInternal: unique symbol = Symbol.for("crust.commandDefinition");

interface CommandDefinitionInternal {
	readonly recipe: (command: AnyCommandDefinitionBuilder) => AnyCommandDefinitionBuilder;
	readonly meta: Omit<CommandMeta, "name">;
	/** Requirement names, runtime-checked when the definition is added */
	readonly requiredCtxNames: readonly string[];
}

export interface CommandDefinition<
	R extends CommandRequirements = {},
	Name extends string = string,
	Aliases extends readonly string[] = readonly string[],
> {
	/** The subcommand name this definition is added under */
	readonly name: Name;
	/** The same definition under a different name; configured aliases travel with it. */
	as<const N extends string>(name: N): CommandDefinition<R, N, Aliases>;
	/** @internal */
	readonly [commandDefinitionInternal]: CommandDefinitionInternal;
	/** @internal — phantom carrying the requirements for add-time checks */
	readonly _requirements?: R;
	/** @internal — phantom carrying configured alias literals for add-time checks */
	readonly _aliases?: Aliases;
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
			"add() requires a command definition created by defineCommand()",
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
				: `Command "${name}" requires Context "${ctxName}", which is not provided on "${parent.meta.name}" — call .provide() before .add()`;
			throw new CrustError("DEFINITION", message, {
				subject: "context",
				name: ctxName,
				reason: "missing-context",
			});
		}
	}

	validateIncomingAliases(
		{ canonicalName: name, aliases: internal.meta.aliases },
		parent.subCommands,
		name,
	);

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

	const childNode = cloneCommandNode(configured._node);
	childNode.meta = { name, ...internal.meta };
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

type DefinitionRequirements<D> = D extends CommandDefinition<infer R, any, any> ? R : never;

// Bare `Crust` uses broad `ArgsDef` for structural consumers; a `.args()` call on
// that broad type only reflects the new defs (runtime still appends to any args a
// widened builder already carries), while already-refined builders append in-type.
type AppendedArgs<A extends ArgsDef, NewA extends ArgsDef> = ArgsDef extends A
	? NewA
	: readonly [...A, ...NewA];

/** Per-definition add-time checks (compile-time counterpart of the runtime attach checks). */
type AddChecks<
	Ctx extends ContextMap,
	Sibs extends string,
	Ds extends readonly CommandDefinition<any>[],
> = ValidateCommandDefinitions<Ds, Sibs> & {
	[I in keyof Ds]: Ds[I] &
		ContextRequirementErrors<Ctx, RequirementContext<DefinitionRequirements<Ds[I]>>>;
};

/**
 * Configure-only command builder.
 *
 * Generic parameters mirror {@link Crust}; `Sp` caches the flag spellings
 * accumulated by `.flags()` and `.provide()` for compile-time collision checks.
 */
export interface CommandDefinitionBuilder<
	Local extends FlagsDef = {},
	Owned extends FlagsDef = {},
	A extends ArgsDef = ArgsDef,
	Eff extends FlagsDef = EffectiveFlags<Local, Owned>,
	Ctx extends ContextMap = {},
	Deps extends ContextDeps = {},
	Sibs extends string = never,
	Sp extends string = SpellingsOf<Eff>,
> {
	flags<const Defs extends readonly NamedFlagDef[]>(
		...defs: ValidateNamedFlagDefs<Defs, Sp>
	): CommandDefinitionBuilder<
		MergeFlags<Local, NamedFlagsRecord<Defs>>,
		Owned,
		A,
		EffectiveFlags<MergeFlags<Local, NamedFlagsRecord<Defs>>, Owned>,
		Ctx,
		Deps,
		Sibs,
		Sp | SpellingsOf<NamedFlagsRecord<Defs>>
	>;

	args<const NewA extends ArgsDef>(
		...defs: NewA & AppendArgsChecks<A, NewA>
	): CommandDefinitionBuilder<Local, Owned, AppendedArgs<A, NewA>, Eff, Ctx, Deps, Sibs, Sp>;

	provide<const Cs extends readonly ContextInstance[]>(
		...instances: ProvideChecks<Sp, Cs> &
			ValidateContextCycles<Deps, Cs> &
			ValidateContextNames<Ctx, Cs>
	): CommandDefinitionBuilder<
		Local,
		MergeFlags<Owned, ContextsOwnedFlags<Cs>>,
		A,
		EffectiveFlags<Local, MergeFlags<Owned, ContextsOwnedFlags<Cs>>>,
		MergeContext<Ctx, ContextsOutput<Cs>>,
		MergeContextDeps<Deps, Cs>,
		Sibs,
		Sp | SpellingsOf<ContextsOwnedFlags<Cs>>
	>;

	add<const Ds extends readonly CommandDefinition<any>[]>(
		...definitions: Ds & AddChecks<Ctx, Sibs, Ds>
	): CommandDefinitionBuilder<
		Local,
		Owned,
		A,
		Eff,
		Ctx,
		Deps,
		Sibs | CommandDefinitionSpellings<Ds[number]>,
		Sp
	>;

	action(
		action: (ctx: NoInfer<CrustCommandContext<A, Eff, Ctx>>) => void | Promise<void>,
	): CommandDefinitionBuilder<Local, Owned, A, Eff, Ctx, Deps, Sibs, Sp>;
}

/**
 * Define a reusable, inert command under a required name.
 *
 * The recipe runs once per `.add()`, receiving a fresh builder typed by
 * the declared Context capabilities, which must be provided on the parent path.
 *
 * Static metadata and Context requirements belong in `config`. Use `.as(name)`
 * to add one definition under a different name; configured aliases travel with it.
 */
export function defineCommand<const Name extends string>(
	name: Name,
	recipe: CommandRecipe<{}>,
): CommandDefinition<{}, Name>;
export function defineCommand<const Name extends string, const C extends CommandConfig>(
	name: Name,
	config: C & ValidateCommandConfig<Name, C>,
	recipe: CommandRecipe<ConfigRequirements<C>>,
): CommandDefinition<ConfigRequirements<C>, Name, AliasesOf<C>>;
export function defineCommand(
	name: string,
	configOrRecipe: CommandConfig | CommandRecipe<CommandRequirements>,
	maybeRecipe?: CommandRecipe<CommandRequirements>,
): CommandDefinition<CommandRequirements> {
	const hasConfig = typeof configOrRecipe !== "function";
	const config: CommandConfig = hasConfig ? configOrRecipe : {};
	const recipe = hasConfig ? maybeRecipe : configOrRecipe;
	if (typeof recipe !== "function") {
		throw new CrustError("DEFINITION", `Command definition "${name}" requires a recipe function`, {
			subject: "command",
			name,
			reason: "missing-recipe",
		});
	}
	const { requires, ...meta } = config;
	const internal: CommandDefinitionInternal = {
		recipe: recipe as CommandDefinitionInternal["recipe"],
		meta: meta.aliases ? { ...meta, aliases: [...meta.aliases] } : meta,
		requiredCtxNames: (requires ?? []).map((dep) => dep.contextName),
	};
	const named = <const DefName extends string>(
		defName: DefName,
	): CommandDefinition<CommandRequirements, DefName> => {
		if (!defName.trim()) {
			throw new CrustError("DEFINITION", "Command name must be a non-empty string", {
				subject: "command",
				reason: "empty-name",
			});
		}
		return Object.freeze({
			name: defName,
			as: <const NewName extends string>(newName: NewName) => named(newName),
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
 * - `Ctx` — provided Context values
 * - `Deps` — provided Context dependency edges used for cycle detection
 * - `Sibs` — sibling command names and aliases already registered
 * - `Sp` — accumulated flag spellings used for collision checks
 *
 * @example
 * ```ts
 * const app = new Crust("my-cli")
 *   .flags({ name: "verbose", type: "boolean", short: "v" })
 *   .args({ name: "file", type: "string", required: true })
 *   .action(({ args, flags }) => {
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
	Deps extends ContextDeps = {},
	Sibs extends string = never,
	Sp extends string = SpellingsOf<Eff>,
> {
	/** @internal — Phantom property exposing generic parameters for type-level testing */
	declare readonly _types: {
		local: Local;
		owned: Owned;
		args: A;
		effective: Eff;
		ctx: Ctx;
		// Method syntax keeps broad/legacy Crust annotations assignable while
		// exposing Sp to type-level tests through Parameters<>.
		spellings(spelling: Sp): void;
	};

	/** @internal */
	readonly _node: CommandNode;

	/** @internal — Runtime identity anchor for the ancestor-owned flag carrier */
	readonly _ancestorOwnedFlags: FlagsDef;

	/**
	 * Create a new root command builder.
	 *
	 * @param name - The command name.
	 * @param meta - Optional root description and usage.
	 * @throws {CrustError} `DEFINITION` if name is empty or whitespace-only
	 */
	constructor(name: string, meta: RootCommandMeta = {}) {
		if (!name.trim()) {
			throw new CrustError("DEFINITION", "meta.name must be a non-empty string");
		}
		this._node = createCommandNode(name);
		if (meta.description !== undefined) this._node.meta.description = meta.description;
		if (meta.usage !== undefined) this._node.meta.usage = meta.usage;
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
	 * Define local flags for this command from named flag definitions
	 * (created with `defineFlag(name, def)` or written inline as
	 * `{ name: "dry-run", type: "boolean" }`).
	 *
	 * Repeated `.flags()` calls accumulate local flags. Returns a new builder
	 * with the combined local flag types. The original builder is not mutated.
	 *
	 * @param defs - Named flag definitions
	 * @returns A new `Crust` instance with the given flags
	 * @throws {CrustError} `DEFINITION` on duplicate names or spellings, or schema-exclusivity violations
	 */
	flags<const Defs extends readonly NamedFlagDef[]>(
		...defs: ValidateNamedFlagDefs<Defs, Sp>
	): Crust<
		MergeFlags<Local, NamedFlagsRecord<Defs>>,
		Owned,
		A,
		EffectiveFlags<MergeFlags<Local, NamedFlagsRecord<Defs>>, Owned>,
		Ctx,
		Deps,
		Sibs,
		Sp | SpellingsOf<NamedFlagsRecord<Defs>>
	> {
		const copiedFlags: FlagsDef = { ...this._node.localFlags };
		for (const def of defs) {
			// Destructuring also decouples the stored def from the caller's object
			const { name, ...rest } = def as NamedFlagDef;
			if (Object.hasOwn(copiedFlags, name)) {
				throw new CrustError("DEFINITION", `Flag "--${name}" is already defined`, {
					subject: "flag",
					name,
					reason: "duplicate-flag",
				});
			}
			validateSchemaExclusivity("flag", name, rest as FlagDef);
			// Include flags from earlier calls and same-call siblings so spelling
			// collisions fail at the definition site, not at first run().
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
			MergeFlags<Local, NamedFlagsRecord<Defs>>,
			Owned,
			A,
			EffectiveFlags<MergeFlags<Local, NamedFlagsRecord<Defs>>, Owned>,
			Ctx,
			Deps,
			Sibs,
			Sp | SpellingsOf<NamedFlagsRecord<Defs>>
		>;
	}

	/**
	 * Define positional arguments for this command; argument order is the
	 * order they are passed (created with `defineArg(name, def)` or written
	 * inline).
	 *
	 * Repeated `.args()` calls append in call order. Returns a new builder with
	 * the combined args types. The original builder is not mutated.
	 *
	 * @param defs - Positional argument definitions, in positional order
	 * @returns A new `Crust` instance with the combined args
	 * @throws {CrustError} `DEFINITION` on duplicate names, a non-final variadic arg, or schema-exclusivity violations
	 */
	args<const NewA extends ArgsDef>(
		...defs: NewA & AppendArgsChecks<A, NewA>
	): Crust<Local, Owned, AppendedArgs<A, NewA>, Eff, Ctx, Deps, Sibs, Sp> {
		for (const def of defs) {
			const argDef = def as ArgDef;
			const argName = argDef.name;
			if (typeof argName !== "string" || argName.length === 0) {
				throw new CrustError(
					"DEFINITION",
					"Every argument definition must carry a non-empty name",
					{
						subject: "arg",
						reason: "missing-name",
					},
				);
			}
			validateSchemaExclusivity("arg", argName, argDef);
		}
		// Deep copy new defs to decouple storage from the caller.
		const copiedArgs = [...(this._node.args ?? []), ...defs.map((def) => ({ ...def }))] as ArgsDef;
		const names = new Set<string>();
		for (const [index, def] of copiedArgs.entries()) {
			if (names.has(def.name)) {
				throw new CrustError("DEFINITION", `Argument "${def.name}" is already defined`, {
					subject: "arg",
					name: def.name,
					reason: "duplicate-arg",
				});
			}
			names.add(def.name);
			validateVariadicArgPosition(def, index, copiedArgs.length);
		}

		return this._clone({
			args: copiedArgs,
		}) as unknown as Crust<Local, Owned, AppendedArgs<A, NewA>, Eff, Ctx, Deps, Sibs, Sp>;
	}

	/**
	 * Attach Contexts — named command dependencies — to this command.
	 *
	 * Contexts are inherited by descendant commands, constructed
	 * topologically (by declared capability requirements) only for the resolved
	 * command path, and exposed to the Command Action as `ctx`. Provide
	 * order is free: dependencies may be provided after their dependents.
	 * Values implementing `Symbol.dispose` or `Symbol.asyncDispose` are
	 * disposed in reverse construction order after success or failure.
	 *
	 * @throws {CrustError} `DEFINITION` when a name is already provided on
	 *                      this command path
	 */
	provide<const Cs extends readonly ContextInstance[]>(
		...instances: ProvideChecks<Sp, Cs> &
			ValidateContextCycles<Deps, Cs> &
			ValidateContextNames<Ctx, Cs>
	): Crust<
		Local,
		MergeFlags<Owned, ContextsOwnedFlags<Cs>>,
		A,
		EffectiveFlags<Local, MergeFlags<Owned, ContextsOwnedFlags<Cs>>>,
		MergeContext<Ctx, ContextsOutput<Cs>>,
		MergeContextDeps<Deps, Cs>,
		Sibs,
		Sp | SpellingsOf<ContextsOwnedFlags<Cs>>
	> {
		const contexts = [...this._node.contexts];
		const ownedFlags = { ...this._node.ownedFlags };
		const effectiveFlags = { ...this._node.effectiveFlags };
		for (const instance of instances) {
			validateIncomingContext(instance as ContextInstance, contexts);
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
			MergeContext<Ctx, ContextsOutput<Cs>>,
			MergeContextDeps<Deps, Cs>,
			Sibs,
			Sp | SpellingsOf<ContextsOwnedFlags<Cs>>
		>;
	}

	/**
	 * Define the Command Action — the function that implements this
	 * command's behavior after its inputs and Contexts are ready.
	 *
	 * The action receives a {@link CrustCommandContext} with `args` typed from
	 * `.args()` and `flags` typed as `EffectiveFlags<Local, Owned>`.
	 *
	 * An action is set once; calling `.action()` again throws rather than
	 * silently replacing command behavior. The original builder is not mutated.
	 *
	 * @param action - The Command Action function
	 * @returns A new `Crust` instance with the action registered
	 * @throws {CrustError} `DEFINITION` when this command already has an action
	 */
	action(
		action: (ctx: NoInfer<CrustCommandContext<A, Eff, Ctx>>) => void | Promise<void>,
	): Crust<Local, Owned, A, Eff, Ctx, Deps, Sibs, Sp> {
		if (this._node.run) {
			throw new CrustError(
				"DEFINITION",
				`Command "${this._node.meta.name}" already has an action`,
				{ subject: "command", name: this._node.meta.name, reason: "duplicate-action" },
			);
		}
		return this._clone({
			run: action as (ctx: unknown) => void | Promise<void>,
		}) as Crust<Local, Owned, A, Eff, Ctx, Deps, Sibs, Sp>;
	}

	/**
	 * Register one or more CLI Extensions on the application root.
	 *
	 * Extensions are application-wide: they own the flags and commands they
	 * contribute. Repeated calls accumulate Extensions in registration order;
	 * duplicate names throw. Command definition builders do not expose this method.
	 *
	 * @throws {CrustError} `DEFINITION` when an Extension name is already registered
	 */
	extend(...extensions: readonly Extension[]): Crust<Local, Owned, A, Eff, Ctx, Deps, Sibs, Sp> {
		const names = new Set(this._node.extensions.map((extension) => extension.name));
		for (const extension of extensions) {
			if (names.has(extension.name)) {
				throw new CrustError("DEFINITION", `Extension "${extension.name}" is already registered`, {
					subject: "extension",
					name: extension.name,
					reason: "duplicate-extension",
				});
			}
			names.add(extension.name);
		}
		return this._clone({
			extensions: [...this._node.extensions, ...extensions],
		}) as Crust<Local, Owned, A, Eff, Ctx, Deps, Sibs, Sp>;
	}

	/**
	 * Materialize and register inert reusable command definitions, each
	 * under its own carried name (use `.as(name)` to rename).
	 *
	 * Each definition's Context requirement names must already be provided
	 * on this builder's path — call `.provide()` before `.add()`.
	 */
	add<const Ds extends readonly CommandDefinition<any>[]>(
		...definitions: Ds & AddChecks<Ctx, Sibs, Ds>
	): Crust<Local, Owned, A, Eff, Ctx, Deps, Sibs | CommandDefinitionSpellings<Ds[number]>, Sp> {
		let result = this as Crust<Local, Owned, A, Eff, Ctx, Deps, Sibs, Sp>;
		for (const definition of definitions) {
			result = result._addDefinition(definition as CommandDefinition);
		}
		return result as Crust<
			Local,
			Owned,
			A,
			Eff,
			Ctx,
			Deps,
			Sibs | CommandDefinitionSpellings<Ds[number]>,
			Sp
		>;
	}

	private _addDefinition(
		definition: CommandDefinition,
	): Crust<Local, Owned, A, Eff, Ctx, Deps, Sibs, Sp> {
		const childNode = materializeCommandDefinition(definition, this._node);

		return this._clone({
			subCommands: { ...this._node.subCommands, [definition.name]: childNode },
		}) as Crust<Local, Owned, A, Eff, Ctx, Deps, Sibs, Sp>;
	}

	/**
	 * Prepare a frozen, validated Command Snapshot for tooling such as
	 * man-page, skill, and build generators.
	 *
	 * Materializes Extension contributions and command definitions, then
	 * validates the resulting command tree. Does not call Command Actions.
	 * Rejects with a `CrustError` of code `DEFINITION` when materialization
	 * or validation fails.
	 */
	async snapshot(): Promise<CommandSnapshot> {
		return prepareInvocationSnapshot(this._node, materializeCommandDefinition);
	}

	/**
	 * Invoke this application programmatically: resolve, parse, run the
	 * Extension hooks and the Command Action for `argv`.
	 *
	 * Unlike {@link Crust.execute}, `run()` throws the original definition,
	 * parse, Context, or action failure without rendering it (Extension
	 * `onError` hooks are a terminal presentation concern and never run
	 * here) and without changing process status. It resolves with no value
	 * after successful cleanup. Prompt cancellation surfaces as a standard
	 * `AbortError`.
	 *
	 * @param argv - Arguments to parse (no `process.argv` default — pass them explicitly)
	 * @param io - Optional `stdout(text)` / `stderr(text)` callbacks, also
	 *             exposed to Command Actions and Extensions
	 */
	async run(argv: readonly string[], io?: Partial<InvocationIO>): Promise<void> {
		// Programmatic calls preserve raw failures and never change process status.
		await runInvocation(this._node, argv, io, materializeCommandDefinition);
	}

	/**
	 * Parse `process.argv`, resolve subcommands, run Extension hooks, and
	 * execute the matched Command Action.
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
	async execute(options?: { argv?: string[]; io?: Partial<InvocationIO> }): Promise<void> {
		// Terminal calls render failures and set process exit status instead of throwing.
		await executeInvocation(this._node, options, materializeCommandDefinition);
	}
}
