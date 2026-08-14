import type {
	AnyContextFactory,
	ContextInstance,
	ContextMap,
	ContextsOutput,
	FactoriesOwnedFlags,
	ContextsOwnedFlags,
	MergeContext,
	RequirementCtxOf,
} from "../api/context.ts";
import type { Extension } from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import { cloneFlagSpellings } from "../parsing/spellings.ts";
import type {
	ArgDef,
	ArgsDef,
	CommandMeta,
	FlagDef,
	FlagsDef,
	InferArgs,
	InferFlags,
	InputArgs,
	InputFlags,
	InvocationIO,
	MergeFlags,
	NamedFlagDef,
	NamedFlagsRecord,
} from "../types.ts";
import type { AppendArgsChecks } from "../validation/args.brands.ts";
import type {
	AliasesOf,
	CommandDefinitionSpellings,
	ValidateCommandConfig,
	ValidateCommandDefinitions,
} from "../validation/commands.brands.ts";
import { commandCollision } from "../validation/commands.rules.ts";
import type { ValidateContextNames } from "../validation/contexts.brands.ts";
import type {
	ProvideChecks,
	SpellingsOf,
	ValidateNamedFlagDefs,
} from "../validation/flags.brands.ts";
import { normalizeArgs, normalizeContext, normalizeFlag } from "../validation/normalize.ts";
import {
	cloneCommandNode,
	executeInvocation,
	prepareInvocationSnapshot,
	runInvocation,
} from "./invocation.ts";
import { type CommandNode, createCommandNode } from "./node.ts";
import { resolveCommand } from "./router.ts";
import { snapshotCommand } from "./snapshot.ts";
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
 * - `Ctx` — provided Context values, keyed by Context name
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
// Typed programmatic invocation
// ────────────────────────────────────────────────────────────────────────────

/** Compile-time description of one command's programmatic input. */
export interface CommandShape<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
	Children extends object = {},
> {
	readonly args: A;
	readonly flags: F;
	readonly children: Children;
}

/** Compile-time command tree accumulated by `.add()`. */
export type CommandTree = Record<string, CommandShape>;

/** Every valid path through a command tree, including the root path (`[]`). */
export type CommandPath<
	Tree extends object,
	Depth extends readonly unknown[] = readonly [],
	// TypeScript's instantiation limit is lower than the runtime tree limit; paths deeper than
	// 15 remain callable as strings rather than making otherwise valid large applications fail TS2589.
> = Depth["length"] extends 15
	? readonly string[]
	: string extends keyof Tree
		? readonly string[]
		:
				| readonly []
				| {
						[K in keyof Tree & string]: Tree[K] extends CommandShape
							? readonly [K, ...CommandPath<Tree[K]["children"], readonly [...Depth, unknown]>]
							: never;
				  }[keyof Tree & string];

/** Resolve the command shape at a typed path. */
export type CommandShapeAt<
	Shape extends CommandShape,
	Path extends readonly string[],
> = Path extends readonly [infer Head, ...infer Tail extends readonly string[]]
	? Head extends keyof Shape["children"]
		? Shape["children"][Head] extends infer Child extends CommandShape
			? CommandShapeAt<Child, Tail>
			: never
		: never
	: Shape;

