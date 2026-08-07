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
import { validateIncomingFlag } from "../parsing/flag-validation.ts";
import { validateIncomingAliases } from "../parsing/validation.ts";
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
import {
	cloneCommandNode,
	executeInvocation,
	prepareInvocationSnapshot,
	runInvocation,
} from "./invocation.ts";
import { type CommandNode, computeEffectiveFlags, createCommandNode } from "./node.ts";
import type { CommandSnapshot } from "./snapshot.ts";

export { VALIDATION_FORCE_EXIT_ENV, VALIDATION_MODE_ENV } from "./invocation.ts";

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

	const childNode = cloneCommandNode(configured._node);
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
		// Programmatic calls preserve raw failures and never change process status.
		await runInvocation(this._node, argv, io, materializeCommandDefinition);
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
		// Terminal calls render failures and set process exit status instead of throwing.
		await executeInvocation(this._node, options, materializeCommandDefinition);
	}
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
	return prepareInvocationSnapshot(app._node, materializeCommandDefinition);
}
