import type { InferInput, InferOutput, StandardSchema } from "@crustjs/utils/schema";

import {
	validateContextAvailability,
	definingOf,
	type AnyContextFactory,
	type ContextBag,
	type AnyContextInstance,
	type ContextValue,
	type ContextMap,
	type ContextsOutput,
	type ContextsOwnedFlags,
	type DefiningOf,
} from "../api/context.ts";
import type {
	AnyExtension,
	Extension,
	ExtensionData,
	ExtensionsProvidesOutput,
	RootMetaKey,
	UsedContexts,
	UseSource,
} from "../api/extension.ts";
import { CrustError, type DefinitionErrorReason } from "../errors.ts";
import type { ExtensionId } from "../identity.ts";
import { flagRecordEntries, isBareToken, normalizeArg } from "../parsing/spellings.ts";
import { validateCommandSections } from "../sections.ts";
import type {
	ArgsDef,
	CommandMeta,
	RuntimeCommandSectionInput,
	FlagsDef,
	InferArgs,
	InferFlags,
	ExecuteOptions,
	InvocationIO,
	InvocationOptions,
	MergeContext,
	MergeFlags,
	MergeProviders,
	RunInputPayload,
} from "../types.ts";
import type { AppendArgsErrors, AttachedArgs } from "../validation/args.brands.ts";
import type {
	AttachedCommandSpellings,
	CommandCollisionBrand,
	ChildCommandNameBrand,
	AliasesOf,
	CommandDefinitionSpellings,
	CommandNameBrand,
	ExtensionCommandDefs,
	ExtensionsCommandSpellings,
	KnownCommandSpellings,
	KnownExtensionsCommandSpellings,
	LocalCommandConfigBrand,
	LocalSectionsBrand,
	ValidateCommandDefinitions,
	ValidateExtensionCommands,
} from "../validation/commands.brands.ts";
import type {
	KnownContextInstances,
	MissingDeclaredDependencyBrand,
	DeclaredDependencyValuesBrand,
	ValidateContextDeps,
	ValidateContextNames,
	ValidateDeclaredDeps,
	ValidateExtensionProvides,
} from "../validation/contexts.brands.ts";
import type {
	ExtensionsSpellings,
	RecursiveExtensionsSpellings,
	RecursiveOwnFlags,
	ProvideChecks,
	DefinitionTreeSpellings,
	ShapeFlagCollisionBrand,
	ValidateDefinitionFlags,
	ValidateExtensionFlags,
	ExtensionFlagDefsOf,
	FlagRecordErrors,
	FlagsInput,
	DefinedFlags,
	LocalSpellingsOf,
} from "../validation/flags.brands.ts";
import type {
	IsAny,
	IsClosedName,
	IsUnion,
	KnownSpellings,
	UnionToIntersection,
} from "../validation/shared.ts";
import {
	executeInvocation,
	prepareInvocation,
	resolveTypedPath,
	runInvocation,
} from "./invocation.ts";
import {
	type AddedChild,
	type CommandAction,
	type CommandNode,
	cloneCommandNode,
	cloneFlagRegistry,
	commandDefinitionInternal,
	createCommandNode,
	childEntriesOf,
	registerFlag,
} from "./node.ts";
import { snapshotCommand } from "./snapshot.ts";
import type { CommandSnapshot } from "./snapshot.ts";
import type {
	CheckedRunInput,
	CommandHandle,
	CommandShape,
	CommandShapeAt,
	CommandTree,
	CompatibleRunInput,
	KnownCommandPath,
	OmittableRunInput,
	RunInput,
	ShapeRunOutcome,
	RunWithoutInputThis,
	commandProviders,
} from "./typed-run.ts";

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
	/** Tokens after the `--` separator that no declared argument consumed, or the `raw` array passed to typed `run()` */
	rawArgs: string[];
	/**
	 * Aborted when the caller cancels the invocation (`execute({ signal })`,
	 * `run(path, input, { signal })`, or the first `SIGINT` or `SIGTERM` under `execute()`);
	 * see `ExecuteOptions.signal` for how the abort reason maps to the exit code.
	 */
	signal: AbortSignal;
	/** Readonly, serializable snapshot of the resolved command */
	command: CommandSnapshot;
	/** Readonly snapshot of the application root, including Extension contributions */
	rootCommand: CommandSnapshot;
}

// ────────────────────────────────────────────────────────────────────────────
// Reusable command definitions
// ────────────────────────────────────────────────────────────────────────────

/** Static configuration for a reusable command definition. */
export interface CommandConfig extends Omit<CommandMeta, "name" | "sections" | "version"> {
	/** Plain-text sections rendered after built-in command documentation. */
	readonly sections?: readonly RuntimeCommandSectionInput[];
}

/** Static metadata accepted by the root command constructor. */
export type RootCommandMeta = Pick<CommandMeta, "description" | "version" | "usage"> & {
	/** Plain-text sections rendered after built-in command documentation. */
	readonly sections?: readonly RuntimeCommandSectionInput[];
};

export type AnyCommandDefinitionBuilder = Crust<
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	"recipe"
>;

// Sealed recipes build local types; .add checks the completed shape against
// call-site Context flags. Checked attachment carries destination validation into the recipe.
type CommandRecipe<Builder extends AnyCommandDefinitionBuilder = AnyCommandDefinitionBuilder> = (
	command: CommandDefinitionBuilder<{}, [], {}, never, never>,
) => Builder;

interface CommandDefinitionInternal {
	readonly name: string;
	readonly recipe: (command: AnyCommandDefinitionBuilder) => AnyCommandDefinitionBuilder;
	readonly meta: Omit<CommandMeta, "name">;
}

type CommandInputShape<S extends CommandShape> = {
	readonly args: S["args"];
	readonly flags: S["flags"];
	readonly providers: S[typeof commandProviders];
	readonly children: {
		[K in keyof S["children"]]: S["children"][K] extends CommandShape
			? CommandInputShape<S["children"][K]>
			: never;
	};
};

export interface CommandDefinition<
	Name extends string = string,
	Aliases extends readonly string[] = readonly string[],
	Shape extends CommandShape = CommandShape,
	Deps extends ContextMap = {},
> {
	/** The subcommand name this definition is added under */
	readonly name: Name;
	/** The same definition under a different name; configured aliases travel with it. */
	as<const N extends string>(name: N): CommandDefinition<N, Aliases, Shape, Deps>;
	/** @internal */
	readonly [commandDefinitionInternal]: CommandDefinitionInternal & {
		readonly _aliases?: Aliases;
		readonly _shape?: Shape;
		readonly _deps?: Deps;
		readonly proof?: [Shape] extends [never]
			? unknown
			: string extends keyof Shape["flags"] | keyof Deps
				? unknown
				: (state: [CommandInputShape<Shape>, Deps]) => void;
	};
}

/** @internal */
export type CommandDefinitionData<D> = D extends {
	readonly [commandDefinitionInternal]: infer Data;
}
	? Data
	: D;

/**
 * Sibling spellings keyed by children-list head. The next `.add()` on that head
 * takes (removes) the set before extending it, so only one builder ever mutates
 * a given set; any other builder sharing the head rebuilds its own.
 */
const spellingIndexes = new WeakMap<AddedChild, Set<string>>();

function takeSpellingIndex(node: CommandNode): Set<string> {
	const head = node.addedChildren;
	const owned = head === undefined ? undefined : spellingIndexes.get(head);
	if (owned !== undefined) {
		spellingIndexes.delete(head!);
		return owned;
	}
	const index = new Set<string>();
	for (const { meta } of childEntriesOf(node)) {
		index.add(meta.name);
		for (const alias of meta.aliases ?? []) index.add(alias);
	}
	return index;
}