type RequiredKeys<T> = {
	[K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

type RunSection<Name extends string, Values> = keyof Values extends never
	? { [K in Name]?: never }
	: RequiredKeys<Values> extends never
		? { [K in Name]?: Values }
		: { [K in Name]: Values };

/** Structured values serialized to argv before the normal parser pipeline runs. */
export type RunInput<Shape extends CommandShape> = RunSection<"args", InputArgs<Shape["args"]>> &
	RunSection<"flags", InputFlags<Shape["flags"]>> & {
		readonly raw?: readonly string[];
	};

export type RunInputArguments<Shape extends CommandShape> =
	RequiredKeys<RunInput<Shape>> extends never
		? readonly [input?: RunInput<Shape>]
		: readonly [input: RunInput<Shape>];

export type RunArguments<Shape extends CommandShape> = readonly [
	...RunInputArguments<Shape>,
	io?: Partial<InvocationIO>,
];

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

type RequirementOwnedFlags<R extends CommandRequirements> = R extends {
	readonly requires: infer Fs extends readonly AnyContextFactory[];
}
	? FactoriesOwnedFlags<Fs>
	: {};

type ConfigRequirements<C extends CommandConfig> = C extends {
	readonly requires: infer R extends readonly AnyContextFactory[];
}
	? { readonly requires: R }
	: {};

type AnyCommandDefinitionBuilder = CommandDefinitionBuilder<any, any, any, any, any, any>;

// Child builders start without inherited flags: collisions with ancestor-owned
// flags are runtime-only, caught while the definition materializes against its
// parent's normalized flags.
type CommandRecipe<
	R extends CommandRequirements,
	Builder extends AnyCommandDefinitionBuilder = AnyCommandDefinitionBuilder,
> = (command: CommandDefinitionBuilder<{}, [], RequirementContext<R>, never, never>) => Builder;

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
	Shape extends CommandShape = CommandShape,
> {
	/** The subcommand name this definition is added under */
	readonly name: Name;
	/** The same definition under a different name; configured aliases travel with it. */
	as<const N extends string>(name: N): CommandDefinition<R, N, Aliases, Shape>;
	/** @internal */
	readonly [commandDefinitionInternal]: CommandDefinitionInternal;
	/** @internal — phantom carrying the requirements for add-time checks */
	readonly _requirements?: R;
	/** @internal — phantom carrying configured alias literals for add-time checks */
	readonly _aliases?: Aliases;
	/** @internal — phantom carrying args, flags, and descendants for typed invocation */
	readonly _shape?: Shape;
}

/**
 * Scope a materialized definition's Contexts to what its recipe can see:
 * Contexts provided inside the recipe plus the transitive `requires`
 * closure over inherited ones. Inherited Contexts outside that closure are
 * never constructed for this command, matching the recipe's `ctx` typing.
 */
function scopeContexts(
	contexts: readonly ContextInstance[],
	inherited: ReadonlySet<string>,
	required: readonly string[],
): ContextInstance[] {
	const keep = new Set(required);
	for (const context of contexts) {
		if (!inherited.has(context.name)) keep.add(context.name);
	}
	// Topological order (dependencies first) lets one reverse pass collect
	// the transitive closure of Context `requires` chains.
	for (const context of contexts.toReversed()) {
		if (keep.has(context.name)) {
			for (const dep of context.requiredCtx) keep.add(dep);
		}
	}
	return contexts.filter((context) => keep.has(context.name));
}

function materializeCommandDefinition(
	definition: CommandDefinition,
	parent: CommandNode,
	extensionName?: string,
): CommandNode {
	const internal = (definition as Partial<CommandDefinition> | null)?.[commandDefinitionInternal];
	if (internal === undefined) {
		const owner = extensionName ? `Extension "${extensionName}"` : "add()";
		throw new CrustError(
			"DEFINITION",
			`${owner} requires a command definition created by defineCommand()`,
			{
				subject: extensionName ? "extension" : "command",
				name: extensionName,
				reason: "invalid-command-definition",
			},
		);
	}

	const name = definition.name;
	const owner = extensionName
		? `Extension "${extensionName}" command "${name}"`
		: `Command "${name}"`;
	const definitionDetails = (reason: string) => ({
		subject: extensionName ? ("extension" as const) : ("command" as const),
		name: extensionName ?? name,
		reason,
	});
	for (const ctxName of internal.requiredCtxNames) {
		if (!parent.contexts.some((context) => context.name === ctxName)) {
			throw new CrustError(
				"DEFINITION",
				`${owner} requires Context "${ctxName}", which is not provided on parent command "${parent.meta.name}"`,
				{
					subject: "context",
					name: ctxName,
					reason: "missing-context",
				},
			);
		}
	}

	commandCollision(
		{ canonicalName: name, aliases: internal.meta.aliases },
		parent.subCommands,
		owner,
	);

	const child = new Crust(name);
	(child as { _ancestorOwnedFlags: FlagsDef })._ancestorOwnedFlags = parent.ownedFlags;
	child._node.ownedFlags = { ...parent.ownedFlags };
	child._node.effectiveFlags = { ...parent.ownedFlags };
	child._node.flagSpellings = cloneFlagSpellings(parent.flagSpellings, child._node.effectiveFlags);
	(child._node as { contexts: ContextInstance[] }).contexts = [...parent.contexts];

	const configured = internal.recipe(
		child as unknown as AnyCommandDefinitionBuilder,
	) as unknown as Crust;
	if (configured?._ancestorOwnedFlags !== parent.ownedFlags) {
		throw new CrustError(
			"DEFINITION",
			`${owner} definition must return the same command builder it received`,
			definitionDetails("foreign-command-builder"),
		);
	}
	if (configured._node.extensions.length > 0) {
		throw new CrustError(
			"DEFINITION",
			`${owner} cannot register Extensions inside command definitions`,
			definitionDetails("nested-command-extension"),
		);
	}

	const childNode = cloneCommandNode(configured._node);
	childNode.meta = { name, ...internal.meta };
	const inheritedCtxNames = new Set(parent.contexts.map((context) => context.name));
	childNode.contexts = scopeContexts(
		childNode.contexts,
		inheritedCtxNames,
		internal.requiredCtxNames,
	);
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

type DefinitionRequirements<D> = D extends CommandDefinition<infer R, any, any, any> ? R : never;

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
	Ds extends readonly CommandDefinition<any, any, any, any>[],
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
	Flags extends FlagsDef = {},
	A extends ArgsDef = ArgsDef,
	Ctx extends ContextMap = {},
	Sibs extends string = never,
	Sp extends string = SpellingsOf<Flags>,
	Tree extends object = {},
> {
	flags<const Defs extends readonly NamedFlagDef[]>(
		...defs: ValidateNamedFlagDefs<Defs, Sp>
	): CommandDefinitionBuilder<
		MergeFlags<Flags, NamedFlagsRecord<Defs>>,
		A,
		Ctx,
		Sibs,
		Sp | SpellingsOf<NamedFlagsRecord<Defs>>,
		Tree
	>;

	args<const NewA extends ArgsDef>(
		...defs: NewA & AppendArgsChecks<A, NewA>
	): CommandDefinitionBuilder<Flags, AppendedArgs<A, NewA>, Ctx, Sibs, Sp, Tree>;

	provide<const Cs extends readonly ContextInstance[]>(
		...instances: ProvideChecks<Sp, Cs> & ValidateContextNames<Ctx, Cs>
	): CommandDefinitionBuilder<
		MergeFlags<Flags, ContextsOwnedFlags<Cs>>,
		A,
		MergeContext<Ctx, ContextsOutput<Cs>>,
		Sibs,
		Sp | SpellingsOf<ContextsOwnedFlags<Cs>>,
		Tree
	>;

	add<const Ds extends readonly CommandDefinition<any, any, any, any>[]>(
		...definitions: Ds & AddChecks<Ctx, Sibs, Ds>
	): CommandDefinitionBuilder<
		Flags,
		A,
		Ctx,
		Sibs | CommandDefinitionSpellings<Ds[number]>,
		Sp,
		Tree & DefinitionsTree<Ds>
	>;

	action(
		action: (ctx: NoInfer<CrustCommandContext<A, Flags, Ctx>>) => void | Promise<void>,
	): CommandDefinitionBuilder<Flags, A, Ctx, Sibs, Sp, Tree>;
}

type ShapeWithRequirementFlags<
	Shape extends CommandShape,
	R extends CommandRequirements,
> = CommandShape<Shape["args"], Shape["flags"] & RequirementOwnedFlags<R>, Shape["children"]>;

type ShapeOfBuilder<B> =
	B extends CommandDefinitionBuilder<infer Flags, infer A, any, any, any, infer Tree>
		? CommandShape<A, Flags, Tree>
		: never;

type DefinitionShapeForSpelling<D, Spelling extends string> =
	D extends CommandDefinition<any, infer Name, infer Aliases, infer Shape>
		? Spelling extends Name | (string extends Aliases[number] ? never : Aliases[number])
			? Shape
			: never
		: never;

type DefinitionsTree<Ds extends readonly CommandDefinition<any, any, any, any>[]> = {
	[K in CommandDefinitionSpellings<Ds[number]>]: DefinitionShapeForSpelling<Ds[number], K>;
};

/**
 * Define a reusable, inert command under a required name.
 *
 * The recipe runs once per `.add()`, receiving a fresh builder typed by
 * the declared Context capabilities, which must be provided on the parent path.
 *
 * Static metadata and Context requirements belong in `config`. Use `.as(name)`
 * to add one definition under a different name; configured aliases travel with it.
 */
export function defineCommand<
	const Name extends string,
	Builder extends AnyCommandDefinitionBuilder,
>(
	name: Name,
	recipe: CommandRecipe<{}, Builder>,
): CommandDefinition<{}, Name, readonly [], ShapeOfBuilder<Builder>>;
export function defineCommand<
	const Name extends string,
	const C extends CommandConfig,
	Builder extends AnyCommandDefinitionBuilder,
>(
	name: Name,
	config: C & ValidateCommandConfig<Name, C>,
	recipe: CommandRecipe<ConfigRequirements<C>, Builder>,
): CommandDefinition<
	ConfigRequirements<C>,
	Name,
	AliasesOf<C>,
	ShapeWithRequirementFlags<ShapeOfBuilder<Builder>, ConfigRequirements<C>>
>;
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

function serializeInputValue(definition: ArgDef | FlagDef, name: string, value: unknown): string {
	if (definition.type !== "json") return String(value);
	const serialized = JSON.stringify(value);
	if (serialized === undefined) {
		throw new CrustError("PARSE", `Value for "${name}" is not JSON-serializable`, {
			value: String(value),
			reason: "unserializable-json",
		});
	}
	return serialized;
}

function serializeRunArgv(
	root: CommandNode,
	path: readonly string[],
	input: { readonly args?: object; readonly flags?: object; readonly raw?: readonly string[] },
): string[] {
	// Typed paths deliberately exclude Extension commands because Extensions materialize later.
	const route = resolveCommand(root, [...path]);
	if (route.argv.length > 0) {
		// A path element the router could not consume must fail here; letting it
		// fall through would serialize it ahead of the real positionals.
		const candidate = route.argv[0] as string;
		throw new CrustError("COMMAND_NOT_FOUND", `Unknown command "${candidate}".`, {
			input: candidate,
			available: Object.keys(route.command.subCommands),
			commandPath: route.commandPath,
			parentCommand: snapshotCommand(route.command),
		});
	}
	const command = route.command;
	const argv = [...path];
	const args = input.args as Record<string, unknown> | undefined;
	let omittedArgument: string | undefined;
	let firstPositional: string | undefined;
	for (const definition of command.args ?? []) {
		const value = args?.[definition.name];
		if (value === undefined) {
			omittedArgument = definition.name;
			continue;
		}
		if (omittedArgument !== undefined) {
			throw new CrustError(
				"PARSE",
				`Argument <${definition.name}> cannot be provided after omitted argument <${omittedArgument}>`,
				{ argument: definition.name, reason: "positional-gap" },
			);
		}
		const values = Array.isArray(value) ? value : [value];
		for (const item of values) {
			const serialized = serializeInputValue(definition, definition.name, item);
			if (serialized.startsWith("-")) {
				throw new CrustError(
					"PARSE",
					`Argument <${definition.name}> cannot start with "-" in typed run()`,
					{ argument: definition.name, value: serialized, reason: "option-like-positional" },
				);
			}
			firstPositional ??= serialized;
			argv.push(serialized);
		}
	}
	for (const name of Object.keys(args ?? {})) {
		if (args?.[name] === undefined) continue;
		if (!(command.args ?? []).some((definition) => definition.name === name)) {
			throw new CrustError("PARSE", `Unknown argument "${name}"`, {
				argument: name,
				reason: "unknown-argument",
			});
		}
	}
	// The router matches subcommand names/aliases before positionals, so a first
	// positional spelled like a child would silently dispatch that child instead
	// of the command the typed path selected.
	if (firstPositional !== undefined) {
		const value = firstPositional;
		const collides =
			value in command.subCommands ||
			Object.values(command.subCommands).some((child) => child.meta.aliases?.includes(value));
		if (collides) {
			throw new CrustError(
				"PARSE",
				`Argument value "${value}" matches a subcommand of the selected command; typed run() cannot disambiguate it from a command path`,
				{ value, reason: "ambiguous-positional" },
			);
		}
	}

	const flags = input.flags as Record<string, unknown> | undefined;
	for (const [name, value] of Object.entries(flags ?? {})) {
		if (value === undefined) continue;
		const definition = command.effectiveFlags[name];
		if (definition === undefined) {
			throw new CrustError("PARSE", `Unknown flag "--${name}"`, {
				flag: name,
				reason: "unknown-flag",
			});
		}
		const values = Array.isArray(value) ? value : [value];
		for (const item of values) {
			if (definition.type === "boolean") {
				argv.push(item ? `--${name}` : `--no-${name}`);
			} else {
				argv.push(`--${name}=${serializeInputValue(definition, name, item)}`);
			}
		}
	}
	if (input.raw !== undefined) argv.push("--", ...input.raw);
	return argv;
}

// ────────────────────────────────────────────────────────────────────────────
// Crust — Chainable builder class
// ────────────────────────────────────────────────────────────────────────────

/**
 * Chainable builder for defining CLI commands with full type inference.
 *
 * Generic parameters:
 * - `Flags` — flags defined locally or installed by provided Contexts
 * - `A` — positional argument definitions
 * - `Ctx` — provided Context values
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
/** Broad application type for APIs that accept any fully-built Crust application. */
export type AnyCrust = Crust<any, any, any, any, any, any>;

export class Crust<
	Flags extends FlagsDef = {},
	A extends ArgsDef = ArgsDef,
	Ctx extends ContextMap = {},
	Sibs extends string = never,
	Sp extends string = SpellingsOf<Flags>,
	Tree extends object = {},
> {
	/** @internal — Phantom property exposing generic parameters for type-level testing */
	declare readonly _types: {
		flags: Flags;
		args: A;
		ctx: Ctx;
		tree: Tree;
		shape: CommandShape<A, Flags, Tree>;
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
		const effectiveFlags = { ...this._node.effectiveFlags };
		const newNode: CommandNode = {
			...this._node,
			// Shallow copy collections so mutations don't affect the original
			localFlags: { ...this._node.localFlags },
			ownedFlags: { ...this._node.ownedFlags },
			effectiveFlags,
			flagSpellings: cloneFlagSpellings(this._node.flagSpellings, effectiveFlags),
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
		MergeFlags<Flags, NamedFlagsRecord<Defs>>,
		A,
		Ctx,
		Sibs,
		Sp | SpellingsOf<NamedFlagsRecord<Defs>>,
		Tree
	> {
		const localFlags: FlagsDef = { ...this._node.localFlags };
		const effectiveFlags: FlagsDef = { ...this._node.effectiveFlags };
		const flagSpellings = cloneFlagSpellings(this._node.flagSpellings, effectiveFlags);
		for (const def of defs) {
			const { name, ...rest } = def as NamedFlagDef;
			if (Object.hasOwn(localFlags, name)) {
				throw new CrustError("DEFINITION", `Flag "--${name}" is already defined`, {
					subject: "flag",
					name,
					reason: "duplicate-flag",
				});
			}
			const normalized = rest as FlagDef;
			normalizeFlag(
				{ name, def: normalized },
				effectiveFlags,
				flagSpellings,
				`Command "${this._node.meta.name}"`,
			);
			localFlags[name] = normalized;
			effectiveFlags[name] = normalized;
		}

		return this._clone({ localFlags, effectiveFlags, flagSpellings }) as unknown as Crust<
			MergeFlags<Flags, NamedFlagsRecord<Defs>>,
			A,
			Ctx,
			Sibs,
			Sp | SpellingsOf<NamedFlagsRecord<Defs>>,
			Tree
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
	): Crust<Flags, AppendedArgs<A, NewA>, Ctx, Sibs, Sp, Tree> {
		return this._clone({
			args: normalizeArgs(this._node.args, defs as ArgsDef),
		}) as unknown as Crust<Flags, AppendedArgs<A, NewA>, Ctx, Sibs, Sp, Tree>;
	}

	/**
	 * Attach Contexts — named command dependencies — to this command.
	 *
	 * Contexts are inherited by descendant commands, constructed
	 * topologically (by declared capability requirements) only when the
	 * resolved command requires them, and exposed to the Command Action as
	 * `ctx`. Within one
	 * `.provide()` call, dependencies may appear after their dependents.
	 * Values implementing `Symbol.dispose` or `Symbol.asyncDispose` are
	 * disposed in reverse construction order after success or failure.
	 *
	 * @throws {CrustError} `DEFINITION` when a name is already provided on
	 *                      this command path
	 */
	provide<const Cs extends readonly ContextInstance[]>(
		...instances: ProvideChecks<Sp, Cs> & ValidateContextNames<Ctx, Cs>
	): Crust<
		MergeFlags<Flags, ContextsOwnedFlags<Cs>>,
		A,
		MergeContext<Ctx, ContextsOutput<Cs>>,
		Sibs,
		Sp | SpellingsOf<ContextsOwnedFlags<Cs>>,
		Tree
	> {
		const ownedFlags = { ...this._node.ownedFlags };
		const effectiveFlags = { ...this._node.effectiveFlags };
		const flagSpellings = cloneFlagSpellings(this._node.flagSpellings, effectiveFlags);
		const contexts = normalizeContext(
			instances as readonly ContextInstance[],
			this._node.contexts,
			effectiveFlags,
			flagSpellings,
			`the "${this._node.meta.name}" command path`,
		);
		for (const instance of instances) Object.assign(ownedFlags, instance.ownedFlags);
		return this._clone({ contexts, ownedFlags, effectiveFlags, flagSpellings }) as unknown as Crust<
			MergeFlags<Flags, ContextsOwnedFlags<Cs>>,
			A,
			MergeContext<Ctx, ContextsOutput<Cs>>,
			Sibs,
			Sp | SpellingsOf<ContextsOwnedFlags<Cs>>,
			Tree
		>;
	}

	/**
	 * Define the Command Action — the function that implements this
	 * command's behavior after its inputs and Contexts are ready.
	 *
	 * The action receives a {@link CrustCommandContext} with `args` typed from
	 * `.args()` and `flags` typed from the accumulated `Flags`.
	 *
	 * An action is set once; calling `.action()` again throws rather than
	 * silently replacing command behavior. The original builder is not mutated.
	 *
	 * @param action - The Command Action function
	 * @returns A new `Crust` instance with the action registered
	 * @throws {CrustError} `DEFINITION` when this command already has an action
	 */
	action(
		action: (ctx: NoInfer<CrustCommandContext<A, Flags, Ctx>>) => void | Promise<void>,
	): Crust<Flags, A, Ctx, Sibs, Sp, Tree> {
		if (this._node.run) {
			throw new CrustError(
				"DEFINITION",
				`Command "${this._node.meta.name}" already has an action`,
				{ subject: "command", name: this._node.meta.name, reason: "duplicate-action" },
			);
		}
		return this._clone({
			run: action as (ctx: unknown) => void | Promise<void>,
		}) as Crust<Flags, A, Ctx, Sibs, Sp, Tree>;
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
	extend(...extensions: readonly Extension[]): Crust<Flags, A, Ctx, Sibs, Sp, Tree> {
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
		}) as Crust<Flags, A, Ctx, Sibs, Sp, Tree>;
	}

	/**
	 * Materialize and register inert reusable command definitions, each
	 * under its own carried name (use `.as(name)` to rename).
	 *
	 * Each definition's Context requirement names must already be provided
	 * on this builder's path — call `.provide()` before `.add()`.
	 */
	add<const Ds extends readonly CommandDefinition<any, any, any, any>[]>(
		...definitions: Ds & AddChecks<Ctx, Sibs, Ds>
	): Crust<
		Flags,
		A,
		Ctx,
		Sibs | CommandDefinitionSpellings<Ds[number]>,
		Sp,
		Tree & DefinitionsTree<Ds>
	> {
		let result = this as Crust<Flags, A, Ctx, Sibs, Sp, Tree>;
		for (const definition of definitions) {
			result = result._addDefinition(definition as CommandDefinition);
		}
		return result as unknown as Crust<
			Flags,
			A,
			Ctx,
			Sibs | CommandDefinitionSpellings<Ds[number]>,
			Sp,
			Tree & DefinitionsTree<Ds>
		>;
	}

	private _addDefinition(definition: CommandDefinition): Crust<Flags, A, Ctx, Sibs, Sp, Tree> {
		const childNode = materializeCommandDefinition(definition, this._node);

		return this._clone({
			subCommands: { ...this._node.subCommands, [definition.name]: childNode },
		}) as Crust<Flags, A, Ctx, Sibs, Sp, Tree>;
	}

	/**
	 * Prepare a frozen, validated Command Snapshot for tooling such as
	 * man-page, skill, and build generators.
	 *
	 * Materializes Extension contributions and command definitions. Successful
	 * materialization means every Command Node was normalized. Does not call
	 * Command Actions. Rejects with a `CrustError` of code `DEFINITION` when
	 * materialization fails.
	 */
	async snapshot(): Promise<CommandSnapshot> {
		return prepareInvocationSnapshot(this._node, materializeCommandDefinition);
	}

	/**
	 * Invoke this application programmatically: serialize the typed input, resolve, parse,
	 * run the Extension hooks, and execute the selected Command Action.
	 *
	 * Unlike {@link Crust.execute}, `run()` throws the original definition,
	 * parse, Context, or action failure without rendering it (Extension
	 * `onError` hooks are a terminal presentation concern and never run
	 * here) and without changing process status. It resolves with no value
	 * after successful cleanup. Prompt cancellation surfaces as a standard
	 * `AbortError`.
	 *
	 * @param path - Typed path to the command to invoke (`[]` selects the root)
	 * @param input - Structured argument, flag, and raw values
	 * @param io - Optional `stdout(text)` / `stderr(text)` callbacks, also
	 *             exposed to Command Actions and Extensions
	 */
	async run<const Path extends CommandPath<Tree>>(
		path: Path,
		...args: RunArguments<CommandShapeAt<CommandShape<A, Flags, Tree>, Path>>
	): Promise<void> {
		const structuredInput = (args[0] ?? {}) as {
			readonly args?: object;
			readonly flags?: object;
			readonly raw?: readonly string[];
		};
		const io = args[1] as Partial<InvocationIO> | undefined;
		const argv = serializeRunArgv(this._node, path, structuredInput);
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
