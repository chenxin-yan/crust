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
	type ContextUseFlags,
	type DefiningOf,
} from "../api/context.ts";
import type {
	AnyExtension,
	AnyExtensionFactory,
	Extension,
	ExtensionData,
	ExtensionsProvidesOutput,
	RootMetaKey,
	UsedContexts,
	UseSource,
} from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import type { ExtensionId } from "../identity.ts";
import { flagRecordEntries, isBareToken, normalizeArg } from "../parsing/spellings.ts";
import { validateCommandSections } from "../sections.ts";
import type {
	ArgsDef,
	CommandExtras,
	CommandMeta,
	CommandSectionInput,
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
	AliasesOf,
	CommandDefinitionSpellings,
	ExtensionCommandDefs,
	ExtensionsCommandSpellings,
	LocalCommandConfigBrand,
} from "../validation/commands.brands.ts";
import type {
	DeclaredDepsOf,
	KnownContextInstances,
	MissingDeclaredDependencyBrand,
	DeclaredDependencyValuesBrand,
	ValidateContextDeps,
	ValidateContextNames,
	ValidateDeclaredDeps,
	ValidateExtensionProvides,
} from "../validation/contexts.brands.ts";
import type {
	RecursiveOwnFlags,
	ExtensionFlagDefsOf,
	FlagRecordErrors,
	FlagsInput,
	DefinedFlags,
} from "../validation/flags.brands.ts";
import type {
	IsAny,
	IsClosedName,
	IsStaticTuple,
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
	declaredContextNames,
	demandedFactories,
	installContextFlags,
	registerFlag,
} from "./node.ts";
import { CORE_COMMAND_KEYS, extraEntries, snapshotCommand } from "./snapshot.ts";
import type { CommandGroup, CommandSnapshot } from "./snapshot.ts";
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
	ShapeEvent,
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
	/**
	 * Aborted when the caller cancels the invocation (`execute({ signal })`,
	 * `run(path, input, { signal })`, the first `SIGINT` or `SIGTERM` under `execute()`, or a
	 * write to stdout after its reader went away); when a signal or a closed stdout cancelled it,
	 * `signal.reason.cause` is `"SIGINT"`, `"SIGTERM"`, or `"SIGPIPE"`. See `ExecuteOptions` for how the abort maps
	 * to the exit code.
	 */
	signal: AbortSignal;
	/** Readonly, serializable snapshot of the resolved command */
	command: CommandSnapshot;
	/** Readonly snapshot of the application root, including Extension contributions */
	rootCommand: CommandSnapshot;
	/**
	 * Set the invocation's integer exit code for when the action completes; the action carries on and the
	 * last call wins; anything but an integer throws. To stop, `return` or `throw`. A throw exits `1`, or
	 * with the thrown value's non-zero integer `exitCode`.
	 */
	exitCode: (code: number) => void;
	/**
	 * Run a command of this application by path, as `app.run(path, input, options)` does: a fresh
	 * invocation with its own Contexts, Extension hooks, and captured output, which resolves to its
	 * outcome and never throws. Untyped, because a command is defined before its application.
	 * It is cancelled with this invocation unless `options.signal` is given.
	 *
	 * @param path - Canonical names below the root, as for `app.run()` (`[]` selects the root)
	 *
	 * @example
	 * ```ts
	 * const outcome = await runCommand(["db", "migrate"], { flags: { to: 3 } });
	 * if (outcome.status === "failed") throw outcome.error;
	 * ```
	 */
	runCommand: (
		path: readonly string[],
		input?: RunInputPayload,
		options?: InvocationOptions,
	) => Promise<ShapeRunOutcome<CommandShape>>;
}

// ────────────────────────────────────────────────────────────────────────────
// Reusable command definitions
// ────────────────────────────────────────────────────────────────────────────

/** Static configuration for a reusable command definition. */
export interface CommandConfig extends Omit<CommandMeta, "name" | "sections" | "version"> {
	/** Plain-text sections rendered after built-in command documentation. */
	readonly sections?: readonly CommandSectionInput[];
}

/** Static metadata accepted by the root command constructor, including keys packages add through {@link CommandExtras}. */
export interface RootCommandMeta
	extends Pick<CommandMeta, "description" | "version" | "usage" | "examples">, CommandExtras {
	/** Plain-text sections rendered after built-in command documentation. */
	readonly sections?: readonly CommandSectionInput[];
}

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
	"recipe"
>;

// Sealed recipes build local types; .add checks the completed shape against
// call-site Context flags. Checked attachment carries destination validation into the recipe.
type CommandRecipe<Builder extends AnyCommandDefinitionBuilder = AnyCommandDefinitionBuilder> = (
	command: CommandDefinitionBuilder<{}, []>,
) => Builder;