function materializeCommandDefinition(
	definition: CommandDefinition,
	parent: CommandNode,
	extensionId?: ExtensionId,
): CommandNode {
	const internal = definition[commandDefinitionInternal];
	const name = definition.name;
	const owner = extensionId ? `Extension "${extensionId}" command "${name}"` : `Command "${name}"`;
	const definitionDetails = (reason: DefinitionErrorReason) => ({
		subject: extensionId ? ("extension" as const) : ("command" as const),
		name: extensionId ?? name,
		reason,
	});

	const child = new Crust<
		{},
		[],
		{},
		never,
		never,
		{},
		{},
		CollisionSpellings,
		void,
		{},
		string,
		"recipe"
	>(name);
	for (const [flagName, def] of Object.entries(parent.ownedFlags)) {
		registerFlag(child._node, flagName, def, "owned");
	}
	child._node.contexts = parent.contexts.map((context) => ({ ...context }));

	const configured = internal.recipe(child);
	if (
		!(configured instanceof Crust) ||
		configured._ancestorOwnedFlags !== child._ancestorOwnedFlags
	) {
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

	validateContextAvailability(
		childNode.contexts.map(({ instance }) => instance),
		childNode.demands,
	);

	childNode.meta = { name, ...internal.meta };
	return childNode;
}

// Unknown previous positional state remains open after appends.
type AppendedArgs<A extends ArgsDef, NewA extends ArgsDef> = readonly [...A, ...AttachedArgs<NewA>];

/** Configure-only capability of {@link Crust} passed to command recipes. */
export type CommandDefinitionBuilder<
	Flags extends FlagsDef = {},
	A extends ArgsDef = ArgsDef,
	Ctx extends ContextMap = {},
	Sibs extends string = never,
	Sp extends string = LocalSpellingsOf<Flags>,
	Tree extends object = {},
	CtxFlags extends FlagsDef = {},
	Result = void,
	Deps extends ContextMap = {},
	Providers extends Record<string, ContextValue> = {},
> = Crust<
	Flags,
	A,
	Ctx,
	Sibs,
	Sp,
	Tree,
	CtxFlags,
	CollisionSpellings<never, never, {}, never, Deps, Providers>,
	Result,
	{},
	string,
	"recipe"
>;

type ShapeOfBuilder<B> = [B] extends [never]
	? CommandShape<[], {}, {}, never, {}>
	: B extends { readonly _recipeTypes: { shape: infer S extends CommandShape } }
		? S
		: never;

// Deps accumulated by `.use()` calls inside the recipe; `defineCommand` and
// `Crust.command()` extract them from the recipe's returned builder type.
// A conditionally-returning recipe (`cond ? cmd.use(a)... : cmd.use(b)...`)
// infers `B` as a union; the naked-`B` conditional distributes, so without
// merging, `Deps` would be a union whose `keyof` is the branches'
// INTERSECTION — disjoint demands would validate as demanding nothing. A
// conditional recipe demands the UNION of its branches' keys, so merge before
// any key extraction.
type DepsOfBuilder<B> =
	UnionToIntersection<
		B extends { readonly _recipeTypes: { deps: infer Deps extends ContextMap } } ? Deps : {}
	> extends infer Merged extends ContextMap
		? Merged
		: {};

// Match only established spellings; open siblings must not replace a known shape.
// Distribute over `D`: a variadic `.add(a, b)` passes the definition union, and a
// non-distributive check would infer the union of every sibling's shape.
type DefinitionShapeForSpelling<D, Spelling extends string> = D extends unknown
	? CommandDefinitionData<D> extends { readonly _shape?: infer Shape extends CommandShape }
		? Spelling extends CommandDefinitionSpellings<D>
			? Shape
			: never
		: never
	: never;

// Added definitions inherit the parent path's Context-owned flags at runtime
// (materialization seeds the child with `parent.ownedFlags`), so the typed shape
// merges them too — deeply, because nested definitions materialize against the
// same inherited flag namespace. Local parent flags never inherit and stay out.
type ShapeWithInheritedFlags<S, CF extends FlagsDef> = keyof CF extends never
	? S
	: S extends CommandShape<infer SA, infer SF, infer SC, infer SR, infer P, infer SE>
		? CommandShape<
				SA,
				MergeFlags<CF, SF>,
				{ [K in keyof SC]: ShapeWithInheritedFlags<SC[K], CF> },
				SR,
				P,
				SE
			>
		: never;

type DefinitionsTree<
	Ds extends readonly CommandDefinition<any, any, any, any>[],
	CtxFlags extends FlagsDef = {},
> = [Ds] extends [
	readonly [
		{
			readonly name: infer N extends string;
			readonly [commandDefinitionInternal]: {
				readonly _aliases?: infer Al extends readonly string[];
				readonly _shape?: infer S;
			};
		},
	],
]
	? IsUnion<N> extends true
		? DefinitionsTreeSlow<Ds, CtxFlags>
		: IsUnion<Ds[number]> extends true
			? DefinitionsTreeSlow<Ds, CtxFlags>
			: [IsClosedName<N>, IsClosedName<Al[number]>] extends [true, true]
				? { [K in N | Al[number]]: ShapeWithInheritedFlags<S, CtxFlags> }
				: DefinitionsTreeSlow<Ds, CtxFlags>
	: DefinitionsTreeSlow<Ds, CtxFlags>;

type DefinitionsTreeSlow<
	Ds extends readonly CommandDefinition<any, any, any, any>[],
	CtxFlags extends FlagsDef = {},
> =
	string extends AttachedCommandSpellings<Ds>
		? Record<string, CommandShape> & KnownDefinitionTree<Ds, CtxFlags>
		: {
				[K in CommandDefinitionSpellings<Ds[number]>]: ShapeWithInheritedFlags<
					DefinitionShapeForSpelling<Ds[number], K>,
					CtxFlags
				>;
			};

// Accumulates in tail position so a long batch with a runtime-only name stays clear of TS2589.
type KnownDefinitionTree<Ds extends readonly unknown[], CF extends FlagsDef, Acc = {}> =
	IsUnion<Ds> extends true
		? Acc
		: Ds extends readonly [infer H, ...infer T]
			? KnownDefinitionTree<
					T,
					CF,
					Acc &
						(IsUnion<H> extends true
							? {}
							: {
									[K in CommandDefinitionSpellings<H>]: ShapeWithInheritedFlags<
										DefinitionShapeForSpelling<H, K>,
										CF
									>;
								})
				>
			: Acc;

type ExtensionCheckAt<Checks, I> = I extends keyof Checks ? Checks[I] : never;

// Extension-tuple walks below accumulate in tail position so one `.extend()` takes 45+
// Extensions without TS2589; intersections keep their member order.
type ExtensionCommands<
	Es extends readonly AnyExtension[],
	Acc extends readonly unknown[] = readonly [],
> = Es extends readonly [infer H, ...infer T extends readonly AnyExtension[]]
	? ExtensionCommands<T, readonly [...Acc, ...ExtensionCommandDefs<H>]>
	: readonly [
			...Acc,
			...(ExtensionCommandDefs<Es[number]>[number] extends never
				? readonly []
				: readonly CommandDefinition<any, any, any, any>[]),
		];

type ExtensionProviders<E> = [E] extends [never]
	? []
	: DefiningOf<E> extends { provide?: infer P extends readonly AnyContextInstance[] }
		? P
		: [];
type ExtensionOwnFlags<E> = [E] extends [never]
	? {}
	: DefiningOf<E> extends { _flagDefs?: FlagsDef }
		? ExtensionFlagDefsOf<E>
		: {};

type ExtensionFlags<Es extends readonly AnyExtension[], Acc = {}> = Es extends readonly [
	infer H,
	...infer T extends readonly AnyExtension[],
]
	? ExtensionFlags<T, Acc & ExtensionOwnFlags<H> & ContextsOwnedFlags<ExtensionProviders<H>>>
	: Acc &
			(keyof ExtensionOwnFlags<Es[number]> extends never
				? keyof ContextsOwnedFlags<ExtensionProviders<Es[number]>> extends never
					? {}
					: FlagsDef
				: FlagsDef);

type RecursiveFlagsOf<E> = RecursiveOwnFlags<ExtensionOwnFlags<E>>;

type RecursiveExtensionFlags<Es extends readonly AnyExtension[], Acc = {}> = Es extends readonly [
	infer H,
	...infer T extends readonly AnyExtension[],
]
	? RecursiveExtensionFlags<
			T,
			Acc & RecursiveFlagsOf<H> & ContextsOwnedFlags<ExtensionProviders<H>>
		>
	: Acc & ExtensionFlags<Es>;

type TreeWithInheritedFlags<Tree, F extends FlagsDef> = {
	[K in keyof Tree]: ShapeWithInheritedFlags<Tree[K], F>;
};

// Recursive Extension flags reach every command at runtime, whenever it was added, so stored
// shapes leave them out and readers apply the accumulated set once. Flagging the tree on each
// `.extend()` nested one mapped type per call (TS2589 at about 50 calls), and resolving it
// eagerly instead re-walked every existing command per call. Leaving them out also keeps the
// stored tree independent of where `.add()` sits relative to `.extend()`.
type TreeWithRecursiveFlags<Tree extends object, R extends FlagsDef> = keyof R extends never
	? Tree
	: TreeWithInheritedFlags<Tree, R>;

/** The root shape that typed `run()`, `at()` and `_types` read. */
type AppShape<
	A extends ArgsDef,
	F extends FlagsDef,
	Tree extends object,
	Result,
	S extends AnyCollisionSpellings,
> = CommandShape<
	A,
	F,
	TreeWithRecursiveFlags<Tree, AppRecursiveFlagsOf<S>>,
	Result,
	Record<string, ContextValue>,
	ActionEvents<S>
>;

// Extension commands join the tree like `.add()`: a colliding command is a definition error.
// Resolving with `infer R` keeps a chain of `.extend()` calls from deferring one nested tree per
// call (TS2589 at about 90 calls).
type ExtensionCommandTree<
	Tree,
	Es extends readonly AnyExtension[],
	CF extends FlagsDef,
	ExtensionCommandSpellings extends string,
> =
	// A spelling TypeScript can't see may be a same-id re-registration replacing an earlier
	// Extension's command (runtime dedupes by id; the types don't track ids), so earlier
	// Extension commands and this call's open up. App commands stay: no Extension replaces them.
	string extends ExtensionsCommandSpellings<Es>
		? ([ExtensionCommandSpellings] extends [never]
				? Tree
				: { [K in keyof Tree]: K extends ExtensionCommandSpellings ? CommandShape : Tree[K] }) &
				Record<string, CommandShape> extends infer R extends object
			? R
			: never
		: Tree & DefinitionsTree<ExtensionCommands<Es>, CF> extends infer R extends object
			? R
			: never;

function resolveCommandName<Name extends string>(
	name: Name,
	aliases: readonly string[] = [],
): Name {
	if (name.trim() === "") {
		throw new CrustError("DEFINITION", "Command name must be a non-empty string", {
			subject: "command",
			name,
			reason: "empty-name",
		});
	}
	// Plain-object child registries cannot store this key without changing their prototype.
	if (name === "__proto__") {
		throw new CrustError("DEFINITION", 'Command name "__proto__" is reserved', {
			subject: "command",
			name,
			reason: "reserved-name",
		});
	}
	if (aliases.includes(name)) {
		throw new CrustError(
			"DEFINITION",
			`Command "${name}" must not list its own canonical name as an alias`,
			{
				subject: "command",
				name,
				reason: "alias-collision",
			},
		);
	}
	return name;
}

function resolveChildCommandName<Name extends string>(
	name: Name,
	aliases: readonly string[] = [],
): Name {
	resolveCommandName(name, aliases);
	if (!isBareToken(name)) {
		throw new CrustError(
			"DEFINITION",
			`Command name "${name}" must not contain whitespace or start with "-"`,
			{ subject: "command", name, reason: "invalid-name" },
		);
	}
	return name;
}

function isCommandRecipe(value: CommandConfig | CommandRecipe | undefined): value is CommandRecipe {
	return typeof value === "function";
}

/**
 * Define a reusable, inert command under a required name.
 *
 * The recipe runs once per `.add()`, receiving a fresh builder.
 *
 * Static metadata belongs in `config`. Use `.as(name)`
 * to add one definition under a different name; configured aliases travel with it.
 *
 * The types check `name` where the definition is passed to `.add()`, so a generic
 * name such as `N extends "staging" | "production"` compiles here.
 */
export function defineCommand<
	const Name extends string,
	Builder extends AnyCommandDefinitionBuilder,
>(
	name: Name,
	recipe: CommandRecipe<Builder>,
): CommandDefinition<Name, readonly [], ShapeOfBuilder<Builder>, DepsOfBuilder<Builder>>;
export function defineCommand<
	const Name extends string,
	const C extends CommandConfig,
	Builder extends AnyCommandDefinitionBuilder,
>(
	name: Name,
	config: C & LocalCommandConfigBrand<Name, C>,
	recipe: CommandRecipe<Builder>,
): CommandDefinition<Name, AliasesOf<C>, ShapeOfBuilder<Builder>, DepsOfBuilder<Builder>>;

export function defineCommand(
	nameInput: string,
	configOrRecipe: CommandConfig | CommandRecipe,
	maybeRecipe?: CommandRecipe,
): CommandDefinition {
	const hasConfig = !isCommandRecipe(configOrRecipe);
	const config: CommandConfig & { readonly version?: unknown } = hasConfig ? configOrRecipe : {};
	const recipe = hasConfig ? maybeRecipe : configOrRecipe;
	const name = resolveChildCommandName(nameInput, config.aliases);
	for (const alias of config.aliases ?? []) {
		if (!isBareToken(alias)) {
			throw new CrustError("DEFINITION", `Command "${name}" has an invalid alias "${alias}"`, {
				subject: "command",
				name,
				reason: "invalid-alias",
			});
		}
	}

	const { sections, version: _rootVersion, ...metaRest } = config;
	const meta: Omit<CommandMeta, "name"> = {
		...metaRest,
		...(config.aliases ? { aliases: [...config.aliases] } : {}),
		...(sections ? { sections: validateCommandSections(name, sections) } : {}),
	};
	const internal: CommandDefinitionInternal = {
		name,
		// SAFETY: overloads pair each recipe with its declared dependency context; storage erases it.
		recipe: recipe as CommandDefinitionInternal["recipe"],
		meta,
	};
	const named = <const DefName extends string>(defName: DefName): CommandDefinition<DefName> => {
		return Object.freeze({
			name: defName,
			as: <const NewName extends string>(newName: NewName) =>
				named(resolveChildCommandName(newName, meta.aliases)),
			[commandDefinitionInternal]: Object.freeze({ ...internal, name: defName }),
		});
	};
	return named(name);
}

function dedupeExtensions(extensions: readonly ExtensionData[]): ExtensionData[] {
	return extensions.filter((e, i) => extensions.findLastIndex((x) => x.id === e.id) === i);
}

/** Shared runtime body of `Crust.run` and `CommandHandle.run`. */
async function runAt(
	node: CommandNode,
	path: readonly string[],
	args: readonly unknown[],
): Promise<ShapeRunOutcome<CommandShape>> {
	// SAFETY: the public overloads constrain structured input to this runtime value union.
	const input = (args[0] ?? {}) as RunInputPayload;
	// SAFETY: the public overloads constrain the second argument to invocation options.
	const options = args[1] as InvocationOptions | undefined;
	// Programmatic calls capture failures and never change process status.
	return await runInvocation(node, { path, input }, options, materializeCommandDefinition);
}

// ────────────────────────────────────────────────────────────────────────────
// Crust — Chainable builder class
// ────────────────────────────────────────────────────────────────────────────

type CollisionSpellings<
	// Known spellings of Extension flags that reach every command (recursive own flags and
	// provided Context flags): the Extension flags a command below the root can collide with at
	// runtime. Root-only (`recursive: false`) flags join only `Sp`.
	Extensions extends string = never,
	Tree extends string = never,
	Demands extends ContextMap = {},
	Pending extends string = never,
	RecipeDeps extends ContextMap = {},
	Providers extends Record<string, ContextValue> = {},
	ActionDeps extends ContextMap = {},
	// Root command spellings with precise tree entries contributed by Extensions. Only `.extend()`
	// reads it (ExtensionCommandsOf); other steps pass it through unread, `undefined` included.
	ExtensionCommandSpellings extends string | undefined = never,
	RecursiveFlags extends FlagsDef = {},
	// The `.output()` schema and the action's awaited return, each checked against the other.
	Output extends OutputState | undefined = InitialOutputState,
> = {
	readonly output: Output;
	readonly actionDeps: ActionDeps;
	readonly extensionCommands: ExtensionCommandSpellings;
	readonly recursiveFlags: RecursiveFlags;
	readonly pending: Pending;
	readonly demands: Demands;
	readonly extension: Extensions;
	readonly tree: Tree;
	readonly recipeDeps: RecipeDeps;
	readonly providers: Providers;
};

// Explicit `| undefined`: mapped types over these members (e.g. `Omit`) keep it under exactOptionalPropertyTypes.
type AnyCollisionSpellings = {
	readonly output?: OutputState | undefined;
	readonly actionDeps?: ContextMap | undefined;
	readonly extensionCommands?: string | undefined;
	readonly recursiveFlags?: FlagsDef | undefined;
	readonly pending: string;
	readonly demands: ContextMap;
	readonly extension: string;
	readonly tree: string;
	readonly recipeDeps?: ContextMap | undefined;
	readonly providers?: Record<string, ContextValue> | undefined;
};

// Indexed access, not `infer`: `AnyCommandDefinitionBuilder`'s `any` spellings must yield `any`,
// not `object | {}`. A builder whose action returns `never` misses the variance shortcut (`any`
// is not assignable to `never`), and the structural fallback compares these contravariant proof slots.
// `Exclude`, not `NonNullable`: its `& {}` hit TS2589 on long `.add()` chains.
type RecipeDepsOf<S extends AnyCollisionSpellings> = Exclude<S["recipeDeps"], undefined>;

type ProvidersOf<S extends AnyCollisionSpellings> = Exclude<S["providers"], undefined>;

/** Obligations of this node's stored action, never inherited by descendants. */
type ActionDepsOf<S extends AnyCollisionSpellings> = Exclude<S["actionDeps"], undefined>;

// Not `Exclude`: distributing over this union, which grows with each `.extend()`, cost +6% on a
// 200-call chain. A state without the member (explicit type arguments) opens every entry.
type ExtensionCommandsOf<S extends AnyCollisionSpellings> = [S["extensionCommands"]] extends [
	infer E extends string,
]
	? E
	: string;

/** Recursive Extension flags registered so far; see `TreeWithRecursiveFlags`. */
type AppRecursiveFlagsOf<S extends AnyCollisionSpellings> = Exclude<S["recursiveFlags"], undefined>;

/**
 * `schema` is the `.output()` schema; `actionReturn` wraps the action's awaited return
 * (`undefined` before any `.action()`), kept apart from the result the schema produces.
 */
type OutputState = {
	readonly schema: StandardSchema | undefined;
	readonly actionReturn: readonly [unknown] | undefined;
};

// `actionReturn` stays open (no action, or any) so a builder annotated with the default state,
// such as `CommandDefinitionBuilder<F, A>`, still accepts one after `.action()`.
type InitialOutputState = {
	readonly schema: undefined;
	readonly actionReturn: readonly [unknown] | undefined;
};

type OutputStateOf<S extends AnyCollisionSpellings> = Exclude<S["output"], undefined>;

type OutputSchemaOf<S extends AnyCollisionSpellings> = Exclude<
	OutputStateOf<S>["schema"],
	undefined
>;

type ActionReturnOf<S extends AnyCollisionSpellings> = OutputStateOf<S>["actionReturn"];

/**
 * What the action may return: anything, or the `.output()` schema's input (possibly awaited,
 * or the `return` value of an async generator, itself possibly awaited).
 */
type ActionReturn<S extends AnyCollisionSpellings> = [OutputSchemaOf<S>] extends [never]
	? unknown
	:
			| InferInput<OutputSchemaOf<S>>
			| PromiseLike<InferInput<OutputSchemaOf<S>>>
			| AsyncGenerator<unknown, InferInput<OutputSchemaOf<S>>>
			| PromiseLike<AsyncGenerator<unknown, InferInput<OutputSchemaOf<S>>>>;

/** An awaited action return's value: an async generator's `return` value, else itself. */
type ActionValue<V> = V extends AsyncGenerator<any, infer Returned> ? Awaited<Returned> : V;

/**
 * The values an async generator action yields; `undefined` for any other (or no) action. Erased
 * builder states (`AnyCrust`, whose `output` is optional, and `AnyCommandDefinitionBuilder`,
 * whose action return is `any`) may hold any action, so stay open.
 */
type ActionEvents<S extends AnyCollisionSpellings> = undefined extends S["output"]
	? readonly unknown[] | undefined
	: IsAny<ActionReturnOf<S>> extends true
		? readonly unknown[] | undefined
		: ActionReturnOf<S> extends readonly [infer V]
			? V extends AsyncGenerator<infer Event>
				? readonly Event[]
				: undefined
			: undefined;

/**
 * The command result: the awaited action return (an async generator's `return` value), or the
 * `.output()` schema's output, awaited too because the invocation resolves any promise the
 * schema returns.
 */
type ActionResult<S extends AnyCollisionSpellings, R> = [OutputSchemaOf<S>] extends [never]
	? ActionValue<Awaited<R>>
	: Awaited<InferOutput<OutputSchemaOf<S>>>;

// `.output()` after `.action()` checks the action's awaited return against the new schema;
// a state that may have no action (see `InitialOutputState`) has nothing to check.
type OutputResultBrand<
	Return extends readonly [unknown] | undefined,
	S extends StandardSchema,
> = undefined extends Return
	? {}
	: [ActionValue<NonNullable<Return>[0]>] extends [InferInput<S>]
		? {}
		: {
				readonly FIX_OUTPUT: "The action's result does not match this output schema's input type";
			};

// Record spellings are derived from `Flags` on demand instead of accumulated in `Sp`.
type AfterFlags<State extends BuilderState, F extends FlagsDef> = Crust<
	State["flags"] & F,
	State["args"],
	State["ctx"],
	State["sibs"],
	State["sp"],
	State["tree"],
	State["ctxFlags"],
	State["collision"],
	State["result"],
	State["meta"],
	string,
	State["caps"]
>;

type AfterArgs<State extends BuilderState, NewA extends ArgsDef> = Crust<
	State["flags"],
	AppendedArgs<State["args"], NewA>,
	State["ctx"],
	State["sibs"],
	State["sp"],
	State["tree"],
	State["ctxFlags"],
	State["collision"],
	State["result"],
	State["meta"],
	string,
	State["caps"]
>;

type AfterUse<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Sibs extends string,
	Sp extends string,
	Tree extends object,
	CtxFlags extends FlagsDef,
	CollisionSp extends AnyCollisionSpellings,
	Result,
	Us extends readonly UseSource[],
	Meta extends RootCommandMeta | undefined,
> = Crust<
	Flags,
	A,
	MergeContext<Ctx, UsedContexts<Us>>,
	Sibs,
	Sp,
	Tree,
	CtxFlags,
	CollisionSpellings<
		CollisionSp["extension"],
		CollisionSp["tree"],
		CollisionSp["demands"],
		CollisionSp["pending"],
		MergeContext<RecipeDepsOf<CollisionSp>, UsedContexts<Us>>,
		ProvidersOf<CollisionSp>,
		ActionDepsOf<CollisionSp>,
		CollisionSp["extensionCommands"],
		AppRecursiveFlagsOf<CollisionSp>,
		CollisionSp["output"]
	>,
	Result,
	Meta,
	string,
	"recipe"
>;

type AfterProvide<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Sibs extends string,
	Sp extends string,
	Tree extends object,
	CtxFlags extends FlagsDef,
	CollisionSp extends AnyCollisionSpellings,
	Result,
	Cs extends readonly AnyContextInstance[],
	Meta extends RootCommandMeta | undefined,
	Caps extends "app" | "recipe",
> = Crust<
	Flags & ContextsOwnedFlags<Cs>,
	A,
	MergeProviders<Ctx, ContextsOutput<Cs>>,
	Sibs,
	Sp | LocalSpellingsOf<ContextsOwnedFlags<Cs>>,
	Tree,
	CtxFlags & ContextsOwnedFlags<Cs>,
	CollisionSpellings<
		CollisionSp["extension"],
		CollisionSp["tree"],
		CollisionSp["demands"],
		CollisionSp["pending"],
		RecipeDepsOf<CollisionSp>,
		MergeProviders<ProvidersOf<CollisionSp>, ContextsOutput<Cs>>,
		ActionDepsOf<CollisionSp>,
		CollisionSp["extensionCommands"],
		AppRecursiveFlagsOf<CollisionSp>,
		CollisionSp["output"]
	>,
	Result,
	Meta,
	string,
	Caps
>;

type AfterAction<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Sibs extends string,
	Sp extends string,
	Tree extends object,
	CtxFlags extends FlagsDef,
	CollisionSp extends AnyCollisionSpellings,
	R,
	Meta extends RootCommandMeta | undefined,
	Caps extends "app" | "recipe",
> = Crust<
	Flags,
	A,
	Ctx,
	Sibs,
	Sp,
	Tree,
	CtxFlags,
	Omit<CollisionSp, "actionDeps" | "output"> & {
		readonly actionDeps: Ctx;
		readonly output: {
			readonly schema: OutputStateOf<CollisionSp>["schema"];
			readonly actionReturn: readonly [Awaited<R>];
		};
	},
	ActionResult<CollisionSp, R>,
	Meta,
	string,
	Caps
>;

type AfterOutput<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Sibs extends string,
	Sp extends string,
	Tree extends object,
	CtxFlags extends FlagsDef,
	CollisionSp extends AnyCollisionSpellings,
	S extends StandardSchema,
	Meta extends RootCommandMeta | undefined,
	Caps extends "app" | "recipe",
> = Crust<
	Flags,
	A,
	Ctx,
	Sibs,
	Sp,
	Tree,
	CtxFlags,
	Omit<CollisionSp, "output"> & {
		readonly output: { readonly schema: S; readonly actionReturn: ActionReturnOf<CollisionSp> };
	},
	Awaited<InferOutput<S>>,
	Meta,
	string,
	Caps
>;

type AfterExtend<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Sibs extends string,
	Sp extends string,
	Tree extends object,
	CtxFlags extends FlagsDef,
	CollisionSp extends AnyCollisionSpellings,
	Result,
	Es extends readonly AnyExtension[],
	Meta extends RootCommandMeta | undefined,
	Caps extends "app" | "recipe",
> = Crust<
	// `&`, not `MergeFlags`: re-instantiating an alias revisits its type arguments, so a chain of
	// `.extend()` calls would nest one `MergeFlags<…>` level per call (TS2589 at about 100 calls).
	Flags & ExtensionFlags<Es>,
	A,
	MergeProviders<Ctx, ExtensionsProvidesOutput<Es>>,
	Sibs | KnownExtensionsCommandSpellings<Es>,
	Sp | ExtensionsSpellings<Es>,
	ExtensionCommandTree<Tree, Es, CtxFlags, ExtensionCommandsOf<CollisionSp>>,
	CtxFlags,
	CollisionSpellings<
		CollisionSp["extension"] | RecursiveExtensionsSpellings<Es>,
		CollisionSp["tree"] | KnownSpellings<DefinitionTreeSpellings<ExtensionCommands<Es>>>,
		CollisionSp["demands"] & ExtensionDemandValues<Es>,
		CollisionSp["pending"] | KnownSpellings<DefinitionTreeSpellings<ExtensionCommands<Es>>>,
		RecipeDepsOf<CollisionSp>,
		MergeProviders<ProvidersOf<CollisionSp>, ExtensionsProvidesOutput<Es>>,
		ActionDepsOf<CollisionSp>,
		// An open call adds no precise entries (see ExtensionCommandTree).
		ExtensionCommandsOf<CollisionSp> | KnownSpellings<ExtensionsCommandSpellings<Es>>,
		AppRecursiveFlagsOf<CollisionSp> & RecursiveExtensionFlags<Es>,
		CollisionSp["output"]
	>,
	Result,
	Meta,
	string,
	Caps
>;

type AfterAdd<
	State extends BuilderState,
	Ds extends readonly CommandDefinition<any, any, any, any>[],
> = Crust<
	State["flags"],
	State["args"],
	State["ctx"],
	State["sibs"] | KnownCommandSpellings<Ds>,
	State["sp"],
	State["tree"] & DefinitionsTree<Ds, State["ctxFlags"]>,
	State["ctxFlags"],
	CollisionSpellings<
		State["collision"]["extension"],
		State["collision"]["tree"] | KnownSpellings<DefinitionTreeSpellings<Ds>>,
		State["collision"]["demands"],
		State["collision"]["pending"],
		RecipeDepsOf<State["collision"]>,
		ProvidersOf<State["collision"]>,
		ActionDepsOf<State["collision"]>,
		State["collision"]["extensionCommands"],
		AppRecursiveFlagsOf<State["collision"]>,
		State["collision"]["output"]
	>,
	State["result"],
	State["meta"],
	string,
	State["caps"]
>;

type ExtensionHookDemand<E> = E extends AnyExtension
	? (deps: NonNullable<DefiningOf<E>["_hookDeps"]>) => void
	: never;

// Intersect hook demands before an empty branch can erase another branch's keys.
type ExtensionDemandValues<Es extends readonly AnyExtension[]> =
	ExtensionHookDemand<Es[number]> extends (deps: infer D extends ContextMap) => void ? D : {};

// Conditional recipes retain every provider and child branch, including beside an empty branch.
type DescendantShapeValuesBrand<S, Deps> = S extends CommandShape
	? DeclaredDependencyValuesBrand<Deps, NonNullable<S[typeof commandProviders]>> &
			DescendantValuesBrand<S["children"], Deps>
	: {};

type DescendantValuesBrand<Tree, Deps> = keyof Deps extends never
	? {}
	: UnionToIntersection<
			Tree extends unknown
				? keyof Tree extends never
					? {}
					: { [K in keyof Tree]: DescendantShapeValuesBrand<Tree[K], Deps> }[keyof Tree]
				: never
		>;

type DefinitionDescendantValuesBrand<
	Ds extends readonly CommandDefinition<any, any, any, any>[],
	Deps,
	// Guard first: alias arguments are instantiated eagerly, even on the `{}` branch.
> = keyof Deps extends never ? {} : DescendantValuesBrand<DefinitionsTree<Ds>, Deps>;

// Inline recipes validate demands after return-type inference, like sealed definitions.
// Descendant checks constrain the recipe itself: a return intersection can lose conditional branches.
type ValidateInlineCommandDeps<Ctx extends ContextMap, B> = MissingDeclaredDependencyBrand<
	{ readonly _deps?: DepsOfBuilder<B> },
	keyof Ctx & string
> &
	DeclaredDependencyValuesBrand<DepsOfBuilder<B>, Ctx>;

// A generic method that names any class parameter is instantiated through a composite
// class+method mapper, which re-instantiates every object-valued argument on each call
// (O(n^2) over an `.add()` chain). Signatures that read all state off an inferred `this`
// name no class parameter and resolve it by property lookup instead. `State` is inferred from
// the receiver's properties, so a generic or polymorphic-`this` receiver resolves through its
// constraint. Cost: the state is now structural, so formerly phantom parameters (Sibs, Sp,
// CollisionSp) take part in assignability.
// The constraint is `any` on purpose: checking an inferred receiver against a structural
// constraint relates (and normalizes) its whole tree intersection on every call, O(n^2).
type BuilderState = { readonly [K in keyof Crust["_state"]]: any };
// `State` is inferred both covariantly (`_state`) and contravariantly (`_stateIn`), so a union
// receiver whose branches differ in state finds no common `State` and the call is rejected.
type StateReceiver<State> = {
	readonly _state: State;
	readonly _stateIn: (state: State) => void;
};
// Explicit type arguments skip `this` inference and bind `State` to this default. Rejecting
// the receiver beats typing the call against a broad state that drops every accumulated type.
// An explicit `State` such as `any` is not guarded: like a widened explicit `Ds`, it opts out.
type ExplicitTypeArgumentsError = {
	readonly FIX_EXPLICIT_TYPE_ARGUMENTS: "Builder methods infer their type arguments; remove the explicit type arguments";
} & { readonly [K in keyof BuilderState]: never };

/** Completed applications expose inspection and invocation, not authoring after erasure. */
export type AnyCrust = Pick<
	Crust<
		FlagsDef,
		ArgsDef,
		Record<string, ContextValue>,
		string,
		string,
		CommandTree,
		FlagsDef,
		AnyCollisionSpellings,
		unknown,
		RootCommandMeta
	>,
	"_types" | "run" | "execute" | "snapshot"
>;

type DefinedRootMetaKeys<Meta extends RootCommandMeta | undefined> = {
	[K in RootMetaKey]: [Meta] extends [Required<Pick<RootCommandMeta, K>>] ? K : never;
}[RootMetaKey];

type ExtensionMetaKeys<E> =
	DefiningOf<E> extends ExtensionData<any, any, any, any, infer K> ? K : never;

type MissingRootMetaMessage<K extends RootMetaKey> = K extends unknown
	? `Extension requires root metadata "${K}"; pass it to new Crust(name, { ${K} })`
	: never;

/** Name missing metadata while accepting generic requirements covered by the root. */
type MissingRootMetaBrand<E, Defined extends RootMetaKey> =
	// Structural assignability still works when the conditional defers on generic metadata keys.
	| Extension<any, any, any, any, Defined>
	| ([E] extends [Extension<any, any, any, any, Defined>]
			? {}
			: {
					readonly FIX_ROOT_META: MissingRootMetaMessage<Exclude<ExtensionMetaKeys<E>, Defined>>;
				});

/**
 * Chainable builder for defining CLI commands with full type inference.
 *
 * Generic parameters:
 * - `Flags` — flags defined locally or installed by provided Contexts
 * - `A` — positional argument definitions
 * - `Ctx` — provided Context values
 * - `Sibs` — statically known sibling command names and aliases already registered
 * - `Sp` — accumulated flag spellings used for collision checks
 * - `Tree` — command shapes accumulated by `.add()` for typed `run()`
 * - `CtxFlags` — Context-owned flags accumulated by `.provide()`, inherited by
 *   the shapes of definitions added afterwards (recursive Extension flags reach
 *   every command and are applied where shapes are read; see `TreeWithRecursiveFlags`)
 * - `Result` — this command's result type: the awaited `.output()` schema output, or
 *   else the awaited return type of its action
 * - `Meta` — authored root metadata available to Extension requirements
 * - `Caps` — root application or configure-only recipe capabilities
 *
 * @example
 * ```ts
 * const app = new Crust("my-cli")
 *   .flags({ verbose: { type: "boolean", short: "v" } })
 *   .args({ name: "file", type: "string", required: true })
 *   .action(({ args, flags, stdout }) => {
 *     stdout(`${args.file} ${flags.verbose}`);
 *   });
 * ```
 */
export class Crust<
	Flags extends FlagsDef = {},
	A extends ArgsDef = [],
	// Context proof is invariant: a completed holder must not masquerade as an empty root.
	Ctx extends ContextMap = {},
	Sibs extends string = never,
	Sp extends string = LocalSpellingsOf<Flags>,
	Tree extends object = {},
	CtxFlags extends FlagsDef = {},
	CollisionSp extends AnyCollisionSpellings = CollisionSpellings,
	Result = void,
	const out Meta extends RootCommandMeta | undefined = {},
	// Constructors cannot declare generics; append Name to preserve explicit type-argument order.
	const Name extends string = string,
	Caps extends "app" | "recipe" = "app",
> {
	/** @internal — not `private`: declaration emit erases private member types, dropping the proof from dist. */
	declare readonly _contextProof: (
		state: [Flags, A, Ctx, CtxFlags, CollisionSp["demands"], ActionDepsOf<CollisionSp>, Caps],
	) => void;

	/** @internal — recipe state, without structural inference through builder methods. */
	declare readonly _recipeTypes: {
		readonly shape: CommandShape<
			A,
			Flags,
			Tree,
			Result,
			ProvidersOf<CollisionSp>,
			ActionEvents<CollisionSp>
		>;
		readonly deps: RecipeDepsOf<CollisionSp>;
		readonly proof?: (
			state: [
				CommandInputShape<
					CommandShape<A, Flags, Tree, Result, ProvidersOf<CollisionSp>, ActionEvents<CollisionSp>>
				>,
				RecipeDepsOf<CollisionSp>,
			],
		) => void;
	};

	/** @internal — builder state read through `this` so method signatures never name class parameters. */
	declare readonly _state: {
		readonly flags: Flags;
		readonly args: A;
		readonly ctx: Ctx;
		readonly sibs: Sibs;
		readonly sp: Sp;
		readonly tree: Tree;
		readonly ctxFlags: CtxFlags;
		readonly collision: CollisionSp;
		readonly result: Result;
		readonly meta: Meta;
		readonly caps: Caps;
	};
	// A method signature is bivariant, so this adds no variance to the class itself.
	/** @internal */
	declare readonly _stateIn: {
		bivariant(
			state: Crust<
				Flags,
				A,
				Ctx,
				Sibs,
				Sp,
				Tree,
				CtxFlags,
				CollisionSp,
				Result,
				Meta,
				Name,
				Caps
			>["_state"],
		): void;
	}["bivariant"];

	/** Supported type-level seam exposing the application's inferred command types. */
	declare readonly _types: {
		flags: Flags;
		args: A;
		ctx: Ctx;
		tree: AppShape<A, Flags, Tree, Result, CollisionSp>["children"];
		shape: AppShape<A, Flags, Tree, Result, CollisionSp>;
		readonly rootMeta: Meta;
		readonly caps: Caps;
	};

	/** @internal */
	_node: CommandNode;

	/** @internal — Recipe-builder lineage anchor, unique per materialization and preserved by clones */
	_ancestorOwnedFlags: FlagsDef;

	/**
	 * Create a new root command builder.
	 *
	 * @param name - The command name.
	 * @param metadata - Optional root description, version, usage, and documentation sections.
	 */
	constructor(
		nameInput: (Name & CommandNameBrand<Name>) &
			({} extends Meta ? {} : { readonly FIX_ROOT_META: "This root requires metadata" }),
	);
	constructor(
		nameInput: Name & CommandNameBrand<Name>,
		meta: Meta &
			(
				| undefined
				| (RootCommandMeta &
						LocalSectionsBrand<NoInfer<NonNullable<Meta>>> & {
							[K in Exclude<keyof Meta, RootMetaKey>]: never;
						})
			),
	);

	constructor(
		nameInput: Name & CommandNameBrand<Name>,
		...metadata: [meta?: RootCommandMeta | undefined]
	) {
		const meta: RootCommandMeta = metadata[0] ?? {};
		const name = resolveCommandName(nameInput);
		this._node = createCommandNode(name);
		if (meta.description !== undefined) this._node.meta.description = meta.description;
		if (meta.version !== undefined) this._node.meta.version = meta.version;
		if (meta.usage !== undefined) this._node.meta.usage = meta.usage;
		if (meta.sections !== undefined) {
			this._node.meta.sections = validateCommandSections(name, meta.sections);
		}
		this._ancestorOwnedFlags = {};
	}

	/** @internal — Clone this builder with a new node, preserving generics. */
	_clone<Out = this>(nodeOverrides: Partial<CommandNode>): Out {
		// SAFETY: the clone uses the same prototype and receives every instance field below.
		const cloned = Object.create(Object.getPrototypeOf(this)) as this;
		// A builder node is never mutated once its creating method returns, so the
		// containers a method leaves unchanged are shared, not copied. A method that
		// mutates the clone afterwards (registerFlag) must override those containers
		// with fresh copies here so failures stay private to the clone.
		cloned._node = { ...this._node, ...nodeOverrides };
		cloned._ancestorOwnedFlags = this._ancestorOwnedFlags;
		// SAFETY: every caller pairs this generic transition with the matching runtime node mutation.
		return cloned as unknown as Out;
	}

	/**
	 * Define local flags for this command from one record keyed by flag name
	 * (`{ "dry-run": { type: "boolean" } }`); values are written inline or created
	 * with `defineFlag(def)`.
	 *
	 * Repeated `.flags()` calls accumulate local flags. Returns a new builder
	 * with the combined local flag types. The original builder is not mutated.
	 *
	 * @param flags - Flag definitions keyed by canonical name
	 * @returns A new `Crust` instance with the given flags
	 */
	// Combined union signatures can lose rest-tuple inference. Registration inputs
	// (use/provide/add) default to never to reject that fallback without mapping the
	// receiver. flags/args/add/command reject differing builder states through
	// `StateReceiver`; extend keeps a this-bound phantom.
	flags<const F extends FlagsInput, State extends BuilderState = ExplicitTypeArgumentsError>(
		this: StateReceiver<State>,
		flags: F & FlagRecordErrors<F, State["sp"] | LocalSpellingsOf<State["flags"]>>,
	): AfterFlags<State, DefinedFlags<F>>;

	flags(record: unknown): unknown {
		const cloned = this._clone(cloneFlagRegistry(this._node));
		for (const [name, def] of flagRecordEntries(record)) {
			registerFlag(cloned._node, name, def, "local");
		}
		return cloned;
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
	args<const NewA extends ArgsDef, State extends BuilderState = ExplicitTypeArgumentsError>(
		this: StateReceiver<State>,
		...defs: NewA & AppendArgsErrors<State["args"], NewA>
	): AfterArgs<State, NewA>;

	args<const NewA extends ArgsDef>(...defs: NewA): unknown {
		const combined = [...this._node.args, ...defs.map(normalizeArg)];

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

		return this._clone<AfterArgs<this["_state"], NewA>>({ args: combined });
	}

	/**
	 * Declare Contexts this command consumes without supplying their values.
	 * Factory references are retained while setup stays lazy. An Extension, or
	 * Extension factory, stands for the Contexts that Extension provides.
	 */
	use<const Us extends readonly [UseSource, ...UseSource[]] = never>(
		this: { readonly _types: { readonly caps: "recipe" } },
		...sources: Us & DeclaredDependencyValuesBrand<UsedContexts<Us>, ProvidersOf<CollisionSp>>
	): AfterUse<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Us, Meta>;

	use<const Us extends readonly [UseSource, ...UseSource[]]>(
		...sources: Us
	): AfterUse<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Us, Meta> {
		const demands: (AnyContextInstance | AnyContextFactory)[] = [];
		const extensions: ExtensionId[] = [];
		for (const source of sources) {
			if ("contextName" in source) {
				demands.push(definingOf(source));
				continue;
			}
			// A factory's provided Contexts are known only per call, so only its id is checked.
			if (typeof source === "function") {
				extensions.push(source.id);
				continue;
			}
			// An instance is matched by its defining id, as `.extend()` registers it, and its
			// provided instances are demanded as given, so `.of()` values need no dependencies.
			const {
				id,
				provide,
			}: { readonly id: ExtensionId; readonly provide: readonly AnyContextInstance[] } =
				definingOf(source);
			extensions.push(id);
			demands.push(...provide);
		}
		return this._clone<
			AfterUse<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Us, Meta>
		>({
			demands: [...this._node.demands, ...demands],
			usedExtensions: [...this._node.usedExtensions, ...extensions],
		});
	}

	/**
	 * Attach Contexts — named command dependencies — to this command.
	 *
	 * Contexts are inherited by descendant commands and constructed lazily when
	 * their `ctx` property is accessed. Dependency order within one call does not
	 * affect construction. Disposable values are released in
	 * reverse construction order after post-run hooks. TypeScript rejects known Context-owned flag collisions, including pending
	 * Extension commands. Consuming operations throw `DEFINITION` for actual collisions.
	 *
	 * Context `sections` document only this command, never descendants. Preparation throws
	 * `DEFINITION` when one repeats a section title already on this command.
	 */
	provide<const Cs extends readonly AnyContextInstance[] = never>(
		...instances: KnownContextInstances<Cs> &
			ProvideChecks<Sp | LocalSpellingsOf<Flags> | CollisionSp["pending"], Cs> &
			ValidateContextNames<Caps extends "recipe" ? ProvidersOf<CollisionSp> : Ctx, Cs> &
			ValidateContextDeps<Ctx, Cs> &
			DeclaredDependencyValuesBrand<
				CollisionSp["demands"] & RecipeDepsOf<CollisionSp> & ActionDepsOf<CollisionSp>,
				ContextsOutput<NoInfer<Cs>>
			>
	): AfterProvide<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Cs, Meta, Caps>;

	provide<const Cs extends readonly AnyContextInstance[]>(
		...inputs: Cs
	): AfterProvide<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Cs, Meta, Caps> {
		const instances = inputs.map(definingOf);
		validateContextAvailability(
			[
				// Applied only at preparation, but already available to this node.
				...this._node.extensions.flatMap((extension) => extension.provide),
				...this._node.contexts.map(({ instance }) => instance),
				...instances,
			],
			instances,
		);

		// Positional by design: providers reach only this node and children added
		// afterwards (flag scoping; see definition.test.ts). Extension `.provide()`
		// differ deliberately: they are application-wide, applied to every command at preparation.
		const cloned = this._clone<
			AfterProvide<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Cs, Meta, Caps>
		>({
			...cloneFlagRegistry(this._node),
			contexts: [...this._node.contexts, ...instances.map((instance) => ({ instance }))],
			providedContexts: [...this._node.providedContexts, ...instances],
		});
		for (const instance of instances) {
			for (const [name, definition] of Object.entries(instance.ownedFlags)) {
				registerFlag(cloned._node, name, definition, "owned");
			}
		}

		return cloned;
	}

	/**
	 * Declare the shape of this command's result with a Standard Schema
	 * (Zod, Valibot, ArkType, …).
	 *
	 * Declare it before `.action()`: TypeScript then checks the action's return
	 * against the schema's input type. After the action resolves, Core validates
	 * its result with the schema and returns the schema's output as the result,
	 * typed in `run()`; a command without an action validates `undefined`. Nothing is
	 * validated when an Extension flag handler or `noAction` takes over. A result
	 * the schema rejects fails the invocation with an `OUTPUT` {@link CrustError}.
	 * Tooling reads the result's JSON Schema from `CommandSnapshot.outputSchema`,
	 * and `CommandSnapshot.output` is `true` either way. Declaring it also tells
	 * `json()` that the result is the command's output: under `--json`, stdout
	 * carries only the JSON and the text the action prints with `stdout()` is dropped
	 * in favor of it ({@link https://crustjs.com/docs/modules/extensions/json}).
	 *
	 * After `.action()`, TypeScript checks the action's awaited return against the new
	 * schema's input instead. Calling `.output()` again replaces the schema. The
	 * original builder is not mutated.
	 *
	 * @param schema - Standard Schema for the action result
	 * @returns A new `Crust` instance with the output schema registered
	 */
	output<S extends StandardSchema>(
		schema: S & OutputResultBrand<ActionReturnOf<CollisionSp>, S>,
	): AfterOutput<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, S, Meta, Caps> {
		return this._clone<
			AfterOutput<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, S, Meta, Caps>
		>({ outputSchema: schema });
	}

	/**
	 * Define the Command Action — the function that implements this
	 * command's behavior after its inputs are ready.
	 *
	 * The action receives a {@link CrustCommandContext} with `args` typed from
	 * `.args()` and `flags` typed from the accumulated `Flags`.
	 *
	 * After `.output(schema)`, the action must return the schema's input type
	 * (or a promise of it), and the command result is typed as the schema's output.
	 *
	 * An `async function*` action streams events: each yielded value goes live to the selected
	 * Renderer's `event` and the caller's `onEvent` option and is collected in the outcome's
	 * `events`, and its `return` value is the result. Events are never printed by default.
	 *
	 * Calling `.action()` again replaces the command behavior and its Context obligations
	 * on the new builder. Later local providers must satisfy the bound Context value types;
	 * descendants may shadow independently. The original builder is not mutated.
	 *
	 * @param action - The Command Action function
	 * @returns A new `Crust` instance with the action registered
	 */
	// Keeps class parameters: it runs once per builder, and on a builder union `ctx` must stay
	// the union of every branch's Contexts, which a single inferred `State` cannot express.
	action<R extends ActionReturn<CollisionSp>>(
		action: (ctx: NoInfer<CrustCommandContext<A, Flags, Ctx>>) => R,
	): AfterAction<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, R, Meta, Caps> {
		// SAFETY: dispatch reconstructs this node's context from its own validated definitions.
		return this._clone<
			AfterAction<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, R, Meta, Caps>
		>({
			run: action as CommandAction,
		});
	}

	/**
	 * Register one or more CLI Extensions on the application root.
	 *
	 * Extensions are application-wide: they own the flags and commands they
	 * contribute. Repeated calls accumulate Extensions in registration order,
	 * except that registering an `ExtensionId` again keeps only the last
	 * registration — its contributions and providers replace the earlier ones
	 * and its hooks run once, at the later position. ID deduplication is
	 * runtime-only, so removed paths can remain statically visible and reject
	 * with `COMMAND_NOT_FOUND`. An Extension with runtime-only command names makes
	 * `run()` results `unknown` for Extension commands registered up to and in that
	 * call, since it may replace their registration; app commands keep their types.
	 * Required root metadata keys are checked against the constructor's inferred
	 * metadata by TypeScript, not at runtime.
	 * Recipe builders cannot call this root-only method.
	 *
	 * This only records the list. The app applies the final list when it prepares
	 * (first run, `snapshot()`, `at()`, or `crust build`), so commands added before
	 * and after `.extend()` get Extensions alike. An Extension-provided Context
	 * replaces a same-name root `.provide()` made before this call, not one made
	 * after it, and never a command's own. Flags owned by Extension-provided
	 * Contexts come before each command's own. Flag collisions and missing Contexts
	 * are `DEFINITION` errors at preparation, so a later same-id registration can
	 * replace a conflicting earlier one.
	 */
	extend<const Es extends readonly AnyExtension[], _Union extends this = never>(
		this: { readonly _types: { readonly caps: "app" } },
		...extensions: Es & {
			[I in keyof Es]: (ExtensionCommandDefs<Es[I]> extends ValidateDefinitionFlags<
				ExtensionCommandDefs<Es[I]>,
				// Flags inherited so far; same-call and later Extension flags check these commands
				// through `ValidateExtensionFlags`'s `Below` set.
				CollisionSp["extension"] | KnownSpellings<LocalSpellingsOf<CtxFlags>>
			>
				? {}
				: {
						readonly FIX_ALIAS_COLLISION: "Extension command flags collide with inherited Context or Extension flags";
					}) &
				ValidateDeclaredDeps<MergeProviders<Ctx, ExtensionsProvidesOutput<Es>>, Es>[I] &
				DeclaredDependencyValuesBrand<
					CollisionSp["demands"],
					MergeProviders<Ctx, ExtensionsProvidesOutput<Es>>
				> &
				DescendantValuesBrand<Tree, ExtensionDemandValues<Es>> &
				DefinitionDescendantValuesBrand<
					ExtensionCommands<Es>,
					CollisionSp["demands"] & ExtensionDemandValues<Es>
				> &
				ExtensionCheckAt<
					ValidateExtensionFlags<
						Es,
						Sp | LocalSpellingsOf<Flags>,
						CollisionSp["tree"] | KnownSpellings<DefinitionTreeSpellings<ExtensionCommands<Es>>>
					>,
					I
				> &
				ExtensionCheckAt<ValidateExtensionCommands<Es, Sibs>, I> &
				ExtensionCheckAt<ValidateExtensionProvides<Es, Ctx>, I> &
				// Checked here, not in the constraint, so a missing key gets a readable brand.
				MissingRootMetaBrand<Es[I], DefinedRootMetaKeys<Meta>>;
		}
	): AfterExtend<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Es, Meta, Caps>;

	extend<const Es extends readonly Extension<any, any, any, any, DefinedRootMetaKeys<Meta>>[]>(
		...inputs: Es
	): AfterExtend<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Es, Meta, Caps> {
		const extensions = inputs.map(definingOf);
		// SAFETY: composition checked metadata compatibility; runtime storage erases hook requirements.
		const activeExtensions = dedupeExtensions([
			...this._node.extensions,
			...extensions,
		] as ExtensionData[]);
		// Root `.provide()` only appends, so the Context count marks this call's position.
		const extensionPositions = new Map(this._node.extensionPositions);
		for (const extension of extensions) {
			extensionPositions.set(extension.id, this._node.contexts.length);
		}
		// Only recorded: preparation applies the final list (see buildExtensionTree), so a
		// later same-id registration can still replace a conflicting earlier one.
		return this._clone<
			AfterExtend<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Es, Meta, Caps>
		>({ extensions: activeExtensions, extensionPositions });
	}

	/**
	 * Register inert reusable command definitions, each
	 * under its own carried name (use `.as(name)` to rename).
	 *
	 * Sibling names and aliases are checked immediately. Recipes materialize
	 * on first use, when inherited-flag collisions and Context demands are
	 * also checked. Use `await app.snapshot()` to validate the full tree
	 * without running Command Actions.
	 */
	add<
		const Ds extends readonly CommandDefinition<any, any, any, any>[] = never,
		State extends BuilderState = ExplicitTypeArgumentsError,
	>(
		this: StateReceiver<State>,
		...definitions: Ds &
			ValidateCommandDefinitions<Ds, State["sibs"]> &
			ValidateDeclaredDeps<State["ctx"], Ds> &
			DefinitionDescendantValuesBrand<Ds, State["collision"]["demands"]> &
			ValidateDefinitionFlags<
				Ds,
				State["collision"]["extension"] | KnownSpellings<LocalSpellingsOf<State["ctxFlags"]>>
			>
	): AfterAdd<State, Ds>;

	add<const Ds extends readonly CommandDefinition<any, any, any, any>[]>(
		...definitions: Ds
	): unknown {
		return this._addDefinitions<AfterAdd<this["_state"], Ds>>(definitions);
	}

	/**
	 * Define a subcommand inline (sugar for `.add(defineCommand(name, recipe))`),
	 * on the root or inside another command's recipe.
	 *
	 * The recipe builder is seeded with the Contexts and Context-owned flags
	 * accumulated on this builder so far — the call site. In a recipe, those are
	 * its `.use()` and `.provide()` Contexts. Contexts provided after `.command()`
	 * are not visible to it, matching the positional runtime semantics of
	 * `.provide()`. Extract to `defineCommand` when a command needs its own file
	 * or reuse.
	 */
	command<
		const N extends string,
		B extends AnyCommandDefinitionBuilder,
		State extends BuilderState = ExplicitTypeArgumentsError,
	>(
		this: StateReceiver<State>,
		name: N & ChildCommandNameBrand<N> & CommandCollisionBrand<N, State["sibs"]>,
		recipe: ((
			// Recursive Extension flags seed only the spellings: as inherited flags they would join
			// nested children's shapes, where the brand below counts them as the child's own. Readers
			// apply them to every command (see `AppShape`).
			command: CommandDefinitionBuilder<
				{},
				[],
				State["ctx"],
				never,
				KnownSpellings<LocalSpellingsOf<State["ctxFlags"]>> | State["collision"]["extension"],
				{},
				State["ctxFlags"]
			>,
		) => B &
			// Include nested children, whose flags are not in the seeded spelling set.
			ShapeFlagCollisionBrand<ShapeOfBuilder<B>, State["collision"]["extension"]> &
			ValidateInlineCommandDeps<State["ctx"], NoInfer<B>>) &
			NoInfer<DescendantValuesBrand<{ child: ShapeOfBuilder<B> }, State["collision"]["demands"]>>,
	): AfterAdd<
		State,
		readonly [CommandDefinition<N, readonly [], ShapeOfBuilder<B>, DepsOfBuilder<B>>]
	>;

	command<const N extends string, B extends AnyCommandDefinitionBuilder>(
		name: N,
		recipe: (
			command: CommandDefinitionBuilder<
				{},
				[],
				Ctx,
				never,
				LocalSpellingsOf<CtxFlags>,
				{},
				CtxFlags
			>,
		) => B,
	): unknown {
		// SAFETY: the seeded recipe generics restate runtime facts — materialization
		// seeds the child node from this node's contexts and owned flags.
		const define = defineCommand as unknown as (
			name: string,
			recipe: CommandRecipe,
		) => CommandDefinition;
		// SAFETY: the erased recipe still returns the builder it receives; materialization re-validates that at runtime.
		const definition = define(name, recipe as unknown as CommandRecipe);
		return this._addDefinitions<
			AfterAdd<
				this["_state"],
				readonly [CommandDefinition<N, readonly [], ShapeOfBuilder<B>, DepsOfBuilder<B>>]
			>
		>([definition]);
	}

	private _addDefinitions<Out>(definitions: readonly CommandDefinition[]): Out {
		// Keep partial additions private if a duplicate throws. Recipes run later, on
		// first use (see ChildEntry), each against this builder as its parent, never
		// an earlier sibling; builders are immutable, so capturing the node is safe.
		let head = this._node.addedChildren;
		const siblingSpellings = takeSpellingIndex(this._node);
		const parent = this._node;
		for (const definition of definitions) {
			// FIX_COMMAND_COLLISION owns literal names; this owns dynamic `.add()`,
			// where a silent replacement makes the earlier command unreachable.
			// Extension commands are checked when the app prepares (`buildExtensionTree`).
			const spellings = [
				definition.name,
				...(definition[commandDefinitionInternal].meta.aliases ?? []),
			];
			if (spellings.some((spelling) => siblingSpellings.has(spelling))) {
				throw new CrustError(
					"DEFINITION",
					`Command name "${definition.name}" is already registered on this command`,
					{
						subject: "command",
						name: definition.name,
						reason: "command-collision",
					},
				);
			}
			let childNode: CommandNode | undefined;
			head = {
				name: definition.name,
				meta: { name: definition.name, ...definition[commandDefinitionInternal].meta },
				resolve: () => (childNode ??= materializeCommandDefinition(definition, parent)),
				next: head,
				definition,
				parent,
			};
			for (const spelling of spellings) siblingSpellings.add(spelling);
		}

		if (head !== undefined) spellingIndexes.set(head, siblingSpellings);
		return this._clone<Out>({ addedChildren: head });
	}

	/**
	 * Prepare a frozen Command Snapshot for tooling such as man-page, skill,
	 * and build generators.
	 *
	 * Materializes Extension contributions and command definitions without
	 * calling Command Actions.
	 */
	snapshot(this: { readonly _types: { readonly caps: "app" } }): Promise<CommandSnapshot>;

	async snapshot(): Promise<CommandSnapshot> {
		return snapshotCommand(prepareInvocation(this._node, materializeCommandDefinition).rootNode);
	}

	/**
	 * Programmatically invoke a typed command, quietly capturing its output.
	 * Returns completed, handled, or failed after cleanup without presenting errors.
	 * Use {@link execute} as the streaming terminal adapter.
	 *
	 * @param path - Typed path to the command to invoke (`[]` selects the root)
	 * @param input - Structured argument, flag, and raw values
	 * @param options - Optional `stdout(text)` / `stderr(text)` callbacks (also
	 *                  exposed to Command Actions and Extensions), an `onEvent(event)`
	 *                  callback for an async generator action's events, and an
	 *                  `AbortSignal` that cancels the invocation
	 */
	// `Path` is only constrained to strings, and the parameter is not intersected with `Path`:
	// either would erase the partial literal editors use for completions (see `KnownCommandPath`).
	run<const Path extends readonly string[]>(
		this: RunWithoutInputThis<
			CommandShapeAt<AppShape<A, Flags, Tree, Result, CollisionSp>, Path>,
			{ readonly _types: { readonly caps: "app" } }
		>,
		path: KnownCommandPath<Path, Tree>,
	): Promise<ShapeRunOutcome<CommandShapeAt<AppShape<A, Flags, Tree, Result, CollisionSp>, Path>>>;
	run<
		const Path extends readonly string[],
		// Resolving the shape once here keeps contextual typing of a literal `input` from
		// re-walking the whole tree on every pass.
		S extends CommandShapeAt<AppShape<A, Flags, Tree, Result, CollisionSp>, Path> = CommandShapeAt<
			AppShape<A, Flags, Tree, Result, CollisionSp>,
			Path
		>,
		const Input extends RunInput<S> | OmittableRunInput<S> = RunInput<S>,
	>(
		// The reverse check also rejects explicit subtypes that narrow results or add flags.
		this: [CommandShapeAt<AppShape<A, Flags, Tree, Result, CollisionSp>, Path>] extends [S]
			? { readonly _types: { readonly caps: "app" } }
			: never,
		path: KnownCommandPath<Path, Tree>,
		input: CheckedRunInput<S, Input> | OmittableRunInput<S>,
		options?: InvocationOptions,
	): Promise<ShapeRunOutcome<S>>;
	run<const Path extends readonly string[], const Input>(
		this: { readonly _types: { readonly caps: "app" } },
		path: KnownCommandPath<Path, Tree>,
		input: Input,
		// Validate after inference: a recursive Input intersection exhausts contextual typing
		// even for a broad string supplied to a simple choice flag. Check the whole
		// input union so a valid branch cannot hide an invalid one.
		...validation: [Input] extends [
			CompatibleRunInput<
				CommandShapeAt<AppShape<A, Flags, Tree, Result, CollisionSp>, NoInfer<Path>>,
				Input
			>,
		]
			? readonly [options?: InvocationOptions]
			: readonly [invalidInput: never]
	): Promise<ShapeRunOutcome<CommandShapeAt<AppShape<A, Flags, Tree, Result, CollisionSp>, Path>>>;
	async run(
		path: readonly string[],
		...args: readonly unknown[]
	): Promise<ShapeRunOutcome<CommandShape>> {
		return await runAt(this._node, path, args);
	}

	/**
	 * Bind a typed command path into a reusable {@link CommandHandle}.
	 *
	 * Validates the path eagerly against the prepared command tree, so an
	 * unknown path throws `COMMAND_NOT_FOUND` here rather than on the first
	 * `handle.run()`. The handle is bound to this builder's tree; commands added
	 * afterwards belong to the new builder returned by `.add()`.
	 *
	 * @param path - Typed path to the command to bind (`[]` selects the root)
	 * @throws {CrustError} COMMAND_NOT_FOUND when the path does not name a command
	 */
	at<const Path extends readonly string[]>(
		this: { readonly _types: { readonly caps: "app" } },
		path: KnownCommandPath<Path, Tree>,
	): CommandHandle<CommandShapeAt<AppShape<A, Flags, Tree, Result, CollisionSp>, Path>>;

	at(path: readonly string[]): CommandHandle<CommandShape> {
		resolveTypedPath(prepareInvocation(this._node, materializeCommandDefinition).rootNode, path);
		const node = this._node;
		const boundPath = Object.freeze([...path]);
		return {
			path: boundPath,
			async run(...args: readonly unknown[]): Promise<ShapeRunOutcome<CommandShape>> {
				return await runAt(node, boundPath, args);
			},
		};
	}

	/**
	 * Parse `process.argv`, resolve subcommands, run Extension hooks, and
	 * execute the matched Command Action.
	 *
	 * This is the terminal CLI boundary — call it on the root builder. It
	 * renders a failure once (through Extension `onError` hooks, ending in the
	 * chosen Renderer's `error` or Core's default rendering), sets `process.exitCode` (`1`, or
	 * `130` for an `AbortError` cancellation, `143` when `SIGTERM` cancelled it), and resolves
	 * to the exit code. Each `sensitive` argument or flag given on argv gets one warning line
	 * through the Renderer's `diag`; the exit code is unchanged.
	 *
	 * @param options - Optional overrides: custom `argv` and captured `io` for
	 *                   in-process testing of exit codes and rendered failures,
	 *                   an `onEvent(event)` callback for an async generator action's
	 *                   events, and a caller `signal` that cancels the invocation
	 * @returns The terminal exit code (`0`, `1`, or `130` for cancellation, `143` after `SIGTERM`)
	 */
	execute(
		this: { readonly _types: { readonly caps: "app" } },
		options?: ExecuteOptions,
	): Promise<number>;

	async execute(options?: ExecuteOptions): Promise<number> {
		// Terminal calls render failures and set process exit status instead of throwing.
		return await executeInvocation(this._node, options, materializeCommandDefinition);
	}
}
