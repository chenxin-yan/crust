import type {
	AnyContextFactory,
	ContextBag,
	ContextDependencies,
	ContextInstance,
	ContextMap,
	ContextsOutput,
	ContextsOwnedFlags,
	MergeContext,
} from "../api/context.ts";
import type { Extension, ExtensionsProvidesOutput } from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import { addFlagSpellingEntries, cloneFlagSpellings } from "../parsing/spellings.ts";
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
	EmptyNameBrand,
	ValidateCommandConfig,
	ValidateCommandDefinitions,
} from "../validation/commands.brands.ts";
import type {
	ValidateContextDeps,
	ValidateContextNames,
	ValidateDeclaredDeps,
	ValidateExtensionProvides,
} from "../validation/contexts.brands.ts";
import type {
	ExtensionsSpellings,
	ProvideChecks,
	TreeSpellings,
	ValidateDefinitionFlags,
	ValidateExtensionFlags,
	SpellingsOf,
	ValidateNamedFlagDefs,
} from "../validation/flags.brands.ts";
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

export { BUILD_OUT_DIR_ENV, SNAPSHOT_PATH_ENV } from "./invocation.ts";

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
	/** Lazy Context values available on this command path. */
	ctx: ContextBag<Ctx>;
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

/** Compile-time description of one command's programmatic input and action result. */
export interface CommandShape<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
	Children extends object = {},
	Result = unknown,