interface CommandDefinitionInternal {
	readonly name: string;
	readonly recipe: (command: AnyCommandDefinitionBuilder) => AnyCommandDefinitionBuilder;
	readonly meta: Omit<CommandMeta, "name">;
	/** Defined with `.command()`: it sees the parent's Contexts in `ctx`, so it parses their flags too. */
	readonly inline?: true;
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
	/** The same definition under a different name, without its aliases, which name the original. */
	as<const N extends string>(name: N): CommandDefinition<N, readonly [], Shape, Deps>;
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

/** A sibling with the same name or alias would make the earlier command unreachable. */
function checkSiblingNames(
	parent: CommandNode,
	head: AddedChild | undefined,
	definitions: readonly CommandDefinition[],
): void {
	const siblingSpellings = takeSpellingIndex(parent);
	for (const definition of definitions) {
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
		for (const spelling of spellings) siblingSpellings.add(spelling);
	}
	if (head !== undefined) spellingIndexes.set(head, siblingSpellings);
}

function materializeCommandDefinition(
	definition: CommandDefinition,
	parent: CommandNode,
	extensionId?: ExtensionId,
): CommandNode {
	const internal = definition[commandDefinitionInternal];
	const name = definition.name;

	const child = new Crust<{}, [], {}, {}, {}, BuilderFacts, void, {}, string, "recipe">(name);
	// A reusable definition parses only the flags of the Contexts it declares with `.use()`.
	if (internal.inline) {
		for (const [flagName, def] of Object.entries(parent.ownedFlags)) {
			registerFlag(child._node, flagName, def, "owned");
		}
		child._node.flagContexts = parent.flagContexts;
		child._node.inheritedDemands = [
			...parent.inheritedDemands,
			...demandedFactories(parent.demands),
		];
	}
	child._node.contexts = parent.contexts.map((context) => ({ ...context }));

	const configured = internal.recipe(child);
	if (
		process.env.CRUST_INTERNAL_BUILD !== "1" &&
		configured._ancestorOwnedFlags !== child._ancestorOwnedFlags
	) {
		const owner = extensionId
			? `Extension "${extensionId}" command "${name}"`
			: `Command "${name}"`;
		throw new CrustError(
			"DEFINITION",
			`${owner} definition must return the same command builder it received`,
			{
				subject: extensionId ? "extension" : "command",
				name: extensionId ?? name,
				reason: "foreign-command-builder",
			},
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
	Tree extends object = {},
	CtxFlags extends FlagsDef = {},
	Result = void,
	Deps extends ContextMap = {},
	Providers extends Record<string, ContextValue> = {},
> = Crust<
	Flags,
	A,
	Ctx,
	Tree,
	CtxFlags,
	BuilderFacts<{}, Deps, Providers>,
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
type DefinitionEntryForSpelling<
	D,
	Spelling extends string,
	CF extends FlagsDef | false,
> = D extends unknown
	? CommandDefinitionData<D> extends { readonly _shape?: infer Shape extends CommandShape }
		? Spelling extends CommandDefinitionSpellings<D>
			? EntryShape<Shape, CF>
			: never
		: never
	: never;

// Applies flags that reach a whole subtree (recursive Extension flags) to a shape and every
// descendant. Local parent flags never inherit and stay out.
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

// Inline `.command()` children inherit the parent's Context-owned flags at runtime
// (materialization seeds them with `parent.ownedFlags`), so the typed shape merges them too.
// Only one level: an inline child's own inline children merge them at their `.command()`,
// and a reusable child below parses only the Context flags it uses. The mark lets readers
// add Extension-provided Context flags to inline commands added before `.extend()`.
type InlineShape<S, CF extends FlagsDef> =
	S extends CommandShape<infer SA, infer SF, infer SC, infer SR, infer P, infer SE>
		? CommandShape<SA, keyof CF extends never ? SF : MergeFlags<CF, SF>, SC, SR, P, SE, true>
		: never;

// `false`: reusable definitions, which parse only the Context flags they use: the declared
// Contexts' (a same-name provider must own exactly those; see `checkProvidedContextFlags`).
type EntryShape<S, CF extends FlagsDef | false> = [CF] extends [FlagsDef] ? InlineShape<S, CF> : S;

type DefinitionsTree<
	Ds extends readonly CommandDefinition<any, any, any, any>[],
	CtxFlags extends FlagsDef | false = false,
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
				? { [K in N | Al[number]]: EntryShape<S, CtxFlags> }
				: DefinitionsTreeSlow<Ds, CtxFlags>
	: DefinitionsTreeSlow<Ds, CtxFlags>;

type DefinitionsTreeSlow<
	Ds extends readonly CommandDefinition<any, any, any, any>[],
	CtxFlags extends FlagsDef | false,
> =
	string extends AttachedCommandSpellings<Ds>
		? Record<string, CommandShape> & KnownDefinitionTree<Ds, CtxFlags>
		: {
				[K in CommandDefinitionSpellings<Ds[number]>]: DefinitionEntryForSpelling<
					Ds[number],
					K,
					CtxFlags
				>;
			};

// Accumulates in tail position so a long batch with a runtime-only name stays clear of TS2589.
type KnownDefinitionTree<Ds extends readonly unknown[], CF extends FlagsDef | false, Acc = {}> =
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
									[K in CommandDefinitionSpellings<H>]: DefinitionEntryForSpelling<H, K, CF>;
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
type ExtensionProvidedFlags<E> = ContextsOwnedFlags<ExtensionProviders<E>>;
/** Flags of the Contexts an Extension's hooks use: every command parses them. */
type ExtensionHookFlags<E> = [E] extends [never]
	? {}
	: DefiningOf<E> extends { readonly _hookFlags?: infer F extends FlagsDef }
		? F
		: {};

// The root's: it provides the Extension Contexts, so it parses their flags too.
type ExtensionFlags<Es extends readonly AnyExtension[], Acc = {}> = Es extends readonly [
	infer H,
	...infer T extends readonly AnyExtension[],
]
	? ExtensionFlags<
			T,
			ReplaceEntries<Acc, ExtensionOwnFlags<H> & ExtensionProvidedFlags<H> & ExtensionHookFlags<H>>
		>
	: Acc &
			(keyof ExtensionOwnFlags<Es[number]> extends never
				? keyof ExtensionProvidedFlags<Es[number]> extends never
					? keyof ExtensionHookFlags<Es[number]> extends never
						? {}
						: FlagsDef
					: FlagsDef
				: FlagsDef);

type RecursiveFlagsOf<E> = RecursiveOwnFlags<ExtensionOwnFlags<E>>;

type RecursiveExtensionFlags<Es extends readonly AnyExtension[], Acc = {}> = Es extends readonly [
	infer H,
	...infer T extends readonly AnyExtension[],
]
	? RecursiveExtensionFlags<T, ReplaceEntries<Acc, RecursiveFlagsOf<H> & ExtensionHookFlags<H>>>
	: Acc & ExtensionFlags<Es>;

// Fold of `ExtensionProvidedFlags`: inline `.command()` children added after `.extend()` inherit them.
type ExtensionsProvidedFlags<Es extends readonly AnyExtension[], Acc = {}> = Es extends readonly [
	infer H,
	...infer T extends readonly AnyExtension[],
]
	? ExtensionsProvidedFlags<T, ReplaceEntries<Acc, ExtensionProvidedFlags<H>>>
	: Acc;

type UseSourceFlags<S> = ContextUseFlags<
	S extends AnyContextFactory
		? [S]
		: ExtensionProviders<S extends AnyExtensionFactory ? ReturnType<S> : S>
>;

type UseSourcesFlags<Us extends readonly unknown[], Acc = {}> = Us extends readonly [
	infer H,
	...infer T,
]
	? UseSourcesFlags<T, Acc & UseSourceFlags<H>>
	: Acc;

/** Flags a command parses for a `.use()` call: an Extension stands for the Contexts it provides. */
type UsedContextFlags<Us extends readonly UseSource[]> = Us extends readonly AnyContextFactory[]
	? ContextUseFlags<Us>
	: IsStaticTuple<Us> extends true
		? UseSourcesFlags<Us>
		: FlagsDef;

type TreeWithInheritedFlags<Tree, F extends FlagsDef> = {
	[K in keyof Tree]: ShapeWithInheritedFlags<Tree[K], F>;
};

// Recursive Extension flags (and the flags of Contexts Extension hooks use) reach every command
// at runtime, whenever it was added, so stored
// shapes leave them out and readers apply the accumulated set once. Flagging the tree on each
// `.extend()` nested one mapped type per call (TS2589 at about 50 calls), and resolving it
// eagerly instead re-walked every existing command per call. Leaving them out also keeps the
// stored tree independent of where `.add()` sits relative to `.extend()`.
type TreeWithRecursiveFlags<Tree extends object, R extends FlagsDef> = keyof R extends never
	? Tree
	: TreeWithInheritedFlags<Tree, R>;

// Extension-provided Context flags reach the root's inline `.command()` children (and theirs),
// whenever they were added, like the root's own providers reach later ones. Reusable commands
// stop the walk: they parse only the Context flags they use.
type TreeWithInlineFlags<Tree extends object, F extends FlagsDef> = keyof F extends never
	? Tree
	: InlineScopeTree<Tree, F>;

type InlineScopeTree<Tree, F extends FlagsDef> = {
	[K in keyof Tree]: Tree[K] extends CommandShape<
		infer SA,
		infer SF,
		infer SC,
		infer SR,
		infer P,
		infer SE,
		true
	>
		? CommandShape<SA, MergeFlags<F, SF>, InlineScopeTree<SC, F>, SR, P, SE, true>
		: Tree[K];
};

/** The root shape that typed `run()`, `at()` and `_types` read. */
type AppShape<
	A extends ArgsDef,
	F extends FlagsDef,
	Tree extends object,
	Result,
	S extends AnyBuilderFacts,
> = CommandShape<
	A,
	F,
	TreeWithRecursiveFlags<TreeWithInlineFlags<Tree, AppInlineFlagsOf<S>>, AppRecursiveFlagsOf<S>>,
	Result,
	Record<string, ContextValue>,
	ActionEvents<S>
>;

// Literal keys only: an open record's index signature names no entry to replace.
type LiteralKeys<T> = keyof { [K in keyof T as string extends K ? never : K]: 0 };

// An Extension entry that overlaps an earlier one passes preparation as a same-id
// re-registration, where the later Extension replaces the earlier, so its entries win. It also
// passes when a later registration removes one of two different Extensions; the later entry still
// wins here, though the earlier one may be what runs.
type ReplaceEntries<Base, Next> = [LiteralKeys<Base> & LiteralKeys<Next>] extends [never]
	? Base & Next
	: { [K in keyof Base as K extends LiteralKeys<Next> ? never : K]: Base[K] } & Next;

/** `readonly [id, flag names]` for each literal Extension id registered so far; see `ReplacedFlagNames`. */
type ExtensionFlagNamesOf<S extends AnyBuilderFacts> = Exclude<S["extensionFlagNames"], undefined>;

/** An Extension's literal id; `never` for a runtime-only one, which the types cannot follow. */
type LiteralExtensionId<E> = E extends { readonly id: ExtensionId<infer Id> }
	? IsUnion<Id> extends true
		? never
		: IsClosedName<Id> extends true
			? Id
			: never
	: never;

// Only a registration that certainly happens retires an id: not a conditional or open list.
type DefiniteExtensionIds<Es extends readonly AnyExtension[]> =
	IsStaticTuple<Es> extends true ? LiteralExtensionId<Es[number]> : never;

/**
 * Flag names an Extension contributes, for a later same-id registration; an open record names
 * none. Not the flags of the Contexts its hooks `.use()`: their provider still supplies them.
 */
type ContributedFlagNames<E> = keyof (ExtensionOwnFlags<E> &
	ExtensionProvidedFlags<E>) extends infer K
	? string extends K
		? never
		: K
	: never;

// A same-id registration replaces the earlier one at runtime, so the flags only the earlier one
// contributed are gone; the later one's own come back through `ReplaceEntries`.
type ReplacedFlagNames<S extends AnyBuilderFacts, Es extends readonly AnyExtension[]> = Extract<
	ExtensionFlagNamesOf<S>,
	readonly [DefiniteExtensionIds<Es>, unknown]
>[1];

type WithoutNames<Base, Names> = [Names] extends [never]
	? Base
	: { [K in keyof Base as K extends Names ? never : K]: Base[K] };

// A flat union of pairs: a nested record per `.extend()` call hits TS2589 at about 48 calls.
type RegisteredFlagNames<Names extends object, Es extends readonly AnyExtension[]> = [
	DefiniteExtensionIds<Es>,
] extends [never]
	? Names
	: | Exclude<Names, readonly [DefiniteExtensionIds<Es>, unknown]>
		| (Es[number] extends infer E
				? E extends unknown
					? [LiteralExtensionId<E>] extends [never]
						? never
						: readonly [LiteralExtensionId<E>, ContributedFlagNames<E>]
					: never
				: never);

// Extension commands join the tree like `.add()`: a colliding command is a definition error.
// Resolving with `infer R` keeps a chain of `.extend()` calls from deferring one nested tree per
// call (TS2589 at about 90 calls).
type ExtensionCommandTree<
	Tree,
	Es extends readonly AnyExtension[],
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
		: ReplaceEntries<
					Tree,
					// An app command an Extension collides with only survives preparation unreplaced.
					WithoutNames<
						DefinitionsTree<ExtensionCommands<Es>>,
						Exclude<LiteralKeys<Tree>, ExtensionCommandSpellings>
					>
			  > extends infer R extends object
			? R
			: never;

function checkCommandName(name: string, aliases: readonly string[] = []): void {
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
}

function checkChildCommandName(name: string, aliases: readonly string[] = []): void {
	checkCommandName(name, aliases);
	if (!isBareToken(name)) {
		throw new CrustError(
			"DEFINITION",
			`Command name "${name}" must not contain whitespace or start with "-"`,
			{ subject: "command", name, reason: "invalid-name" },
		);
	}
	for (const alias of aliases) {
		if (!isBareToken(alias)) {
			throw new CrustError("DEFINITION", `Command "${name}" has an invalid alias "${alias}"`, {
				subject: "command",
				name,
				reason: "invalid-alias",
			});
		}
	}
}

function isCommandRecipe(value: CommandConfig | CommandRecipe | undefined): value is CommandRecipe {
	return typeof value === "function";
}

/**
 * Define a reusable, inert command under a required name.
 *
 * The recipe runs once per `.add()`, receiving a fresh builder.
 *
 * Static metadata belongs in `config`. Use `.as(name)` to add one definition under a different
 * name; the copy has no aliases, since they name the original.
 *
 * `name` and the aliases are checked here when the CLI runs from source and in
 * `crust build`.
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
	config: C & LocalCommandConfigBrand<C>,
	recipe: CommandRecipe<Builder>,
): CommandDefinition<Name, AliasesOf<C>, ShapeOfBuilder<Builder>, DepsOfBuilder<Builder>>;

export function defineCommand(
	name: string,
	configOrRecipe: CommandConfig | CommandRecipe,
	maybeRecipe?: CommandRecipe,
): CommandDefinition {
	const hasConfig = !isCommandRecipe(configOrRecipe);
	const config: CommandConfig & { readonly version?: unknown } = hasConfig ? configOrRecipe : {};
	const recipe = hasConfig ? maybeRecipe : configOrRecipe;
	if (process.env.CRUST_INTERNAL_BUILD !== "1") checkChildCommandName(name, config.aliases);

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
	const { aliases: _aliases, ...renamedMeta } = meta;
	// Aliases are a type-only phantom here; the overloads restate the configured ones.
	const named = <const DefName extends string>(
		defName: DefName,
		definitionMeta: Omit<CommandMeta, "name">,
	): CommandDefinition<DefName, readonly []> => {
		return Object.freeze({
			name: defName,
			as: <const NewName extends string>(newName: NewName) => {
				if (process.env.CRUST_INTERNAL_BUILD !== "1") checkChildCommandName(newName);
				return named(newName, renamedMeta);
			},
			[commandDefinitionInternal]: Object.freeze({
				...internal,
				name: defName,
				meta: definitionMeta,
			}),
		});
	};
	return named(name, meta);
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

/** Builder types beyond `Crust`'s own parameters: Context obligations, Extension contributions, output. */
type BuilderFacts<
	Demands extends ContextMap = {},
	RecipeDeps extends ContextMap = {},
	Providers extends Record<string, ContextValue> = {},
	ActionDeps extends ContextMap = {},
	// Root command spellings with precise tree entries contributed by Extensions. Only `.extend()`
	// reads it (ExtensionCommandsOf); other steps pass it through unread, `undefined` included.
	ExtensionCommandSpellings extends string | undefined = never,
	RecursiveFlags extends FlagsDef = {},
	// The `.output()` schema and the action's awaited return, each checked against the other.
	Output extends OutputState | undefined = InitialOutputState,
	// Extension-provided Context flags registered so far; see `TreeWithInlineFlags`.
	InlineFlags extends FlagsDef = {},
	// `readonly [id, flag names]` per literal Extension id registered; see `ReplacedFlagNames`.
	ExtensionFlagNames extends object = {},
> = {
	readonly extensionFlagNames: ExtensionFlagNames;
	readonly output: Output;
	readonly actionDeps: ActionDeps;
	readonly extensionCommands: ExtensionCommandSpellings;
	readonly recursiveFlags: RecursiveFlags;
	readonly inlineFlags: InlineFlags;
	readonly demands: Demands;
	readonly recipeDeps: RecipeDeps;
	readonly providers: Providers;
};

// Explicit `| undefined`: mapped types over these members (e.g. `Omit`) keep it under exactOptionalPropertyTypes.
type AnyBuilderFacts = {
	readonly output?: OutputState | undefined;
	readonly actionDeps?: ContextMap | undefined;
	readonly extensionCommands?: string | undefined;
	readonly recursiveFlags?: FlagsDef | undefined;
	readonly inlineFlags?: FlagsDef | undefined;
	readonly extensionFlagNames?: object | undefined;
	readonly demands: ContextMap;
	readonly recipeDeps?: ContextMap | undefined;
	readonly providers?: Record<string, ContextValue> | undefined;
};

// Indexed access, not `infer`: `AnyCommandDefinitionBuilder`'s `any` facts must yield `any`,
// not `object | {}`. A builder whose action returns `never` misses the variance shortcut (`any`
// is not assignable to `never`), and the structural fallback compares these contravariant proof slots.
// `Exclude`, not `NonNullable`: its `& {}` hit TS2589 on long `.add()` chains.
type RecipeDepsOf<S extends AnyBuilderFacts> = Exclude<S["recipeDeps"], undefined>;

type ProvidersOf<S extends AnyBuilderFacts> = Exclude<S["providers"], undefined>;

/** Obligations of this node's stored action, never inherited by descendants. */
type ActionDepsOf<S extends AnyBuilderFacts> = Exclude<S["actionDeps"], undefined>;

// Not `Exclude`: distributing over this union, which grows with each `.extend()`, cost +6% on a
// 200-call chain. A state without the member (explicit type arguments) opens every entry.
type ExtensionCommandsOf<S extends AnyBuilderFacts> = [S["extensionCommands"]] extends [
	infer E extends string,
]
	? E
	: string;

/** Recursive Extension flags registered so far; see `TreeWithRecursiveFlags`. */
type AppRecursiveFlagsOf<S extends AnyBuilderFacts> = Exclude<S["recursiveFlags"], undefined>;

/**
 * `schema` is the `.output()` schema; `actionReturn` holds the action's {@link ActionCompletion}
 * (`undefined` before any `.action()`), kept apart from the result the schema produces.
 */
type OutputState = {
	readonly schema: StandardSchema | undefined;
	readonly actionReturn: AnyActionCompletion | undefined;
};

// `actionReturn` stays open (no action, or any) so a builder annotated with the default state,
// such as `CommandDefinitionBuilder<F, A>`, still accepts one after `.action()`.
type InitialOutputState = {
	readonly schema: undefined;
	readonly actionReturn: AnyActionCompletion | undefined;
};

// `never` events: an action that never returns (see `ActionCompletion`).
type AnyActionCompletion = readonly [result: unknown, events: readonly unknown[] | undefined];

/**
 * What an action returning `R` completes with: its awaited return and no events, or, when it
 * returns an async generator (an `async function*`), the generator's `return` value and the
 * values it yields. A promise of a generator is an ordinary result, as at runtime. `any` and
 * `never` stay whole; a union is taken member by member, since the runtime drains whichever
 * generator a call returns.
 */
type ActionCompletion<R> =
	IsAny<R> extends true
		? readonly [result: any, events: readonly unknown[] | undefined]
		: [R] extends [never]
			? readonly [result: never, events: never]
			: R extends AsyncGenerator<infer Event, infer Returned>
				? readonly [result: Awaited<Returned>, events: readonly Event[]]
				: readonly [result: Awaited<R>, events: undefined];

type OutputStateOf<S extends AnyBuilderFacts> = Exclude<S["output"], undefined>;

type OutputSchemaOf<S extends AnyBuilderFacts> = Exclude<OutputStateOf<S>["schema"], undefined>;

type ActionReturnOf<S extends AnyBuilderFacts> = OutputStateOf<S>["actionReturn"];

/**
 * What the action may return: anything, or the `.output()` schema's input (possibly awaited,
 * or the `return` value of an `async function*`).
 */
type ActionReturn<S extends AnyBuilderFacts> = [OutputSchemaOf<S>] extends [never]
	? unknown
	: | InferInput<OutputSchemaOf<S>>
		| PromiseLike<InferInput<OutputSchemaOf<S>>>
		| AsyncGenerator<unknown, InferInput<OutputSchemaOf<S>>>;

/**
 * The values an async generator action yields; `undefined` for any other (or no) action. Erased
 * builder states (`AnyCrust`, whose `output` is optional, and `AnyCommandDefinitionBuilder`,
 * whose action return is `any`) may hold any action, so stay open.
 */
type ActionEvents<S extends AnyBuilderFacts> = undefined extends S["output"]
	? readonly unknown[] | undefined
	: IsAny<ActionReturnOf<S>> extends true
		? readonly unknown[] | undefined
		: ActionReturnOf<S> extends readonly [
					unknown,
					infer Events extends readonly unknown[] | undefined,
			  ]
			? Events
			: undefined;

/**
 * The command result: the awaited action return (an `async function*`'s `return` value), or the
 * `.output()` schema's output, awaited too because the invocation resolves any promise the
 * schema returns.
 */
type ActionResult<S extends AnyBuilderFacts, R> = [OutputSchemaOf<S>] extends [never]
	? ActionCompletion<R>[0]
	: Awaited<InferOutput<OutputSchemaOf<S>>>;

// `.output()` after `.action()` checks the action's result against the new schema;
// a state that may have no action (see `InitialOutputState`) has nothing to check.
type OutputResultBrand<
	Return extends AnyActionCompletion | undefined,
	S extends StandardSchema,
> = undefined extends Return
	? {}
	: [NonNullable<Return>[0]] extends [InferInput<S>]
		? {}
		: {
				readonly FIX_OUTPUT: "The action's result does not match this output schema's input type";
			};

/** Extension-provided Context flags registered so far; see `TreeWithInlineFlags`. */
type AppInlineFlagsOf<S extends AnyBuilderFacts> = Exclude<S["inlineFlags"], undefined>;

type AfterFlags<State extends BuilderState, F extends FlagsDef> = Crust<
	State["flags"] & F,
	State["args"],
	State["ctx"],
	State["tree"],
	State["ctxFlags"],
	State["facts"],
	State["result"],
	State["meta"],
	string,
	State["caps"]
>;

type AfterArgs<State extends BuilderState, NewA extends ArgsDef> = Crust<
	State["flags"],
	AppendedArgs<State["args"], NewA>,
	State["ctx"],
	State["tree"],
	State["ctxFlags"],
	State["facts"],
	State["result"],
	State["meta"],
	string,
	State["caps"]
>;

type AfterUse<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Tree extends object,
	CtxFlags extends FlagsDef,
	Facts extends AnyBuilderFacts,
	Result,
	Us extends readonly UseSource[],
	Meta extends RootCommandMeta | undefined,
> = Crust<
	Flags & UsedContextFlags<Us>,
	A,
	MergeContext<Ctx, UsedContexts<Us>>,
	Tree,
	CtxFlags & UsedContextFlags<Us>,
	BuilderFacts<
		Facts["demands"],
		MergeContext<RecipeDepsOf<Facts>, UsedContexts<Us>>,
		ProvidersOf<Facts>,
		ActionDepsOf<Facts>,
		Facts["extensionCommands"],
		AppRecursiveFlagsOf<Facts>,
		Facts["output"],
		AppInlineFlagsOf<Facts>,
		ExtensionFlagNamesOf<Facts>
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
	Tree extends object,
	CtxFlags extends FlagsDef,
	Facts extends AnyBuilderFacts,
	Result,
	Cs extends readonly AnyContextInstance[],
	Meta extends RootCommandMeta | undefined,
	Caps extends "app" | "recipe",
> = Crust<
	Flags & ContextsOwnedFlags<Cs>,
	A,
	MergeProviders<Ctx, ContextsOutput<Cs>>,
	Tree,
	CtxFlags & ContextsOwnedFlags<Cs>,
	BuilderFacts<
		Facts["demands"],
		RecipeDepsOf<Facts>,
		MergeProviders<ProvidersOf<Facts>, ContextsOutput<Cs>>,
		ActionDepsOf<Facts>,
		Facts["extensionCommands"],
		AppRecursiveFlagsOf<Facts>,
		Facts["output"],
		AppInlineFlagsOf<Facts>,
		ExtensionFlagNamesOf<Facts>
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
	Tree extends object,
	CtxFlags extends FlagsDef,
	Facts extends AnyBuilderFacts,
	R,
	Meta extends RootCommandMeta | undefined,
	Caps extends "app" | "recipe",
> = Crust<
	Flags,
	A,
	Ctx,
	Tree,
	CtxFlags,
	Omit<Facts, "actionDeps" | "output"> & {
		readonly actionDeps: Ctx;
		readonly output: {
			readonly schema: OutputStateOf<Facts>["schema"];
			readonly actionReturn: ActionCompletion<R>;
		};
	},
	ActionResult<Facts, R>,
	Meta,
	string,
	Caps
>;

type AfterOutput<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Tree extends object,
	CtxFlags extends FlagsDef,
	Facts extends AnyBuilderFacts,
	S extends StandardSchema,
	Meta extends RootCommandMeta | undefined,
	Caps extends "app" | "recipe",
> = Crust<
	Flags,
	A,
	Ctx,
	Tree,
	CtxFlags,
	Omit<Facts, "output"> & {
		readonly output: { readonly schema: S; readonly actionReturn: ActionReturnOf<Facts> };
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
	Tree extends object,
	CtxFlags extends FlagsDef,
	Facts extends AnyBuilderFacts,
	Result,
	Es extends readonly AnyExtension[],
	Meta extends RootCommandMeta | undefined,
	Caps extends "app" | "recipe",
> = Crust<
	// Not `MergeFlags`: re-instantiating an alias revisits its type arguments, so a chain of
	// `.extend()` calls would nest one `MergeFlags<…>` level per call (TS2589 at about 100 calls).
	// `ReplaceEntries` is a conditional, resolved at each call.
	ReplaceEntries<WithoutNames<Flags, ReplacedFlagNames<Facts, Es>>, ExtensionFlags<Es>>,
	A,
	MergeProviders<Ctx, ExtensionsProvidesOutput<Es>>,
	ExtensionCommandTree<Tree, Es, ExtensionCommandsOf<Facts>>,
	ReplaceEntries<WithoutNames<CtxFlags, ReplacedFlagNames<Facts, Es>>, ExtensionsProvidedFlags<Es>>,
	BuilderFacts<
		Facts["demands"] & ExtensionDemandValues<Es>,
		RecipeDepsOf<Facts>,
		MergeProviders<ProvidersOf<Facts>, ExtensionsProvidesOutput<Es>>,
		ActionDepsOf<Facts>,
		// An open call adds no precise entries (see ExtensionCommandTree).
		// Not a spelling an app command holds: the Extension's entry never joined the tree.
		| ExtensionCommandsOf<Facts>
		| Exclude<
				KnownSpellings<ExtensionsCommandSpellings<Es>>,
				Exclude<LiteralKeys<Tree>, ExtensionCommandsOf<Facts>>
		  >,
		ReplaceEntries<
			WithoutNames<AppRecursiveFlagsOf<Facts>, ReplacedFlagNames<Facts, Es>>,
			RecursiveExtensionFlags<Es>
		>,
		Facts["output"],
		ReplaceEntries<
			WithoutNames<AppInlineFlagsOf<Facts>, ReplacedFlagNames<Facts, Es>>,
			ExtensionsProvidedFlags<Es>
		>,
		RegisteredFlagNames<ExtensionFlagNamesOf<Facts>, Es>
	>,
	Result,
	Meta,
	string,
	Caps
>;

type AfterAdd<
	State extends BuilderState,
	Ds extends readonly CommandDefinition<any, any, any, any>[],
	// Context-owned flags the added commands inherit: inline `.command()` children only.
	Inherited extends FlagsDef | false = false,
> = Crust<
	State["flags"],
	State["args"],
	State["ctx"],
	State["tree"] & DefinitionsTree<Ds, Inherited>,
	State["ctxFlags"],
	BuilderFacts<
		State["facts"]["demands"],
		AddedRecipeDeps<State, Ds>,
		ProvidersOf<State["facts"]>,
		ActionDepsOf<State["facts"]>,
		State["facts"]["extensionCommands"],
		AppRecursiveFlagsOf<State["facts"]>,
		State["facts"]["output"],
		AppInlineFlagsOf<State["facts"]>,
		ExtensionFlagNamesOf<State["facts"]>
	>,
	State["result"],
	State["meta"],
	string,
	State["caps"]
>;

// A definition demands its recipe's `.use()` Contexts and its children's demands that its own
// Contexts don't cover; the command that adds it checks them all (only the root reports them
// missing). Forwarding parses no flags: those stay on the commands that `.use()` the Context.
type AddedRecipeDeps<
	State extends BuilderState,
	Ds extends readonly unknown[],
> = State["caps"] extends "recipe"
	? [Ds[number]] extends [never]
		? RecipeDepsOf<State["facts"]>
		: DeclaredDepsOf<Ds[number]> extends infer D extends ContextMap
			? keyof D extends never
				? RecipeDepsOf<State["facts"]>
				: MergeContext<
						RecipeDepsOf<State["facts"]>,
						keyof D & keyof State["ctx"] extends never ? D : Omit<D, keyof State["ctx"]>
					>
			: never
	: RecipeDepsOf<State["facts"]>;

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
type ValidateInlineCommandDeps<
	State extends BuilderState,
	N extends string,
	B,
> = MissingDeclaredDependencyBrand<
	{ readonly name: N; readonly _deps?: DepsOfBuilder<B> },
	KnownDepsAt<State>
> &
	DeclaredDependencyValuesBrand<DepsOfBuilder<B>, State["ctx"]>;

/** A recipe forwards the demands it can't meet (see `AddedRecipeDeps`); the root reports them. */
type KnownDepsAt<State extends BuilderState> = State["caps"] extends "recipe"
	? string
	: keyof State["ctx"] & string;

// An inline child's builder: it parses the Context-owned flags its parent has at the call site,
// and the recursive Extension flags registered so far, which every command parses. Its facts
// carry those on, so its own inline children see them too; readers still apply them to every
// stored shape (see `AppShape`), which also covers commands added before `.extend()`.
type InlineCommandBuilder<State extends BuilderState> = Crust<
	State["ctxFlags"] & AppRecursiveFlagsOf<State["facts"]>,
	[],
	State["ctx"],
	{},
	State["ctxFlags"],
	BuilderFacts<{}, {}, {}, {}, never, AppRecursiveFlagsOf<State["facts"]>>,
	void,
	{},
	string,
	"recipe"
>;

type InlineCommandRecipe<State extends BuilderState, N extends string, B> = ((
	command: InlineCommandBuilder<State>,
) => B & ValidateInlineCommandDeps<State, N, NoInfer<B>>) &
	NoInfer<DescendantValuesBrand<{ child: ShapeOfBuilder<B> }, State["facts"]["demands"]>>;

// A generic method that names any class parameter is instantiated through a composite
// class+method mapper, which re-instantiates every object-valued argument on each call
// (O(n^2) over an `.add()` chain). Signatures that read all state off an inferred `this`
// name no class parameter and resolve it by property lookup instead. `State` is inferred from
// the receiver's properties, so a generic or polymorphic-`this` receiver resolves through its
// constraint. Cost: the state is now structural, so formerly phantom parameters (Facts) take
// part in assignability.
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

/** The builder a `.group()` block's last call left, rebuilt from its state. */
type GroupResult<State extends BuilderState> = Crust<
	State["flags"],
	State["args"],
	State["ctx"],
	State["tree"],
	State["ctxFlags"],
	State["facts"],
	State["result"],
	State["meta"],
	string,
	State["caps"]
>;

/** What a `.group()` block receives: its first call makes it a command group or a flag group. */
export interface GroupBuilder<State> extends CommandGroupBuilder<State> {
	/** Define local flags listed under this group's heading; see `Crust.flags`. */
	flags<const F extends FlagsInput, S extends BuilderState = ExplicitTypeArgumentsError>(
		this: StateReceiver<S>,
		flags: F & FlagRecordErrors<F>,
	): FlagGroupBuilder<AfterFlags<S, DefinedFlags<F>>["_state"]>;
}

// A builder has `_state`, `add`, `command`, and `flags` too; the brand keeps a block from returning one.
declare const groupHandleBrand: unique symbol;

/** A `.group()` block that registers commands; it takes no flags. */
export interface CommandGroupBuilder<State> {
	/** @internal */
	readonly [groupHandleBrand]: true;
	/** @internal */
	readonly _state: State;
	/** @internal */
	readonly _stateIn: (state: State) => void;
	/** Register command definitions listed under this group's heading; see `Crust.add`. */
	add<
		const Ds extends readonly CommandDefinition<any, any, any, any>[] = never,
		S extends BuilderState = ExplicitTypeArgumentsError,
	>(
		this: StateReceiver<S>,
		...definitions: Ds &
			ValidateDeclaredDeps<S["ctx"], Ds, KnownDepsAt<S>> &
			DefinitionDescendantValuesBrand<Ds, S["facts"]["demands"]>
	): CommandGroupBuilder<AfterAdd<S, Ds>["_state"]>;
	/** Define a subcommand inline, listed under this group's heading; see `Crust.command`. */
	command<
		const N extends string,
		B extends AnyCommandDefinitionBuilder,
		S extends BuilderState = ExplicitTypeArgumentsError,
	>(
		this: StateReceiver<S>,
		name: N,
		recipe: InlineCommandRecipe<S, N, B>,
	): CommandGroupBuilder<
		AfterAdd<
			S,
			readonly [CommandDefinition<N, readonly [], ShapeOfBuilder<B>, DepsOfBuilder<B>>],
			S["ctxFlags"]
		>["_state"]
	>;
	command<
		const N extends string,
		const C extends CommandConfig,
		B extends AnyCommandDefinitionBuilder,
		S extends BuilderState = ExplicitTypeArgumentsError,
	>(
		this: StateReceiver<S>,
		name: N,
		config: C & LocalCommandConfigBrand<C>,
		recipe: InlineCommandRecipe<S, N, B>,
	): CommandGroupBuilder<
		AfterAdd<
			S,
			readonly [CommandDefinition<N, AliasesOf<C>, ShapeOfBuilder<B>, DepsOfBuilder<B>>],
			S["ctxFlags"]
		>["_state"]
	>;
}

/** A `.group()` block that defines flags; it takes no commands. */
export interface FlagGroupBuilder<State> {
	/** @internal */
	readonly [groupHandleBrand]: true;
	/** @internal */
	readonly _state: State;
	/** @internal */
	readonly _stateIn: (state: State) => void;
	/** Define more local flags listed under this group's heading; see `Crust.flags`. */
	flags<const F extends FlagsInput, S extends BuilderState = ExplicitTypeArgumentsError>(
		this: StateReceiver<S>,
		flags: F & FlagRecordErrors<F>,
	): FlagGroupBuilder<AfterFlags<S, DefinedFlags<F>>["_state"]>;
}

/** Each group handle's builder and what its block registered so far; handles stay immutable, like builders. */
const groupHandles = new WeakMap<
	object,
	{ readonly builder: AnyRuntimeCrust; readonly group: CommandGroup }
>();

// The runtime-erased builder methods a group handle forwards to.
type AnyRuntimeCrust = {
	_node: CommandNode;
	add(...definitions: readonly CommandDefinition[]): AnyRuntimeCrust;
	command(name: string, ...rest: readonly unknown[]): AnyRuntimeCrust;
	flags(record: object): AnyRuntimeCrust;
	_clone<Out>(nodeOverrides: Partial<CommandNode>): Out;
};

function groupHandle(builder: AnyRuntimeCrust, group: CommandGroup): object {
	const { title } = group;
	const commands = (next: AnyRuntimeCrust, names: readonly string[]) =>
		groupHandle(
			next,
			Object.freeze({
				title,
				commands: Object.freeze([...("commands" in group ? group.commands : []), ...names]),
			}),
		);
	const handle = {
		add: (...definitions: readonly CommandDefinition[]) =>
			commands(
				builder.add(...definitions),
				definitions.map(({ name }) => name),
			),
		command: (name: string, ...rest: readonly unknown[]) =>
			commands(builder.command(name, ...rest), [name]),
		flags: (record: object) =>
			groupHandle(
				builder.flags(record),
				Object.freeze({
					title,
					flags: Object.freeze([...("flags" in group ? group.flags : []), ...Object.keys(record)]),
				}),
			),
	};
	groupHandles.set(handle, { builder, group });
	return handle;
}

/** Completed applications expose inspection and invocation, not authoring after erasure. */
export type AnyCrust = Pick<
	Crust<
		FlagsDef,
		ArgsDef,
		Record<string, ContextValue>,
		CommandTree,
		FlagsDef,
		AnyBuilderFacts,
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
 * - `Flags` — flags defined locally or installed by provided or used Contexts
 * - `A` — positional argument definitions
 * - `Ctx` — provided Context values
 * - `Tree` — command shapes accumulated by `.add()` for typed `run()`
 * - `CtxFlags` — Context-owned flags accumulated by `.provide()` and `.use()`, inherited
 *   by the shapes of inline `.command()` children added afterwards (recursive Extension
 *   flags reach every command and are applied where shapes are read; see `TreeWithRecursiveFlags`)
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
	Tree extends object = {},
	CtxFlags extends FlagsDef = {},
	Facts extends AnyBuilderFacts = BuilderFacts,
	Result = void,
	const out Meta extends RootCommandMeta | undefined = {},
	// Constructors cannot declare generics; append Name to preserve explicit type-argument order.
	const Name extends string = string,
	Caps extends "app" | "recipe" = "app",
> {
	/** @internal — not `private`: declaration emit erases private member types, dropping the proof from dist. */
	declare readonly _contextProof: (
		state: [Flags, A, Ctx, CtxFlags, Facts["demands"], ActionDepsOf<Facts>, Caps],
	) => void;

	/** @internal — recipe state, without structural inference through builder methods. */
	declare readonly _recipeTypes: {
		readonly shape: CommandShape<A, Flags, Tree, Result, ProvidersOf<Facts>, ActionEvents<Facts>>;
		readonly deps: RecipeDepsOf<Facts>;
		readonly proof?: (
			state: [
				CommandInputShape<
					CommandShape<A, Flags, Tree, Result, ProvidersOf<Facts>, ActionEvents<Facts>>
				>,
				RecipeDepsOf<Facts>,
			],
		) => void;
	};

	/** @internal — builder state read through `this` so method signatures never name class parameters. */
	declare readonly _state: {
		readonly flags: Flags;
		readonly args: A;
		readonly ctx: Ctx;
		readonly tree: Tree;
		readonly ctxFlags: CtxFlags;
		readonly facts: Facts;
		readonly result: Result;
		readonly meta: Meta;
		readonly caps: Caps;
	};
	// A method signature is bivariant, so this adds no variance to the class itself.
	/** @internal */
	declare readonly _stateIn: {
		bivariant(
			state: Crust<Flags, A, Ctx, Tree, CtxFlags, Facts, Result, Meta, Name, Caps>["_state"],
		): void;
	}["bivariant"];

	/** Supported type-level seam exposing the application's inferred command types. */
	declare readonly _types: {
		flags: Flags;
		args: A;
		ctx: Ctx;
		tree: AppShape<A, Flags, Tree, Result, Facts>["children"];
		shape: AppShape<A, Flags, Tree, Result, Facts>;
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
	 * @param metadata - Optional root description, version, usage, examples, documentation sections, and keys packages add through `CommandExtras`.
	 */
	constructor(
		nameInput: Name &
			({} extends Meta ? {} : { readonly FIX_ROOT_META: "This root requires metadata" }),
	);
	constructor(
		nameInput: Name,
		meta: Meta &
			(
				| undefined
				| (RootCommandMeta & {
						[K in Exclude<keyof Meta, RootMetaKey>]: never;
				  })
			),
	);

	constructor(nameInput: Name, ...metadata: [meta?: RootCommandMeta | undefined]) {
		const meta: RootCommandMeta = metadata[0] ?? {};
		const name: string = nameInput;
		if (process.env.CRUST_INTERNAL_BUILD !== "1") checkCommandName(name);
		this._node = createCommandNode(name);
		if (meta.description !== undefined) this._node.meta.description = meta.description;
		if (meta.version !== undefined) this._node.meta.version = meta.version;
		if (meta.usage !== undefined) this._node.meta.usage = meta.usage;
		if (meta.examples !== undefined) this._node.meta.examples = [...meta.examples];
		if (meta.sections !== undefined) {
			this._node.meta.sections = validateCommandSections(name, meta.sections);
		}
		// Keys packages add through `CommandExtras` pass through, as `defineCommand()` passes them.
		Object.assign(this._node.meta, Object.fromEntries(extraEntries(meta, CORE_COMMAND_KEYS)));
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
		flags: F & FlagRecordErrors<F>,
	): AfterFlags<State, DefinedFlags<F>>;

	flags(record: object): unknown {
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
		return this._clone<AfterArgs<this["_state"], NewA>>({ args: combined });
	}

	/**
	 * Declare Contexts this command consumes without supplying their values.
	 * Factory references are retained while setup stays lazy. An Extension, or
	 * Extension factory, stands for the Contexts that Extension provides. `ctx` gains these
	 * Contexts only: to read one their setup uses, name it too. The command,
	 * and its inline `.command()` children added afterwards, parse the flags these
	 * Contexts own, and those of the Contexts their setup uses, transitively. A same-name provider of
	 * another factory must own exactly the declared flags, or preparing the app throws `DEFINITION`.
	 */
	use<const Us extends readonly [UseSource, ...UseSource[]] = never>(
		...sources: Us &
			DeclaredDependencyValuesBrand<UsedContexts<Us>, ProvidersOf<Facts>> &
			(Caps extends "recipe"
				? {}
				: {
						readonly FIX_USE_ON_APP: "An app supplies a Context with .provide(context()); .use() declares the Contexts a command reads";
					})
	): AfterUse<Flags, A, Ctx, Tree, CtxFlags, Facts, Result, Us, Meta>;

	use<const Us extends readonly [UseSource, ...UseSource[]]>(
		...sources: Us
	): AfterUse<Flags, A, Ctx, Tree, CtxFlags, Facts, Result, Us, Meta> {
		const demands: (AnyContextInstance | AnyContextFactory)[] = [];
		const extensions: ExtensionId[] = [];
		for (const source of sources) {
			if ("contextName" in source) {
				demands.push(definingOf(source));
				continue;
			}
			// A factory's provided Contexts are known only per call: the extended Extension's, which
			// its providers tag on this node when the app materializes the command (none otherwise).
			if (typeof source === "function") {
				extensions.push(source.id);
				for (const { instance, extension } of this._node.contexts) {
					if (extension === source.id) demands.push(instance);
				}
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
		const cloned = this._clone<AfterUse<Flags, A, Ctx, Tree, CtxFlags, Facts, Result, Us, Meta>>({
			...cloneFlagRegistry(this._node),
			demands: [...this._node.demands, ...demands],
			usedExtensions: [...this._node.usedExtensions, ...extensions],
		});
		installContextFlags(cloned._node, demandedFactories(demands));
		return cloned;
	}

	/**
	 * Attach Contexts — named command dependencies — to this command.
	 *
	 * Contexts are inherited by descendant commands and constructed lazily when
	 * their `ctx` property is accessed. Dependency order within one call does not
	 * affect construction. Disposable values are released in
	 * reverse construction order after post-run hooks.
	 *
	 * Context-owned flags are parsed by this command, by inline `.command()` children
	 * added afterwards, and by reusable commands that declare the Context with `.use()`.
	 * A Context-owned flag that collides with a flag of this command throws `DEFINITION`
	 * when the CLI runs from source and in `crust build`.
	 *
	 * Context `sections` document only this command, never descendants. Preparation throws
	 * `DEFINITION` when one repeats a section title already on this command.
	 */
	provide<const Cs extends readonly AnyContextInstance[] = never>(
		...instances: Cs &
			KnownContextInstances<Cs> &
			ValidateContextNames<Caps extends "recipe" ? ProvidersOf<Facts> : Ctx, Cs> &
			ValidateContextDeps<Ctx, Cs> &
			DeclaredDependencyValuesBrand<
				Facts["demands"] & RecipeDepsOf<Facts> & ActionDepsOf<Facts>,
				ContextsOutput<NoInfer<Cs>>
			>
	): AfterProvide<Flags, A, Ctx, Tree, CtxFlags, Facts, Result, Cs, Meta, Caps>;

	provide<const Cs extends readonly AnyContextInstance[]>(
		...inputs: Cs
	): AfterProvide<Flags, A, Ctx, Tree, CtxFlags, Facts, Result, Cs, Meta, Caps> {
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
			AfterProvide<Flags, A, Ctx, Tree, CtxFlags, Facts, Result, Cs, Meta, Caps>
		>({
			...cloneFlagRegistry(this._node),
			contexts: [...this._node.contexts, ...instances.map((instance) => ({ instance }))],
			providedContexts: [...this._node.providedContexts, ...instances],
		});
		const declared = declaredContextNames([
			...this._node.inheritedDemands,
			...demandedFactories(this._node.demands),
		]);
		// Shared with this builder: copied once, on the first change.
		let flagContexts: Map<string, readonly string[]> | undefined;
		for (const instance of instances) {
			const flags = Object.keys(instance.ownedFlags);
			// Fulfilling a `.use()` demand of this command or an inline ancestor shares the flags it
			// installed; preparation checks that the provider owns exactly those.
			if (flags.length === 0 || declared.has(instance.name)) continue;
			for (const name of flags) {
				registerFlag(
					cloned._node,
					name,
					instance.ownedFlags[name]!,
					"owned",
					`Context "${instance.name}"`,
				);
			}
			flagContexts ??= new Map(this._node.flagContexts);
			flagContexts.set(instance.name, [...(flagContexts.get(instance.name) ?? []), ...flags]);
		}
		if (flagContexts) cloned._node.flagContexts = flagContexts;

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
		schema: S & OutputResultBrand<ActionReturnOf<Facts>, S>,
	): AfterOutput<Flags, A, Ctx, Tree, CtxFlags, Facts, S, Meta, Caps> {
		return this._clone<AfterOutput<Flags, A, Ctx, Tree, CtxFlags, Facts, S, Meta, Caps>>({
			outputSchema: schema,
		});
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
	action<R extends ActionReturn<Facts>>(
		action: (ctx: NoInfer<CrustCommandContext<A, Flags, Ctx>>) => R,
	): AfterAction<Flags, A, Ctx, Tree, CtxFlags, Facts, R, Meta, Caps> {
		// SAFETY: dispatch reconstructs this node's context from its own validated definitions.
		return this._clone<AfterAction<Flags, A, Ctx, Tree, CtxFlags, Facts, R, Meta, Caps>>({
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
	 * and its hooks run once, at the later position. A literal flag or command name
	 * the later registration contributes again takes its type. For a literal id
	 * certainly registered again in a later call (not through a conditional
	 * Extension or list, or an array of unknown length), the flags only the earlier registration
	 * contributed leave the types too, except in inline `.command()` children declared
	 * between the two calls, for flags of Contexts the earlier one's hooks `.use()`, and
	 * when an explicit `MetaKeys` argument (`defineExtension<"version">(id)`) widened the
	 * id to `string`; removed command paths can remain statically
	 * visible and reject with `COMMAND_NOT_FOUND`. When a registration that is not
	 * certain does replace the id, an action reads `undefined` for the earlier flags
	 * the types kept, and typed input that names them fails with `Unknown flag`.
	 * A command both registrations
	 * contribute in one call is typed as either one's result. An `.action()` bound
	 * before the later registration keeps the earlier flag types, so register
	 * Extensions before `.action()`. When two Extensions with different ids
	 * contribute the same flag and a later registration removes one of them, the
	 * flag keeps the later Extension's type in one call, whichever is left, and
	 * leaves the types when a later call retires an id's flags. An Extension with
	 * runtime-only command names makes `run()` results `unknown` for Extension
	 * commands registered up to and in that call, since it may replace their
	 * registration; app commands keep their types.
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
			[I in keyof Es]: ValidateDeclaredDeps<
				MergeProviders<Ctx, ExtensionsProvidesOutput<Es>>,
				Es
			>[I] &
				DeclaredDependencyValuesBrand<
					Facts["demands"],
					MergeProviders<Ctx, ExtensionsProvidesOutput<Es>>
				> &
				DescendantValuesBrand<Tree, ExtensionDemandValues<Es>> &
				DefinitionDescendantValuesBrand<
					ExtensionCommands<Es>,
					Facts["demands"] & ExtensionDemandValues<Es>
				> &
				ExtensionCheckAt<ValidateExtensionProvides<Es, Ctx>, I> &
				// Checked here, not in the constraint, so a missing key gets a readable brand.
				MissingRootMetaBrand<Es[I], DefinedRootMetaKeys<Meta>>;
		}
	): AfterExtend<Flags, A, Ctx, Tree, CtxFlags, Facts, Result, Es, Meta, Caps>;

	extend<const Es extends readonly Extension<any, any, any, any, DefinedRootMetaKeys<Meta>>[]>(
		...inputs: Es
	): AfterExtend<Flags, A, Ctx, Tree, CtxFlags, Facts, Result, Es, Meta, Caps> {
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
		return this._clone<AfterExtend<Flags, A, Ctx, Tree, CtxFlags, Facts, Result, Es, Meta, Caps>>({
			extensions: activeExtensions,
			extensionPositions,
		});
	}

	/**
	 * Register inert reusable command definitions, each
	 * under its own carried name (use `.as(name)` to rename).
	 *
	 * Sibling names and aliases are checked immediately. Recipes materialize
	 * on first use, when inherited-flag collisions and Context demands are
	 * also checked. Use `await app.snapshot()` to validate the full tree
	 * without running Command Actions. Like every definition check, these run
	 * from source and in `crust build`, not in built artifacts.
	 */
	add<
		const Ds extends readonly CommandDefinition<any, any, any, any>[] = never,
		State extends BuilderState = ExplicitTypeArgumentsError,
	>(
		this: StateReceiver<State>,
		...definitions: Ds &
			ValidateDeclaredDeps<State["ctx"], Ds, KnownDepsAt<State>> &
			DefinitionDescendantValuesBrand<Ds, State["facts"]["demands"]>
	): AfterAdd<State, Ds>;

	add<const Ds extends readonly CommandDefinition<any, any, any, any>[]>(
		...definitions: Ds
	): unknown {
		return this._addDefinitions<AfterAdd<this["_state"], Ds>>(definitions);
	}

	/**
	 * Define a subcommand inline, on the root or inside another command's recipe.
	 *
	 * The recipe builder is seeded with the Contexts and Context-owned flags
	 * accumulated on this builder so far — the call site. In a recipe, those are
	 * its `.use()` and `.provide()` Contexts. Contexts provided after `.command()`
	 * are not visible to it, matching the positional runtime semantics of
	 * `.provide()`. Unlike `.add(defineCommand(name, recipe))`, the command parses
	 * those Contexts' flags without `.use()`, because its `ctx` exposes them, and its
	 * action's `flags` type includes them.
	 *
	 * Static metadata (description, aliases, hidden, usage, examples, sections) belongs in
	 * `config`, as with `defineCommand(name, config, recipe)`.
	 * Extract to `defineCommand` when a command needs its own file or reuse.
	 */
	command<
		const N extends string,
		B extends AnyCommandDefinitionBuilder,
		State extends BuilderState = ExplicitTypeArgumentsError,
	>(
		this: StateReceiver<State>,
		name: N,
		recipe: InlineCommandRecipe<State, N, B>,
	): AfterAdd<
		State,
		readonly [CommandDefinition<N, readonly [], ShapeOfBuilder<B>, DepsOfBuilder<B>>],
		State["ctxFlags"]
	>;
	command<
		const N extends string,
		const C extends CommandConfig,
		B extends AnyCommandDefinitionBuilder,
		State extends BuilderState = ExplicitTypeArgumentsError,
	>(
		this: StateReceiver<State>,
		name: N,
		config: C & LocalCommandConfigBrand<C>,
		recipe: InlineCommandRecipe<State, N, B>,
	): AfterAdd<
		State,
		readonly [CommandDefinition<N, AliasesOf<C>, ShapeOfBuilder<B>, DepsOfBuilder<B>>],
		State["ctxFlags"]
	>;

	command(
		name: string,
		configOrRecipe: CommandConfig | CommandRecipe,
		maybeRecipe?: CommandRecipe,
	): unknown {
		// SAFETY: the seeded recipe generics restate runtime facts — materialization
		// seeds the child node from this node's contexts and owned flags.
		const define = defineCommand as unknown as (
			name: string,
			configOrRecipe: CommandConfig | CommandRecipe,
			recipe?: CommandRecipe,
		) => CommandDefinition;
		const definition = define(name, configOrRecipe, maybeRecipe);
		const internal = Object.freeze({
			...definition[commandDefinitionInternal],
			inline: true as const,
		});
		return this._addDefinitions([{ ...definition, [commandDefinitionInternal]: internal }]);
	}

	/**
	 * List the commands or the flags a block registers under one heading in help and the other
	 * documentation surfaces. The block's first call decides: `g.add()` and `g.command()` make a
	 * command group, `g.flags()` a flag group, and the other kind is then a compile error. Blocks
	 * do not nest. A group changes documentation only, never routing, parsing, or types; the
	 * parent decides it, so one definition can sit in different groups under different parents.
	 *
	 * @example
	 * ```ts
	 * new Crust("app")
	 *   .group("Core commands", (g) => g.add(deploy).command("logs", (c) => c.action(() => {})))
	 *   .group("Resources", (g) => g.flags({ memory: { type: "string", valueName: "bytes" } }));
	 * ```
	 */
	group<
		R extends CommandGroupBuilder<BuilderState> | FlagGroupBuilder<BuilderState>,
		State extends BuilderState = ExplicitTypeArgumentsError,
	>(
		this: StateReceiver<State>,
		title: string,
		block: (group: GroupBuilder<State>) => R,
	): GroupResult<R["_state"]>;

	group(title: string, block: (group: any) => object): unknown {
		// SAFETY: the types let a block return only a handle groupHandle created.
		const { builder, group } = groupHandles.get(block(groupHandle(this, { title, commands: [] })))!;
		const names = "commands" in group ? group.commands : group.flags;
		if (names.length === 0) return builder;
		return builder._clone({ groups: Object.freeze([...(builder._node.groups ?? []), group]) });
	}

	private _addDefinitions<Out>(definitions: readonly CommandDefinition[]): Out {
		// Recipes run later, on first use (see ChildEntry), each against this builder as its
		// parent, never an earlier sibling; builders are immutable, so capturing the node is safe.
		const parent = this._node;
		let head = parent.addedChildren;
		for (const definition of definitions) {
			let childNode: CommandNode | undefined;
			head = {
				name: definition.name,
				meta: { name: definition.name, ...definition[commandDefinitionInternal].meta },
				resolve: () => (childNode ??= materializeCommandDefinition(definition, parent)),
				next: head,
				definition,
				parent,
			};
		}
		if (process.env.CRUST_INTERNAL_BUILD !== "1") checkSiblingNames(parent, head, definitions);
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
	 * @param input - Structured argument and flag values
	 * @param options - Optional `stdout(text)` / `stderr(text)` callbacks (also
	 *                  exposed to Command Actions and Extensions), an `onEvent(event)`
	 *                  callback for an async generator action's events, and an
	 *                  `AbortSignal` that cancels the invocation
	 */
	// `Path` is only constrained to strings, and the parameter is not intersected with `Path`:
	// either would erase the partial literal editors use for completions (see `KnownCommandPath`).
	run<const Path extends readonly string[]>(
		this: RunWithoutInputThis<
			CommandShapeAt<AppShape<A, Flags, Tree, Result, Facts>, Path>,
			{ readonly _types: { readonly caps: "app" } }
		>,
		path: KnownCommandPath<Path, Tree>,
	): Promise<ShapeRunOutcome<CommandShapeAt<AppShape<A, Flags, Tree, Result, Facts>, Path>>>;
	run<
		const Path extends readonly string[],
		// Resolving the shape once here keeps contextual typing of a literal `input` from
		// re-walking the whole tree on every pass.
		S extends CommandShapeAt<AppShape<A, Flags, Tree, Result, Facts>, Path> = CommandShapeAt<
			AppShape<A, Flags, Tree, Result, Facts>,
			Path
		>,
		const Input extends RunInput<S> | OmittableRunInput<S> = RunInput<S>,
	>(
		// The reverse check also rejects explicit subtypes that narrow results or add flags.
		this: [CommandShapeAt<AppShape<A, Flags, Tree, Result, Facts>, Path>] extends [S]
			? { readonly _types: { readonly caps: "app" } }
			: never,
		path: KnownCommandPath<Path, Tree>,
		input: CheckedRunInput<S, Input> | OmittableRunInput<S>,
		options?: InvocationOptions<ShapeEvent<S>>,
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
				CommandShapeAt<AppShape<A, Flags, Tree, Result, Facts>, NoInfer<Path>>,
				Input
			>,
		]
			? readonly [
					options?: InvocationOptions<
						ShapeEvent<CommandShapeAt<AppShape<A, Flags, Tree, Result, Facts>, NoInfer<Path>>>
					>,
				]
			: readonly [invalidInput: never]
	): Promise<ShapeRunOutcome<CommandShapeAt<AppShape<A, Flags, Tree, Result, Facts>, Path>>>;
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
	): CommandHandle<CommandShapeAt<AppShape<A, Flags, Tree, Result, Facts>, Path>>;

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
	 * chosen Renderer's `error` or Core's default rendering), and resolves to the exit code, which
	 * it also assigns to `process.exitCode` once at the end: `0`, or the action's `exitCode(n)`;
	 * `1`, or a thrown value's non-zero integer `exitCode`; `2` for a `PARSE`, `VALIDATION`, or
	 * `COMMAND_NOT_FOUND` error; `130` for an `AbortError` cancellation, `143` when `SIGTERM`
	 * cancelled it, `141` when stdout's reader went away (see {@link ExecuteOptions}). After a
	 * `SIGINT` or `SIGTERM` cancelled the run, the exit code is `130` / `143` whatever the action
	 * did, and without injected `io` the process dies by that signal once its event loop drains
	 * (on `beforeExit`): code after `execute()` still runs, and calling `process.exit()` or
	 * changing `process.exitCode` keeps that exit instead.
	 *
	 * @param options - Optional overrides: custom `argv` and captured `io` for
	 *                   in-process testing of exit codes and rendered failures,
	 *                   an `onEvent(event)` callback for an async generator action's
	 *                   events, and a caller `signal` that cancels the invocation
	 * @returns The terminal exit code
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