> {
	readonly args: A;
	readonly flags: F;
	readonly children: Children;
	readonly result?: Result;
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

/** Static configuration for a reusable command definition. */
export interface CommandConfig extends Omit<CommandMeta, "name"> {
	/** Contexts this command consumes. */
	readonly uses?: readonly AnyContextFactory[];
}

/** Static metadata accepted by the root command constructor. */
export type RootCommandMeta = Pick<CommandMeta, "description" | "usage" | "sections">;

type AnyCommandDefinitionBuilder = CommandDefinitionBuilder<any, any, any, any, any, any, any, any>;

// Child builders start without inherited flags, so brands cannot see ancestor
// spellings from inside a sealed recipe. Materialization seeds the child with
// the parent's owned flags and catches collisions at runtime: `.flags()` hits
// the seeded spelling table, and recipe-provided Contexts are checked against
// ancestor owners in `materializeCommandDefinition`.
type CommandRecipe<
	Deps extends ContextMap = {},
	Builder extends AnyCommandDefinitionBuilder = AnyCommandDefinitionBuilder,
> = (command: CommandDefinitionBuilder<{}, [], Deps, never, never>) => Builder;

type ConfigUses<C extends CommandConfig> = C extends {
	uses: infer Uses extends readonly AnyContextFactory[];
}
	? Uses
	: readonly [];
type CommandDeps<C extends CommandConfig> = ContextDependencies<ConfigUses<C>>;

const commandDefinitionInternal: unique symbol = Symbol.for("crust.commandDefinition");

interface CommandDefinitionInternal {
	readonly recipe: (command: AnyCommandDefinitionBuilder) => AnyCommandDefinitionBuilder;
	readonly meta: Omit<CommandMeta, "name">;
	readonly uses: readonly AnyContextFactory[];
}

export interface CommandDefinition<
	Name extends string = string,
	Aliases extends readonly string[] = readonly string[],
	Shape extends CommandShape = CommandShape,
	Deps extends ContextMap = {},
> {
	/** The subcommand name this definition is added under */
	readonly name: Name;
	/** The same definition under a different name; configured aliases travel with it. */
	as<const N extends string>(
		name: N & EmptyNameBrand<N>,
	): CommandDefinition<N, Aliases, Shape, Deps>;
	/** @internal */
	readonly [commandDefinitionInternal]: CommandDefinitionInternal;
	/** @internal — phantom carrying configured alias literals for add-time checks */
	readonly _aliases?: Aliases;
	/** @internal — phantom carrying args, flags, and descendants for typed invocation */
	readonly _shape?: Shape;
	/** @internal — phantom carrying the declared dependency closure */
	readonly _deps?: Deps;
}

function materializeCommandDefinition(
	definition: CommandDefinition,
	parent: CommandNode,
	extensionName?: string,
): CommandNode {
	const internal = definition[commandDefinitionInternal];
	const name = definition.name;
	const owner = extensionName
		? `Extension "${extensionName}" command "${name}"`
		: `Command "${name}"`;
	const definitionDetails = (reason: string) => ({
		subject: extensionName ? ("extension" as const) : ("command" as const),
		name: extensionName ?? name,
		reason,
	});

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

	// Recipe-provided Contexts vs ancestor-owned flags. Sealed recipes start
	// with empty compile-time spellings, so a fully typed recipe can provide a
	// Context whose owned flag retypes an ancestor Context's parser definition;
	// the ancestor setup would then receive a value of the wrong type. Same-name
	// providers are exempt: re-providing a Context (e.g. an `.of()` double)
	// replaces its flags consistently.
	const ancestorFlagOwners = new Map<string, string>();
	for (const instance of parent.contexts) {
		for (const [flagName, def] of Object.entries(instance.ownedFlags)) {
			for (const spelling of [flagName, def.short, ...(def.aliases ?? [])]) {
				if (spelling) ancestorFlagOwners.set(spelling, instance.name);
			}
		}
	}
	for (const instance of configured._node.contexts.slice(parent.contexts.length)) {
		for (const [flagName, def] of Object.entries(instance.ownedFlags)) {
			for (const spelling of [flagName, def.short, ...(def.aliases ?? [])]) {
				if (!spelling) continue;
				const ownerName = ancestorFlagOwners.get(spelling);
				if (ownerName !== undefined && ownerName !== instance.name) {
					throw new CrustError(
						"DEFINITION",
						`${owner} provides Context "${instance.name}" whose flag spelling "${spelling}" collides with a flag owned by ancestor Context "${ownerName}"`,
						definitionDetails("ancestor-flag-collision"),
					);
				}
			}
		}
	}

	const childNode = cloneCommandNode(configured._node);
	childNode.meta = { name, ...internal.meta };
	return childNode;
}

// Bare `Crust` uses broad `ArgsDef` for structural consumers; a `.args()` call on
// that broad type only reflects the new defs (runtime still appends to any args a
// widened builder already carries), while already-refined builders append in-type.
type AppendedArgs<A extends ArgsDef, NewA extends ArgsDef> = ArgsDef extends A
	? NewA
	: readonly [...A, ...NewA];

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
	CtxFlags extends FlagsDef = {},
	Result = void,
> {
	flags<const Defs extends readonly NamedFlagDef[]>(
		...defs: ValidateNamedFlagDefs<Defs, Sp>
	): CommandDefinitionBuilder<
		MergeFlags<Flags, NamedFlagsRecord<Defs>>,
		A,
		Ctx,
		Sibs,
		Sp | SpellingsOf<NamedFlagsRecord<Defs>>,
		Tree,
		CtxFlags,
		Result
	>;

	args<const NewA extends ArgsDef>(
		...defs: NewA & AppendArgsChecks<A, NewA>
	): CommandDefinitionBuilder<Flags, AppendedArgs<A, NewA>, Ctx, Sibs, Sp, Tree, CtxFlags, Result>;

	provide<const Cs extends readonly ContextInstance[]>(
		...instances: ProvideChecks<Sp, Cs> &
			ValidateContextNames<Ctx, Cs> &
			ValidateContextDeps<Ctx, Cs>
	): CommandDefinitionBuilder<
		MergeFlags<Flags, ContextsOwnedFlags<Cs>>,
		A,
		MergeContext<Ctx, ContextsOutput<Cs>>,
		Sibs,
		Sp | SpellingsOf<ContextsOwnedFlags<Cs>>,
		Tree,
		MergeFlags<CtxFlags, ContextsOwnedFlags<Cs>>,
		Result
	>;

	add<const Ds extends readonly CommandDefinition<any, any, any, any>[]>(
		...definitions: Ds & ValidateCommandDefinitions<Ds, Sibs> & ValidateDeclaredDeps<Ctx, Ds>
	): CommandDefinitionBuilder<
		Flags,
		A,
		Ctx,
		Sibs | CommandDefinitionSpellings<Ds[number]>,
		Sp,
		Tree & DefinitionsTree<Ds, CtxFlags>,
		CtxFlags,
		Result
	>;

	action<R>(
		action: (ctx: NoInfer<CrustCommandContext<A, Flags, Ctx>>) => R,
	): CommandDefinitionBuilder<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, Awaited<R>>;
}

type ShapeOfBuilder<B> =
	B extends CommandDefinitionBuilder<
		infer Flags,
		infer A,
		any,
		any,
		any,
		infer Tree,
		any,
		infer Result
	>
		? CommandShape<A, Flags, Tree, Result>
		: never;

type DefinitionShapeForSpelling<D, Spelling extends string> =
	D extends CommandDefinition<infer Name, infer Aliases, infer Shape, any>
		? Spelling extends Name | (string extends Aliases[number] ? never : Aliases[number])
			? Shape
			: never
		: never;

// Added definitions inherit the parent path's Context-owned flags at runtime
// (materialization seeds the child with `parent.ownedFlags`), so the typed shape
// merges them too — deeply, because nested definitions materialize against the
// same inherited flag namespace. Local parent flags never inherit and stay out.
type ShapeWithInheritedFlags<S, CF extends FlagsDef> = {} extends CF
	? S
	: S extends CommandShape<infer SA, infer SF, infer SC, infer SR>
		? CommandShape<
				SA,
				MergeFlags<CF, SF>,
				{ [K in keyof SC]: ShapeWithInheritedFlags<SC[K], CF> },
				SR
			>
		: never;

type DefinitionsTree<
	Ds extends readonly CommandDefinition<any, any, any, any>[],
	CtxFlags extends FlagsDef = {},
> = {
	[K in CommandDefinitionSpellings<Ds[number]>]: ShapeWithInheritedFlags<
		DefinitionShapeForSpelling<Ds[number], K>,
		CtxFlags
	>;
};

/**
 * Define a reusable, inert command under a required name.
 *
 * The recipe runs once per `.add()`, receiving a fresh builder.
 *
 * Static metadata belongs in `config`. Use `.as(name)`
 * to add one definition under a different name; configured aliases travel with it.
 */
export function defineCommand<
	const Name extends string,
	Builder extends AnyCommandDefinitionBuilder,
>(
	name: Name & EmptyNameBrand<Name>,
	recipe: CommandRecipe<{}, Builder>,
): CommandDefinition<Name, readonly [], ShapeOfBuilder<Builder>>;
export function defineCommand<
	const Name extends string,
	const C extends CommandConfig,
	Builder extends AnyCommandDefinitionBuilder,
>(
	name: Name & EmptyNameBrand<Name>,
	config: C & ValidateCommandConfig<Name, C>,
	recipe: CommandRecipe<CommandDeps<C>, Builder>,
): CommandDefinition<Name, AliasesOf<C>, ShapeOfBuilder<Builder>, CommandDeps<C>>;
export function defineCommand(
	name: string,
	configOrRecipe: CommandConfig | CommandRecipe,
	maybeRecipe?: CommandRecipe,
): CommandDefinition {
	const hasConfig = typeof configOrRecipe !== "function";
	const config: CommandConfig = hasConfig ? configOrRecipe : {};
	const recipe = hasConfig ? maybeRecipe : configOrRecipe;
	const { uses = [], ...meta } = config;
	const internal: CommandDefinitionInternal = {
		recipe: recipe as CommandDefinitionInternal["recipe"],
		uses: Object.freeze([...uses]),
		meta: {
			...meta,
			...(config.aliases ? { aliases: [...config.aliases] } : {}),
			...(config.sections ? { sections: config.sections.map((section) => ({ ...section })) } : {}),
		},
	};
	const named = <const DefName extends string>(defName: DefName): CommandDefinition<DefName> => {
		return Object.freeze({
			name: defName,
			as: <const NewName extends string>(newName: NewName) => named(newName),
			[commandDefinitionInternal]: internal,
		});
	};
	return named(name);
}

function installContexts(node: CommandNode, instances: readonly ContextInstance[]): CommandNode {
	// cloneCommandNode already deep-clones the subtree, so install by walking the copy.
	const cloned = cloneCommandNode(node);
	const walk = (target: CommandNode, skip: ReadonlySet<string>): void => {
		const installed = instances.filter((instance) => !skip.has(instance.name));
		target.contexts.push(...installed);
		for (const instance of installed) {
			for (const [name, def] of Object.entries(instance.ownedFlags)) {
				target.effectiveFlags[name] = def;
				addFlagSpellingEntries(target.flagSpellings, name, def);
			}
			Object.assign(target.ownedFlags, instance.ownedFlags);
		}
		// A Context provided locally on a descendant is more specific than a
		// root-wide install: skip same-name instances for that subtree so the
		// resolver's last-write-wins map cannot hand the descendant's typed
		// action/setup a root provider's value. Locally provided = present on
		// the child but not inherited from this node (identity comparison;
		// clones share Context instance identities).
		const inherited = new WeakSet(target.contexts);
		for (const child of Object.values(target.subCommands)) {
			const childSkip = new Set(skip);
			for (const context of child.contexts) {
				if (!inherited.has(context)) childSkip.add(context.name);
			}
			walk(child, childSkip);
		}
	};
	walk(cloned, new Set());
	return cloned;
}

function serializeInputValue(definition: ArgDef | FlagDef, name: string, value: unknown): string {
	if (definition.type !== "json") return String(value);
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(value);
	} catch {
		// JSON.stringify throws for bigints and cyclic objects; both are the same
		// user error as stringify-to-undefined, so fall through to the parse error.
		serialized = undefined;
	}
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
		// Arrays are repeated occurrences only for variadic args; a scalar json
		// arg legitimately holds an array as its single value.
		const values = definition.variadic && Array.isArray(value) ? value : [value];
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
		// hasOwn, not `in`: a positional spelled "constructor" must not
		// false-positive on inherited Object.prototype members.
		const collides =
			Object.hasOwn(command.subCommands, value) ||
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
		// hasOwn guard: an inherited Object.prototype key must not resolve as a
		// ghost flag definition.
		const definition = Object.hasOwn(command.effectiveFlags, name)
			? command.effectiveFlags[name]
			: undefined;
		if (definition === undefined) {
			throw new CrustError("PARSE", `Unknown flag "--${name}"`, {
				flag: name,
				reason: "unknown-flag",
			});
		}
		// Same as args: only `multiple` flags treat an array as repeated occurrences.
		const values = definition.multiple && Array.isArray(value) ? value : [value];
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
 * - `Tree` — command shapes accumulated by `.add()` for typed `run()`
 * - `CtxFlags` — Context-owned flags accumulated by `.provide()`, inherited by
 *   the shapes of definitions added afterwards
 * - `Result` — awaited return type of this command's action
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
export type AnyCrust = Crust<any, any, any, any, any, any, any, any, any>;

export class Crust<
	Flags extends FlagsDef = {},
	A extends ArgsDef = ArgsDef,
	Ctx extends ContextMap = {},
	Sibs extends string = never,
	Sp extends string = SpellingsOf<Flags>,
	Tree extends object = {},
	CtxFlags extends FlagsDef = {},
	ExtSp extends string = never,
	Result = void,
> {
	/** @internal — Phantom property exposing generic parameters for type-level testing */
	declare readonly _types: {
		flags: Flags;
		args: A;
		ctx: Ctx;
		tree: Tree;
		shape: CommandShape<A, Flags, Tree, Result>;
	};

	/** @internal */
	readonly _node: CommandNode;

	/** @internal — Runtime identity anchor for the ancestor-owned flag carrier */
	readonly _ancestorOwnedFlags: FlagsDef;

	/**
	 * Create a new root command builder.
	 *
	 * @param name - The command name.
	 * @param meta - Optional root description, usage, and documentation sections.
	 */
	constructor(name: string, meta: RootCommandMeta = {}) {
		// Runtime is the single home for this check: constructors cannot carry
		// type parameters, so no brand can reject a statically known blank name.
		if (name.trim() === "") {
			throw new CrustError("DEFINITION", "Command name must be a non-empty string", {
				subject: "command",
				name,
				reason: "empty-name",
			});
		}
		// Prepare-time deep clones assign `subCommands[name] = node`; a
		// `__proto__` key would become the record's prototype, vanishing from
		// help/snapshots while ghost-routing every inherited key.
		if (name === "__proto__") {
			throw new CrustError("DEFINITION", 'Command name "__proto__" is reserved', {
				subject: "command",
				name,
				reason: "reserved-name",
			});
		}
		this._node = createCommandNode(name);
		if (meta.description !== undefined) this._node.meta.description = meta.description;
		if (meta.usage !== undefined) this._node.meta.usage = meta.usage;
		if (meta.sections !== undefined) {
			this._node.meta.sections = meta.sections.map((section) => ({ ...section }));
		}
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
	 */
	flags<const Defs extends readonly NamedFlagDef[]>(
		...defs: ValidateNamedFlagDefs<Defs, Sp>
	): Crust<
		MergeFlags<Flags, NamedFlagsRecord<Defs>>,
		A,
		Ctx,
		Sibs,
		Sp | SpellingsOf<NamedFlagsRecord<Defs>>,
		Tree,
		CtxFlags,
		ExtSp,
		Result
	> {
		const localFlags: FlagsDef = { ...this._node.localFlags };
		const effectiveFlags: FlagsDef = { ...this._node.effectiveFlags };
		const flagSpellings = cloneFlagSpellings(this._node.flagSpellings, effectiveFlags);
		for (const def of defs) {
			const { name, ...rest } = def as NamedFlagDef;
			const definition = rest as FlagDef;
			// ValidateNamedFlagDefs owns literal collisions; this owns config-built
			// defs and sealed-recipe collisions with ancestor-seeded flags, where a
			// silent overwrite retypes an already-bound consumer's flag.
			if (Object.hasOwn(effectiveFlags, name)) {
				throw new CrustError("DEFINITION", `Flag "${name}" is already defined on this command`, {
					subject: "flag",
					name,
					reason: "flag-collision",
				});
			}
			for (const spelling of [definition.short, ...(definition.aliases ?? [])]) {
				const existing = spelling === undefined ? undefined : flagSpellings.get(spelling);
				if (existing !== undefined && existing.canonicalName !== name) {
					throw new CrustError(
						"DEFINITION",
						`Flag spelling "${spelling}" collides with existing flag "${existing.canonicalName}"`,
						{ subject: "flag", name, reason: "flag-collision" },
					);
				}
			}
			localFlags[name] = definition;
			effectiveFlags[name] = definition;
			addFlagSpellingEntries(flagSpellings, name, definition);
		}

		return this._clone({ localFlags, effectiveFlags, flagSpellings }) as unknown as Crust<
			MergeFlags<Flags, NamedFlagsRecord<Defs>>,
			A,
			Ctx,
			Sibs,
			Sp | SpellingsOf<NamedFlagsRecord<Defs>>,
			Tree,
			CtxFlags,
			ExtSp,
			Result
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
	 */
	args<const NewA extends ArgsDef>(
		...defs: NewA & AppendArgsChecks<A, NewA>
	): Crust<Flags, AppendedArgs<A, NewA>, Ctx, Sibs, Sp, Tree, CtxFlags, ExtSp, Result> {
		const combined = [...(this._node.args ?? []), ...defs.map((definition) => ({ ...definition }))];
		// Brands own literal tuples; this owns config-built defs, where a
		// duplicate name silently discards a positional and a mid-tuple variadic
		// swallows every later argument.
		const seen = new Set<string>();
		for (const [index, definition] of combined.entries()) {
			if (seen.has(definition.name)) {
				throw new CrustError(
					"DEFINITION",
					`Argument name "${definition.name}" is already defined`,
					{
						subject: "argument",
						name: definition.name,
						reason: "duplicate-arg",
					},
				);
			}
			seen.add(definition.name);
			if (definition.variadic === true && index !== combined.length - 1) {
				throw new CrustError(
					"DEFINITION",
					`Only the last positional argument can be variadic; "${definition.name}" is not last`,
					{ subject: "argument", name: definition.name, reason: "variadic-position" },
				);
			}
		}
		return this._clone({
			args: combined,
		}) as unknown as Crust<
			Flags,
			AppendedArgs<A, NewA>,
			Ctx,
			Sibs,
			Sp,
			Tree,
			CtxFlags,
			ExtSp,
			Result
		>;
	}

	/**
	 * Attach Contexts — named command dependencies — to this command.
	 *
	 * Contexts are inherited by descendant commands and constructed lazily when
	 * their `ctx` property is accessed. Dependency order within one call does not
	 * affect construction. Disposable values are released in
	 * reverse construction order after post-run hooks.
	 *
	 */
	provide<const Cs extends readonly ContextInstance[]>(
		...instances: ProvideChecks<Sp, Cs> &
			ValidateContextNames<Ctx, Cs> &
			ValidateContextDeps<Ctx, Cs>
	): Crust<
		MergeFlags<Flags, ContextsOwnedFlags<Cs>>,
		A,
		MergeContext<Ctx, ContextsOutput<Cs>>,
		Sibs,
		Sp | SpellingsOf<ContextsOwnedFlags<Cs>>,
		Tree,
		MergeFlags<CtxFlags, ContextsOwnedFlags<Cs>>,
		ExtSp,
		Result
	> {
		// Positional by design: providers reach only this node and children added
		// afterwards (flag scoping; see definition.test.ts). Extension `provides`
		// differ deliberately — they are application-wide and walk the whole tree.
		const ownedFlags = { ...this._node.ownedFlags };
		const effectiveFlags = { ...this._node.effectiveFlags };
		const flagSpellings = cloneFlagSpellings(this._node.flagSpellings, effectiveFlags);
		const contexts = [...this._node.contexts, ...instances] as ContextInstance[];
		for (const instance of instances) {
			for (const [name, definition] of Object.entries(instance.ownedFlags)) {
				effectiveFlags[name] = definition;
				addFlagSpellingEntries(flagSpellings, name, definition);
			}
			Object.assign(ownedFlags, instance.ownedFlags);
		}
		return this._clone({ contexts, ownedFlags, effectiveFlags, flagSpellings }) as unknown as Crust<
			MergeFlags<Flags, ContextsOwnedFlags<Cs>>,
			A,
			MergeContext<Ctx, ContextsOutput<Cs>>,
			Sibs,
			Sp | SpellingsOf<ContextsOwnedFlags<Cs>>,
			Tree,
			MergeFlags<CtxFlags, ContextsOwnedFlags<Cs>>,
			ExtSp,
			Result
		>;
	}

	/**
	 * Define the Command Action — the function that implements this
	 * command's behavior after its inputs are ready.
	 *
	 * The action receives a {@link CrustCommandContext} with `args` typed from
	 * `.args()` and `flags` typed from the accumulated `Flags`.
	 *
	 * Calling `.action()` again replaces the command behavior on the new builder.
	 * The original builder is not mutated.
	 *
	 * @param action - The Command Action function
	 * @returns A new `Crust` instance with the action registered
	 */
	action<R>(
		action: (ctx: NoInfer<CrustCommandContext<A, Flags, Ctx>>) => R,
	): Crust<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, ExtSp, Awaited<R>> {
		return this._clone({
			run: action as (ctx: unknown) => unknown,
		}) as unknown as Crust<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, ExtSp, Awaited<R>>;
	}

	/**
	 * Register one or more CLI Extensions on the application root.
	 *
	 * Extensions are application-wide: they own the flags and commands they
	 * contribute. Repeated calls accumulate Extensions in registration order;
	 * Command definition builders do not expose this method.
	 */
	extend<const Es extends readonly Extension<any, any, any>[]>(
		...extensions: Es &
			ValidateDeclaredDeps<MergeContext<Ctx, ExtensionsProvidesOutput<Es>>, Es> &
			ValidateExtensionFlags<Es, Sp | TreeSpellings<Tree>> &
			ValidateExtensionProvides<Es, Ctx>
	): Crust<
		Flags,
		A,
		MergeContext<Ctx, ExtensionsProvidesOutput<Es>>,
		Sibs,
		Sp | ExtensionsSpellings<Es>,
		Tree,
		CtxFlags,
		ExtSp | ExtensionsSpellings<Es>,
		Result
	> {
		const provided = extensions.flatMap((extension) => extension.provides ?? []);
		return this._clone({
			...(provided.length > 0 ? installContexts(this._node, provided) : {}),
			extensions: [...this._node.extensions, ...extensions],
		}) as unknown as Crust<
			Flags,
			A,
			MergeContext<Ctx, ExtensionsProvidesOutput<Es>>,
			Sibs,
			Sp | ExtensionsSpellings<Es>,
			Tree,
			CtxFlags,
			ExtSp | ExtensionsSpellings<Es>,
			Result
		>;
	}

	/**
	 * Materialize and register inert reusable command definitions, each
	 * under its own carried name (use `.as(name)` to rename).
	 *
	 */
	add<const Ds extends readonly CommandDefinition<any, any, any, any>[]>(
		...definitions: Ds &
			ValidateCommandDefinitions<Ds, Sibs> &
			ValidateDeclaredDeps<Ctx, Ds> &
			ValidateDefinitionFlags<Ds, ExtSp>
	): Crust<
		Flags,
		A,
		Ctx,
		Sibs | CommandDefinitionSpellings<Ds[number]>,
		Sp,
		Tree & DefinitionsTree<Ds, CtxFlags>,
		CtxFlags,
		ExtSp,
		Result
	> {
		let result = this as Crust<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, ExtSp, Result>;
		for (const definition of definitions) {
			result = result._addDefinition(definition as CommandDefinition);
		}
		return result as unknown as Crust<
			Flags,
			A,
			Ctx,
			Sibs | CommandDefinitionSpellings<Ds[number]>,
			Sp,
			Tree & DefinitionsTree<Ds, CtxFlags>,
			CtxFlags,
			ExtSp,
			Result
		>;
	}

	private _addDefinition(
		definition: CommandDefinition,
	): Crust<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, ExtSp, Result> {
		// FIX_COMMAND_COLLISION owns literal names; this owns dynamic `.add()`,
		// where a silent replacement makes the earlier command unreachable.
		// Extension-contributed commands keep documented last-write-wins.
		if (Object.hasOwn(this._node.subCommands, definition.name)) {
			throw new CrustError(
				"DEFINITION",
				`Command name "${definition.name}" is already registered on this command`,
				{ subject: "command", name: definition.name, reason: "command-collision" },
			);
		}
		const childNode = materializeCommandDefinition(definition, this._node);

		return this._clone({
			subCommands: { ...this._node.subCommands, [definition.name]: childNode },
		}) as Crust<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, ExtSp, Result>;
	}

	/**
	 * Prepare a frozen Command Snapshot for tooling such as man-page, skill,
	 * and build generators.
	 *
	 * Materializes Extension contributions and command definitions without
	 * calling Command Actions.
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
	 * here) and without changing process status. It resolves with the selected
	 * action's return value after successful cleanup. If an Extension `preRun`
	 * hook finishes the invocation before the action runs, it resolves to
	 * `undefined`. Prompt cancellation surfaces as a standard `AbortError`.
	 *
	 * @param path - Typed path to the command to invoke (`[]` selects the root)
	 * @param input - Structured argument, flag, and raw values
	 * @param io - Optional `stdout(text)` / `stderr(text)` callbacks, also
	 *             exposed to Command Actions and Extensions
	 */
	async run<const Path extends CommandPath<Tree>>(
		path: Path,
		...args: RunArguments<CommandShapeAt<CommandShape<A, Flags, Tree, Result>, Path>>
	): Promise<CommandShapeAt<CommandShape<A, Flags, Tree, Result>, Path>["result"] | undefined> {
		const structuredInput = (args[0] ?? {}) as {
			readonly args?: object;
			readonly flags?: object;
			readonly raw?: readonly string[];
		};
		const io = args[1] as Partial<InvocationIO> | undefined;
		const argv = serializeRunArgv(this._node, path, structuredInput);
		// Programmatic calls preserve raw failures and never change process status.
		return (await runInvocation(this._node, argv, io, materializeCommandDefinition)) as
			| CommandShapeAt<CommandShape<A, Flags, Tree, Result>, Path>["result"]
			| undefined;
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
