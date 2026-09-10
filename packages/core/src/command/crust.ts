import type { JsonCompatible, JsonValue } from "@crustjs/utils/json";

import {
	validateContextAvailability,
	contextInstanceData,
	contextFactoryData,
} from "../api/context.ts";
import type {
	AnyContextFactory,
	ContextBag,
	ContextDependencies,
	AnyContextInstance,
	ContextValue,
	ContextMap,
	ContextsOutput,
	ContextsOwnedFlags,
} from "../api/context.ts";
import type {
	ExtensionData,
	AnyExtension,
	Extension,
	ExtensionsProvidesOutput,
	RootMetaKey,
} from "../api/extension.ts";
import { extensionData } from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import type { ExtensionId } from "../identity.ts";
import type { RunInputPayload } from "../parsing/parser.ts";
import { normalizeArg } from "../parsing/spellings.ts";
import type {
	ArgsDef,
	CommandMeta,
	RuntimeCommandSectionInput,
	FlagsDef,
	InferArgs,
	InferFlags,
	InputArgs,
	InputFlags,
	InvocationIO,
	MergeFlags,
	NamedFlagDef,
} from "../types.ts";
import type { LocalAppendArgsChecks, AttachedArgs } from "../validation/args.brands.ts";
import type {
	AttachedCommandSpellings,
	CommandCollisionBrand,
} from "../validation/commands.brands.ts";
import type {
	AliasesOf,
	CommandDefinitionSpellings,
	CommandNameBrand,
	ExtensionCommandDefs,
	ExtensionsCommandSpellings,
	ValidateCommandConfig,
	LocalCommandConfigBrand,
	LocalSectionsBrand,
	ValidateCommandDefinitions,
	ValidateExtensionCommands,
} from "../validation/commands.brands.ts";
import type { KnownContextInstances } from "../validation/contexts.brands.ts";
import type {
	MissingDeclaredDependencyBrand,
	DeclaredDependencyValuesBrand,
	ValidateContextDeps,
	ValidateContextNames,
	ValidateDeclaredDeps,
	ValidateExtensionProvides,
} from "../validation/contexts.brands.ts";
import type {
	ExtensionsSpellings,
	ProvideChecks,
	DefinitionTreeSpellings,
	ShapeFlagCollisionBrand,
	ValidateDefinitionFlags,
	ValidateExtensionFlags,
	ValidateLocalFlagDefs,
	AttachedFlags,
	AttachedSpellings,
	LocalSpellingsOf,
} from "../validation/flags.brands.ts";
import type { IsClosedName } from "../validation/shared.ts";
import type {
	IsStaticTuple,
	IsUnion,
	MergeContext,
	MergeProviders,
	UnionToIntersection,
} from "../validation/shared.ts";
import {
	cloneCommandNode,
	checkExtensionFlagRelations,
	installExtensionContexts,
	validateCommandSections,
} from "./extensions-install.ts";
import { executeInvocation, prepareInvocation, runInvocation } from "./invocation.ts";
import { type CommandAction, type CommandNode, createCommandNode, registerFlag } from "./node.ts";
import { snapshotCommand } from "./snapshot.ts";
import type { CommandSnapshot } from "./snapshot.ts";

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

declare const commandProviders: unique symbol;

/** Compile-time description of one command's programmatic input and action result. */
export interface CommandShape<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
	Children extends object = {},
	Result = unknown,
	Providers extends Record<string, ContextValue> = Record<string, ContextValue>,
> {
	readonly [commandProviders]?: Providers;
	readonly args: A;
	readonly flags: F;
	readonly children: Children;
	readonly result: Result;
}

/** Captured invocation after lifecycle cleanup. */
export type RunOutcome<Result> = { readonly stdout: string; readonly stderr: string } & (
	| { readonly status: "completed"; readonly result: Result }
	| { readonly status: "finished"; readonly by: ExtensionId }
	| { readonly status: "failed"; readonly error: unknown }
);

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

type KnownCommandPath<Path extends readonly string[], Tree> = string extends keyof Tree
	? Path
	: IsStaticTuple<Path> extends true
		? string extends Path[number]
			? never
			: Path
		: never;

/** Resolve the command shape at a typed path. */
export type CommandShapeAt<
	Shape extends CommandShape,
	Path extends readonly string[],
> = Path extends readonly [infer Head, ...infer Tail extends readonly string[]]
	? Head extends keyof Shape["children"]
		? Shape["children"][Head] extends infer Child extends CommandShape
			? CommandShapeAt<Child, Tail>
			: never
		: // A non-literal segment (e.g. a hand-annotated `[string, ...string[]]`
			// tuple) selects a statically unknowable command, not no command.
			string extends Head
			? CommandShape
			: never
	: Path extends readonly []
		? Shape
		: // A tail widened past the CommandPath depth cap selects a statically
			// unknowable command, so the shape (and its result) widens too.
			CommandShape;

type RunSection<Name extends string, Values> = keyof Values extends never
	? { [K in Name]?: never }
	: {} extends Values
		? { [K in Name]?: Values }
		: { [K in Name]: Values };

/** Structured values bound directly against the selected command's definitions; no argv is produced. */
export type RunInput<Shape extends CommandShape> = RunSection<
	"args",
	ArgsDef extends Shape["args"] ? NonNullable<RunInputPayload["args"]> : InputArgs<Shape["args"]>
> &
	RunSection<
		"flags",
		FlagsDef extends Shape["flags"]
			? NonNullable<RunInputPayload["flags"]>
			: InputFlags<Shape["flags"]>
	> & {
		readonly raw?: readonly string[];
	};

// Check each prefix separately so JSON compatibility cannot recombine positional branches.
type CompatibleRunValue<Expected, Actual> = Actual extends Expected
	? Actual extends object
		? Expected extends unknown
			? Actual extends Expected
				? Actual & { [K in Exclude<keyof Actual, keyof Expected>]: never } & {
						[K in keyof Actual & keyof Expected]: CompatibleRunValue<Expected[K], Actual[K]>;
					}
				: never
			: never
		: Actual
	: JsonValue extends Expected
		? Actual extends JsonCompatible<Actual>
			? Actual
			: never
		: Expected extends unknown
			? CompatibleRunBranch<Expected, Actual>
			: never;

type CompatibleRunBranch<Expected, Actual> = Actual extends Expected
	? Actual
	: Expected extends readonly (infer Item)[]
		? JsonValue extends Item
			? Actual extends (
					Expected extends readonly [unknown, ...unknown[]]
						? readonly [unknown, ...unknown[]]
						: readonly unknown[]
				)
				? Actual extends JsonCompatible<Actual>
					? Actual
					: never
				: never
			: never
		: Actual extends object
			? string extends keyof Expected
				? {
						[K in keyof Actual]: CompatibleRunValue<
							Exclude<Expected[K & keyof Expected], undefined>,
							Actual[K]
						>;
					}
				: {
						[K in keyof Expected]: K extends keyof Actual
							? CompatibleRunValue<Exclude<Expected[K], undefined>, Actual[K]>
							: Expected[K];
					} & { [K in Exclude<keyof Actual, keyof Expected>]: never }
			: never;

type CompatibleRunInput<Shape extends CommandShape, Input> = CompatibleRunValue<
	RunInput<Shape>,
	Input
>;

export type RunInputArguments<Shape extends CommandShape> =
	{} extends RunInput<Shape>
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
export interface CommandConfig extends Omit<CommandMeta, "name" | "sections" | "version"> {
	/** Plain-text sections rendered after built-in command documentation. */
	readonly sections?: readonly RuntimeCommandSectionInput[];
}

/** Static metadata accepted by the root command constructor. */
export type RootCommandMeta = Pick<CommandMeta, "description" | "version" | "usage"> & {
	/** Plain-text sections rendered after built-in command documentation. */
	readonly sections?: readonly RuntimeCommandSectionInput[];
};

type AnyCommandDefinitionBuilder = CommandDefinitionBuilder<
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any
>;

// Sealed recipes build local types; .add checks the completed shape against
// call-site Context flags. Checked attachment carries destination validation into the recipe.
type CommandRecipe<Builder extends AnyCommandDefinitionBuilder = AnyCommandDefinitionBuilder> = (
	command: CommandDefinitionBuilder<{}, [], {}, never, never>,
) => Builder;

const commandDefinitionInternal: unique symbol = Symbol.for("crust.commandDefinition");

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
	as<const N extends string>(
		name: N & CommandNameBrand<N> & ValidateCommandConfig<N, { aliases: Aliases }>,
	): CommandDefinition<N, Aliases, Shape, Deps>;
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
	/** @internal — phantom carrying configured alias literals for add-time checks */
	readonly _aliases?: Aliases;
	/** @internal — phantom carrying args, flags, and descendants for typed invocation */
	readonly _shape?: Shape;
	/** @internal — phantom carrying the declared dependency closure */
	readonly _deps?: Deps;
}

/** @internal Private recipe metadata survives public phantom-field overrides. */
export type CommandDefinitionData<D> = D extends {
	readonly [commandDefinitionInternal]: infer Data;
}
	? Data
	: D;

function materializeCommandDefinition(
	definition: CommandDefinition,
	parent: CommandNode,
	extensionName?: string,
): CommandNode {
	const internal = definition[commandDefinitionInternal];
	const name = definition.name;
	if (name !== internal.name) resolveCommandName(name, internal.meta.aliases);
	const owner = extensionName
		? `Extension "${extensionName}" command "${name}"`
		: `Command "${name}"`;
	const definitionDetails = (reason: string) => ({
		subject: extensionName ? ("extension" as const) : ("command" as const),
		name: extensionName ?? name,
		reason,
	});

	const child = new Crust(name);
	for (const [flagName, def] of Object.entries(parent.ownedFlags)) {
		registerFlag(child._node, flagName, def, "owned");
	}
	child._node.contexts = parent.contexts.map((context) => ({ ...context }));

	// SAFETY: Keep this cast aligned with the recipe-builder surface to avoid silent drift.
	// A compile-time check is structurally impossible: branded generic method parameters compare
	// recursively, while Crust transitions return Crust and recipe-builder transitions return the
	// restricted builder type. Runtime validation below still requires Crust return identity.
	/* oxlint-disable anti-slop/no-chained-type-assertions -- Crust's declared type omits the builder-only `.use()` (implemented on its prototype), so the cast must pass through unknown. */
	const configured = internal.recipe(child as unknown as AnyCommandDefinitionBuilder);
	/* oxlint-enable anti-slop/no-chained-type-assertions */
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

	const validate = (node: CommandNode): void => {
		validateContextAvailability(
			node.contexts.map(({ instance }) => instance),
			[
				...node.demands,
				...node.contexts.slice(parent.contexts.length).map(({ instance }) => instance),
			],
		);
		for (const descendant of Object.values(node.subCommands)) validate(descendant);
	};
	validate(childNode);

	childNode.meta = { name, ...internal.meta };
	return childNode;
}

// Unknown previous positional state remains open after appends.
type AppendedArgs<A extends ArgsDef, NewA extends ArgsDef> = readonly [...A, ...AttachedArgs<NewA>];

/**
 * Configure-only command builder.
 *
 * Generic parameters mirror {@link Crust}; `Sp` caches the flag spellings
 * accumulated by `.flags()` and `.provide()` for compile-time collision checks.
 */
declare const commandBuilderTypes: unique symbol;

export interface CommandDefinitionBuilder<
	Flags extends FlagsDef = {},
	A extends ArgsDef = ArgsDef,
	out Ctx extends ContextMap = {},
	Sibs extends string = never,
	Sp extends string = LocalSpellingsOf<Flags>,
	Tree extends object = {},
	out CtxFlags extends FlagsDef = {},
	Result = void,
	Deps extends ContextMap = {},
	Providers extends Record<string, ContextValue> = {},
> {
	/** @internal — recipe state, without structural inference through builder methods. */
	readonly [commandBuilderTypes]: {
		readonly shape: CommandShape<A, Flags, Tree, Result, Providers>;
		readonly deps: Deps;
		readonly proof?: (
			state: [CommandInputShape<CommandShape<A, Flags, Tree, Result, Providers>>, Deps],
		) => void;
	};
	readonly _shape?: CommandShape<A, Flags, Tree, Result, Providers>;
	/** @internal — declared dependency closure. */
	readonly _deps?: Deps;
	flags<const Defs extends readonly NamedFlagDef[]>(
		...defs: ValidateLocalFlagDefs<Defs, Sp>
	): CommandDefinitionBuilder<
		MergeFlags<Flags, AttachedFlags<Defs>>,
		A,
		Ctx,
		Sibs,
		Sp | AttachedSpellings<Defs>,
		Tree,
		CtxFlags,
		Result,
		Deps,
		Providers
	>;

	args<const NewA extends ArgsDef>(
		...defs: NewA & LocalAppendArgsChecks<A, NewA>
	): CommandDefinitionBuilder<
		Flags,
		AppendedArgs<A, NewA>,
		Ctx,
		Sibs,
		Sp,
		Tree,
		CtxFlags,
		Result,
		Deps,
		Providers
	>;

	/**
	 * Declare Contexts this command consumes without supplying their values.
	 *
	 * `.use(logger, tracer)` is demand (factories); `.provide(logger())` is supply
	 * (an instance). Each factory accumulates its value and transitive dependency
	 * closure into the action's typed `ctx`, and into the sealed definition's
	 * declared dependencies checked at `.provide()`/`.add()`/`.extend()`
	 * composition sites.
	 *
	 * A statically known, nonempty tuple declares the typed dependency closure.
	 * Factory references are retained for attachment; setups stay lazy.
	 */
	use<const Fs extends readonly [AnyContextFactory, ...AnyContextFactory[]]>(
		...factories: Fs & DeclaredDependencyValuesBrand<ContextDependencies<Fs>, Providers>
	): CommandDefinitionBuilder<
		Flags,
		A,
		MergeContext<Ctx, ContextDependencies<Fs>>,
		Sibs,
		Sp,
		Tree,
		CtxFlags,
		Result,
		MergeContext<Deps, ContextDependencies<Fs>>,
		Providers
	>;

	provide<const Cs extends readonly AnyContextInstance[]>(
		...instances: KnownContextInstances<Cs> &
			ProvideChecks<Sp, Cs> &
			ValidateContextNames<Providers, Cs> &
			ValidateContextDeps<Ctx, Cs> &
			DeclaredDependencyValuesBrand<Deps, ContextsOutput<Cs>>
	): CommandDefinitionBuilder<
		MergeFlags<Flags, ContextsOwnedFlags<Cs>>,
		A,
		MergeProviders<Ctx, ContextsOutput<Cs>>,
		Sibs,
		Sp | LocalSpellingsOf<ContextsOwnedFlags<Cs>>,
		Tree,
		MergeFlags<CtxFlags, ContextsOwnedFlags<Cs>>,
		Result,
		Deps,
		MergeProviders<Providers, ContextsOutput<Cs>>
	>;

	add<const Ds extends readonly CommandDefinition<any, any, any, any>[]>(
		...definitions: Ds &
			ValidateCommandDefinitions<Ds, Sibs> &
			ValidateDeclaredDeps<Ctx, Ds> &
			ValidateDefinitionFlags<Ds, LocalSpellingsOf<CtxFlags>>
	): CommandDefinitionBuilder<
		Flags,
		A,
		Ctx,
		Sibs | AttachedCommandSpellings<Ds>,
		Sp,
		Tree & DefinitionsTree<Ds, CtxFlags>,
		CtxFlags,
		Result,
		Deps,
		Providers
	>;

	action<R>(
		action: (ctx: NoInfer<CrustCommandContext<A, Flags, Ctx>>) => R,
	): CommandDefinitionBuilder<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, Awaited<R>, Deps, Providers>;
}

type ShapeOfBuilder<B> = [B] extends [never]
	? CommandShape<[], {}, {}, never, {}>
	: B extends { readonly [commandBuilderTypes]: { shape: infer S extends CommandShape } }
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
		B extends { readonly [commandBuilderTypes]: { deps: infer Deps extends ContextMap } }
			? Deps
			: {}
	> extends infer Merged extends ContextMap
		? Merged
		: {};

// Match only established spellings; open siblings must not replace a known shape.
type DefinitionShapeForSpelling<D, Spelling extends string> =
	CommandDefinitionData<D> extends { readonly _shape?: infer Shape extends CommandShape }
		? Spelling extends CommandDefinitionSpellings<D>
			? Shape
			: never
		: never;

// Added definitions inherit the parent path's Context-owned flags at runtime
// (materialization seeds the child with `parent.ownedFlags`), so the typed shape
// merges them too — deeply, because nested definitions materialize against the
// same inherited flag namespace. Local parent flags never inherit and stay out.
type ShapeWithInheritedFlags<S, CF extends FlagsDef> = keyof CF extends never
	? S
	: S extends CommandShape<infer SA, infer SF, infer SC, infer SR, infer P>
		? CommandShape<
				SA,
				MergeFlags<CF, SF>,
				{ [K in keyof SC]: ShapeWithInheritedFlags<SC[K], CF> },
				SR,
				P
			>
		: never;

type DefinitionsTree<
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

type KnownDefinitionTree<Ds extends readonly unknown[], CF extends FlagsDef> =
	IsUnion<Ds> extends true
		? {}
		: Ds extends readonly [infer H, ...infer T]
			? (IsUnion<H> extends true
					? {}
					: {
							[K in CommandDefinitionSpellings<H>]: ShapeWithInheritedFlags<
								DefinitionShapeForSpelling<H, K>,
								CF
							>;
						}) &
					KnownDefinitionTree<T, CF>
			: {};

type ExtensionCheckAt<Checks, I> = I extends keyof Checks ? Checks[I] : never;

type ExtensionCommands<Es extends readonly AnyExtension[]> = Es extends readonly [
	infer H,
	...infer T extends readonly AnyExtension[],
]
	? readonly [...ExtensionCommandDefs<H>, ...ExtensionCommands<T>]
	: ExtensionCommandDefs<Es[number]>[number] extends never
		? readonly []
		: readonly CommandDefinition<any, any, any, any>[];

type ExtensionProviders<E> = [E] extends [never]
	? []
	: ExtensionData<E> extends { provides?: infer P extends readonly AnyContextInstance[] }
		? P
		: [];
type ExtensionOwnDefs<E> = [E] extends [never]
	? []
	: ExtensionData<E> extends { _flagDefs?: infer F extends readonly NamedFlagDef[] }
		? F
		: [];

type ExtensionFlags<Es extends readonly AnyExtension[]> = Es extends readonly [
	infer H,
	...infer T extends readonly AnyExtension[],
]
	? AttachedFlags<ExtensionOwnDefs<H>> &
			ContextsOwnedFlags<ExtensionProviders<H>> &
			ExtensionFlags<T>
	: ExtensionOwnDefs<Es[number]>[number] extends never
		? keyof ContextsOwnedFlags<ExtensionProviders<Es[number]>> extends never
			? {}
			: FlagsDef
		: FlagsDef;

type RecursiveFlagsOf<E> = ExtensionOwnDefs<E>[number] extends never
	? {}
	: true extends {
				[K in keyof ExtensionOwnDefs<E>]: ExtensionOwnDefs<E>[K] extends infer D extends
					NamedFlagDef
					? D extends { readonly recursive: false }
						? false
						: IsClosedName<D["name"]> extends false
							? true
							: IsUnion<D["name"]> extends true
								? true
								: D extends { recursive: infer R }
									? boolean extends R
										? true
										: false
									: false
					: false;
		  }[number]
		? FlagsDef
		: IsStaticTuple<ExtensionOwnDefs<E>> extends true
			? {
					[
						D in ExtensionOwnDefs<E>[number] as D extends { readonly recursive: infer R }
							? [R] extends [false]
								? never
								: D["name"]
							: D["name"]
					]: Omit<D, "name">;
				}
			: FlagsDef;

type RecursiveExtensionFlags<Es extends readonly AnyExtension[]> = Es extends readonly [
	infer H,
	...infer T extends readonly AnyExtension[],
]
	? RecursiveFlagsOf<H> & ContextsOwnedFlags<ExtensionProviders<H>> & RecursiveExtensionFlags<T>
	: ExtensionFlags<Es>;

type TreeWithInheritedFlags<Tree, F extends FlagsDef> = {
	[K in keyof Tree]: ShapeWithInheritedFlags<Tree[K], F>;
};

// The tree does not retain canonical/alias insertion provenance. Colliding alias keys stay open.
type ReplacementTree<Tree, D extends CommandDefinition<any, any, any, any>, CF extends FlagsDef> =
	CommandDefinitionData<D> extends { readonly _aliases?: infer Aliases extends readonly string[] }
		? IsClosedName<Aliases[number]> extends false
			? Record<string, CommandShape> & {
					[K in D["name"]]: ShapeWithInheritedFlags<DefinitionShapeForSpelling<D, K>, CF>;
				}
			: Omit<Tree, CommandDefinitionSpellings<D>> & {
					[K in CommandDefinitionSpellings<D>]: K extends D["name"]
						? ShapeWithInheritedFlags<DefinitionShapeForSpelling<D, K>, CF>
						: K extends keyof Tree
							? CommandShape
							: ShapeWithInheritedFlags<DefinitionShapeForSpelling<D, K>, CF>;
				}
		: Record<string, CommandShape>;

// Extension commands replace canonical children; an open contribution can replace any child.
type ReplacedTree<
	Tree,
	Commands extends readonly unknown[],
	CF extends FlagsDef,
> = Commands extends readonly [
	infer H extends CommandDefinition<any, any, any, any>,
	...infer T extends readonly unknown[],
]
	? ReplacedTree<
			IsClosedName<H["name"]> extends false
				? Record<string, CommandShape>
				: true extends IsUnion<H> | IsUnion<H["name"]>
					? Record<string, CommandShape>
					: ReplacementTree<Tree, H, CF>,
			T,
			CF
		>
	: number extends Commands["length"]
		? Record<string, CommandShape>
		: Tree;

type ReplacedExtensionTree<
	Tree,
	Es extends readonly AnyExtension[],
	CF extends FlagsDef,
> = Es extends readonly [infer H extends AnyExtension, ...infer T extends readonly AnyExtension[]]
	? ReplacedExtensionTree<ReplacedTree<Tree, ExtensionCommandDefs<H>, CF>, T, CF>
	: ExtensionCommandDefs<Es[number]>[number] extends never
		? Tree
		: Record<string, CommandShape>;

type ExtendedTree<
	Tree,
	Es extends readonly AnyExtension[],
	RecursiveFlags extends FlagsDef,
	InheritedFlags extends FlagsDef,
> = keyof RecursiveFlags extends never
	? ReplacedExtensionTree<Tree, Es, InheritedFlags>
	: TreeWithInheritedFlags<ReplacedExtensionTree<Tree, Es, InheritedFlags>, RecursiveFlags>;

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

function isCommandRecipe(value: CommandConfig | CommandRecipe): value is CommandRecipe {
	return typeof value === "function";
}

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
	name: Name & CommandNameBrand<Name>,
	recipe: CommandRecipe<Builder>,
): CommandDefinition<Name, readonly [], ShapeOfBuilder<Builder>, DepsOfBuilder<Builder>>;
export function defineCommand<
	const Name extends string,
	const C extends CommandConfig,
	Builder extends AnyCommandDefinitionBuilder,
>(
	name: Name & CommandNameBrand<Name>,
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
	// Authoring overloads require a recipe in both call forms.
	const recipe = hasConfig ? maybeRecipe! : configOrRecipe;
	const name = resolveCommandName(nameInput, config.aliases);

	for (const alias of config.aliases ?? []) {
		if (alias === "" || /[ \t\n\r\v\f]/.test(alias) || alias.startsWith("-")) {
			throw new CrustError("DEFINITION", `Command "${name}" has an invalid alias "${alias}"`);
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
				named(resolveCommandName(newName, meta.aliases)),
			[commandDefinitionInternal]: Object.freeze({ ...internal, name: defName }),
		});
	};
	return named(name);
}

function dedupeExtensions(extensions: readonly Extension[]): Extension[] {
	// ponytail: O(n^2) scan, fine for handfuls of extensions.
	return extensions.filter((e, i) => extensions.findLastIndex((x) => x.id === e.id) === i);
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
 * - `CtxFlags` — Context-owned flags accumulated by `.provide()` and recursive
 *   Extension flags accumulated by `.extend()`, inherited by the shapes of
 *   definitions added afterwards
 * - `Result` — awaited return type of this command's action
 * - `Meta` — authored root metadata available to Extension requirements
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
type CollisionSpellings<
	Extensions extends string = never,
	Tree extends string = never,
	Demands extends ContextMap = {},
	Pending extends string = never,
> = {
	readonly pending: Pending;
	readonly demands: Demands;
	readonly extension: Extensions;
	readonly tree: Tree;
};

type AnyCollisionSpellings = CollisionSpellings<string, string, ContextMap, string>;

type AfterFlags<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Sibs extends string,
	Sp extends string,
	Tree extends object,
	CtxFlags extends FlagsDef,
	CollisionSp extends AnyCollisionSpellings,
	Result,
	Defs extends readonly NamedFlagDef[],
	Meta extends RootCommandMeta | undefined,
> = Crust<
	MergeFlags<Flags, AttachedFlags<Defs>>,
	A,
	Ctx,
	Sibs,
	Sp | AttachedSpellings<Defs>,
	Tree,
	CtxFlags,
	CollisionSp,
	Result,
	Meta
>;

type AfterArgs<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Sibs extends string,
	Sp extends string,
	Tree extends object,
	CtxFlags extends FlagsDef,
	CollisionSp extends AnyCollisionSpellings,
	Result,
	NewA extends ArgsDef,
	Meta extends RootCommandMeta | undefined,
> = Crust<Flags, AppendedArgs<A, NewA>, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Meta>;

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
> = Crust<
	MergeFlags<Flags, ContextsOwnedFlags<Cs>>,
	A,
	MergeProviders<Ctx, ContextsOutput<Cs>>,
	Sibs,
	Sp | LocalSpellingsOf<ContextsOwnedFlags<Cs>>,
	Tree,
	MergeFlags<CtxFlags, ContextsOwnedFlags<Cs>>,
	CollisionSp,
	Result,
	Meta
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
> = Crust<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Awaited<R>, Meta>;

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
> = Crust<
	MergeFlags<Flags, ExtensionFlags<Es>>,
	A,
	MergeProviders<Ctx, ExtensionsProvidesOutput<Es>>,
	Sibs | ExtensionsCommandSpellings<Es>,
	Sp | ExtensionsSpellings<Es>,
	ExtendedTree<Tree, Es, RecursiveExtensionFlags<Es>, CtxFlags>,
	MergeFlags<CtxFlags, RecursiveExtensionFlags<Es>>,
	CollisionSpellings<
		CollisionSp["extension"] | ExtensionsSpellings<Es>,
		CollisionSp["tree"] | DefinitionTreeSpellings<ExtensionCommands<Es>>,
		CollisionSp["demands"] & ExtensionDemandValues<Es>,
		CollisionSp["pending"] | DefinitionTreeSpellings<ExtensionCommands<Es>>
	>,
	Result,
	Meta
>;

type AfterAdd<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Sibs extends string,
	Sp extends string,
	Tree extends object,
	CtxFlags extends FlagsDef,
	CollisionSp extends AnyCollisionSpellings,
	Result,
	Ds extends readonly CommandDefinition<any, any, any, any>[],
	Meta extends RootCommandMeta | undefined,
> = Crust<
	Flags,
	A,
	Ctx,
	Sibs | AttachedCommandSpellings<Ds>,
	Sp,
	Tree & DefinitionsTree<Ds, CtxFlags>,
	CtxFlags,
	CollisionSpellings<
		CollisionSp["extension"],
		CollisionSp["tree"] | DefinitionTreeSpellings<Ds>,
		CollisionSp["demands"],
		CollisionSp["pending"]
	>,
	Result,
	Meta
>;

type ExtensionDemandValues<Es extends readonly AnyExtension[]> =
	UnionToIntersection<
		ExtensionData<Es[number]> extends { readonly _hookDeps?: infer H extends ContextMap }
			? H
			: Record<string, ContextValue>
	> extends infer D extends ContextMap
		? D
		: {};

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
> = DescendantValuesBrand<DefinitionsTree<Ds>, Deps>;

// Inline recipes validate demands after return-type inference, like sealed definitions.
// Descendant checks constrain the recipe itself: a return intersection can lose conditional branches.
type ValidateInlineCommandDeps<Ctx extends ContextMap, B> = MissingDeclaredDependencyBrand<
	{ readonly _deps?: DepsOfBuilder<B> },
	keyof Ctx & string
> &
	DeclaredDependencyValuesBrand<DepsOfBuilder<B>, Ctx>;

/** Broad application type for APIs that accept any fully-built Crust application. */
type ErasedCrust = Crust<any, any, any, any, any, any, any, any, any, any>;
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
> {
	declare private readonly _contextProof: (
		state: [Flags, A, Ctx, CtxFlags, CollisionSp["demands"]],
	) => void;

	/** Supported type-level seam exposing the application's inferred command types. */
	declare readonly _types: {
		flags: Flags;
		args: A;
		ctx: Ctx;
		tree: Tree;
		shape: CommandShape<A, Flags, Tree, Result>;
		readonly rootMeta: Meta;
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
		const newNode: CommandNode = {
			...cloneCommandNode({ ...this._node, subCommands: {} }),
			// Descendants are immutable builder values; sharing them avoids recursive clones.
			subCommands: { ...this._node.subCommands },
			...nodeOverrides,
		};
		cloned._node = newNode;
		cloned._ancestorOwnedFlags = this._ancestorOwnedFlags;
		/* oxlint-disable anti-slop/no-chained-type-assertions -- one runtime builder shape is re-parameterized after each matching mutation. */
		// SAFETY: every caller pairs this generic transition with the matching runtime node mutation.
		return cloned as unknown as Out;
		/* oxlint-enable anti-slop/no-chained-type-assertions */
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
		...defs: ValidateLocalFlagDefs<Defs, Sp>
	): AfterFlags<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Defs, Meta>;

	flags<const Defs extends readonly NamedFlagDef[]>(
		...defs: Defs
	): AfterFlags<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Defs, Meta> {
		const cloned = this._clone<
			AfterFlags<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Defs, Meta>
		>({});
		for (const def of defs) {
			const { name, ...rest } = def;
			// SAFETY: removing name from a NamedFlagDef leaves its discriminated FlagDef.
			registerFlag(cloned._node, name, rest, "local");
		}
		checkExtensionFlagRelations({ ...cloned._node, subCommands: {} }, this._node.extensions);
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
	args<const NewA extends ArgsDef>(
		...defs: NewA & LocalAppendArgsChecks<A, NewA>
	): AfterArgs<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, NewA, Meta>;

	args<const NewA extends ArgsDef>(
		...defs: NewA
	): AfterArgs<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, NewA, Meta> {
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

		return this._clone<
			AfterArgs<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, NewA, Meta>
		>({ args: combined });
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
	 */
	provide<const Cs extends readonly AnyContextInstance[]>(
		...instances: KnownContextInstances<Cs> &
			ProvideChecks<Sp | CollisionSp["pending"], Cs> &
			ValidateContextNames<Ctx, Cs> &
			ValidateContextDeps<Ctx, Cs> &
			DeclaredDependencyValuesBrand<CollisionSp["demands"], ContextsOutput<NoInfer<Cs>>>
	): AfterProvide<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Cs, Meta>;

	provide<const Cs extends readonly AnyContextInstance[]>(
		...inputs: Cs
	): AfterProvide<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Cs, Meta> {
		const instances = inputs.map(contextInstanceData);
		validateContextAvailability(
			[...this._node.contexts.map(({ instance }) => instance), ...instances],
			instances,
		);

		// Positional by design: providers reach only this node and children added
		// afterwards (flag scoping; see definition.test.ts). Extension `provides`
		// differ deliberately — they are application-wide and walk the whole tree.
		const cloned = this._clone<
			AfterProvide<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Cs, Meta>
		>({ contexts: [...this._node.contexts, ...instances.map((instance) => ({ instance }))] });
		for (const instance of instances) {
			for (const [name, definition] of Object.entries(instance.ownedFlags)) {
				registerFlag(cloned._node, name, definition, "owned");
			}
		}

		checkExtensionFlagRelations({ ...cloned._node, subCommands: {} }, this._node.extensions);

		return cloned;
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
	): AfterAction<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, R, Meta> {
		// SAFETY: dispatch reconstructs this node's context from its own validated definitions.
		return this._clone<AfterAction<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, R, Meta>>({
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
	 * with `COMMAND_NOT_FOUND`. Canonical replacements use the new
	 * shape; open replacements and ambiguous aliases have unknown results.
	 * Required root metadata keys are checked against the constructor's inferred
	 * metadata by TypeScript, not at runtime.
	 * Command definition builders do not expose this method.
	 */
	extend<const Es extends readonly Extension<any, any, any, any, DefinedRootMetaKeys<Meta>>[]>(
		...extensions: Es & {
			[I in keyof Es]: (ExtensionCommandDefs<Es[I]> extends ValidateDefinitionFlags<
				ExtensionCommandDefs<Es[I]>,
				LocalSpellingsOf<CtxFlags>
			>
				? {}
				: {
						readonly FIX_ALIAS_COLLISION: "Extension command flags collide with inherited Context flags";
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
						Sp | CollisionSp["tree"] | DefinitionTreeSpellings<ExtensionCommands<Es>>
					>,
					I
				> &
				ExtensionCheckAt<ValidateExtensionCommands<Es, Sibs>, I> &
				ExtensionCheckAt<ValidateExtensionProvides<Es, Ctx>, I>;
		}
	): AfterExtend<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Es, Meta>;

	extend<const Es extends readonly Extension<any, any, any, any, DefinedRootMetaKeys<Meta>>[]>(
		...inputs: Es
	): AfterExtend<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Es, Meta> {
		const extensions = inputs.map(extensionData);
		// SAFETY: composition checked metadata compatibility; runtime storage erases hook requirements.
		const activeExtensions = dedupeExtensions([
			...this._node.extensions,
			...extensions,
		] as Extension[]);
		const node = installExtensionContexts(
			this._node,
			activeExtensions,
			new Set(extensions.map((extension) => extension.id)),
		);

		checkExtensionFlagRelations(node, activeExtensions);
		validateContextAvailability(
			node.contexts.map(({ instance }) => instance),
			activeExtensions.flatMap((extension) => [...extension.uses, ...(extension.provides ?? [])]),
		);

		return this._clone<
			AfterExtend<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Es, Meta>
		>({
			...node,
			extensions: activeExtensions,
		});
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
			DefinitionDescendantValuesBrand<Ds, CollisionSp["demands"]> &
			ValidateDefinitionFlags<Ds, CollisionSp["extension"] | LocalSpellingsOf<CtxFlags>>
	): AfterAdd<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Ds, Meta>;

	add<const Ds extends readonly CommandDefinition<any, any, any, any>[]>(
		...definitions: Ds
	): AfterAdd<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Ds, Meta> {
		return this._addDefinitions<
			AfterAdd<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Ds, Meta>
		>(definitions);
	}

	/**
	 * Define an app-local leaf subcommand inline (root-only sugar for
	 * `.add(defineCommand(name, recipe))`).
	 *
	 * The recipe builder is seeded with the Contexts and Context-owned flags
	 * accumulated on this builder so far — the call site. Contexts provided
	 * after `.command()` are not visible to it, matching the positional runtime
	 * semantics of `.provide()`. Extract to `defineCommand` when a command needs
	 * its own file, reuse, or a package. Command definition builders do not
	 * expose this method.
	 */
	command<const N extends string, B extends AnyCommandDefinitionBuilder>(
		name: N & CommandNameBrand<N> & CommandCollisionBrand<N, Sibs>,
		recipe: ((
			command: CommandDefinitionBuilder<
				{},
				[],
				Ctx,
				never,
				LocalSpellingsOf<CtxFlags>,
				{},
				CtxFlags
			>,
		) => B &
			// Include nested children, whose flags are not in the seeded spelling set.
			ShapeFlagCollisionBrand<ShapeOfBuilder<B>, CollisionSp["extension"]> &
			ValidateInlineCommandDeps<Ctx, NoInfer<B>>) &
			NoInfer<DescendantValuesBrand<{ child: ShapeOfBuilder<B> }, CollisionSp["demands"]>>,
	): AfterAdd<
		Flags,
		A,
		Ctx,
		Sibs,
		Sp,
		Tree,
		CtxFlags,
		CollisionSp,
		Result,
		readonly [CommandDefinition<N, readonly [], ShapeOfBuilder<B>, DepsOfBuilder<B>>],
		Meta
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
	): AfterAdd<
		Flags,
		A,
		Ctx,
		Sibs,
		Sp,
		Tree,
		CtxFlags,
		CollisionSp,
		Result,
		readonly [CommandDefinition<N, readonly [], ShapeOfBuilder<B>, DepsOfBuilder<B>>],
		Meta
	> {
		/* oxlint-disable anti-slop/no-chained-type-assertions -- inline sugar erases the call-site-seeded recipe generics before delegating to the defineCommand + add runtime. */
		// SAFETY: the seeded recipe generics restate runtime facts — materialization
		// seeds the child node from this node's contexts and owned flags.
		const define = defineCommand as unknown as (
			name: string,
			recipe: CommandRecipe,
		) => CommandDefinition;
		// SAFETY: the erased recipe still returns the builder it receives; materialization re-validates that at runtime.
		const definition = define(name, recipe as unknown as CommandRecipe);
		/* oxlint-enable anti-slop/no-chained-type-assertions */
		return this._addDefinitions<
			AfterAdd<
				Flags,
				A,
				Ctx,
				Sibs,
				Sp,
				Tree,
				CtxFlags,
				CollisionSp,
				Result,
				readonly [CommandDefinition<N, readonly [], ShapeOfBuilder<B>, DepsOfBuilder<B>>],
				Meta
			>
		>([definition]);
	}

	private _addDefinitions<Out>(definitions: readonly CommandDefinition[]): Out {
		// Keep partial additions private if a duplicate or recipe throws. Every
		// recipe inherits from the original parent, never from earlier siblings.
		const subCommands = { ...this._node.subCommands };
		for (const definition of definitions) {
			// FIX_COMMAND_COLLISION owns literal names; this owns dynamic `.add()`,
			// where a silent replacement makes the earlier command unreachable.
			// Extension-contributed commands keep documented last-write-wins.
			const spellings = [
				definition.name,
				...(definition[commandDefinitionInternal].meta.aliases ?? []),
			];
			for (const sibling of Object.values(subCommands)) {
				if (
					[sibling.meta.name, ...(sibling.meta.aliases ?? [])].some((name) =>
						spellings.includes(name),
					)
				) {
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
			}
			const childNode = materializeCommandDefinition(definition, this._node);

			checkExtensionFlagRelations(
				{ ...this._node, subCommands: { [definition.name]: childNode } },
				this._node.extensions,
			);
			subCommands[definition.name] = childNode;
		}

		return this._clone<Out>({ subCommands });
	}

	/**
	 * Prepare a frozen Command Snapshot for tooling such as man-page, skill,
	 * and build generators.
	 *
	 * Materializes Extension contributions and command definitions without
	 * calling Command Actions.
	 */
	async snapshot(): Promise<CommandSnapshot> {
		return snapshotCommand(prepareInvocation(this._node, materializeCommandDefinition).rootNode);
	}

	/**
	 * Programmatically invoke a typed command, quietly capturing its output.
	 * Returns completed, finished, or failed after cleanup without presenting errors.
	 * Use {@link execute} as the streaming terminal adapter.
	 *
	 * @param path - Typed path to the command to invoke (`[]` selects the root)
	 * @param input - Structured argument, flag, and raw values
	 * @param io - Optional `stdout(text)` / `stderr(text)` callbacks, also
	 *             exposed to Command Actions and Extensions
	 */
	async run<const Path extends CommandPath<Tree>>(
		path: Path & KnownCommandPath<Path, Tree>,
		...args: RunArguments<CommandShapeAt<CommandShape<A, Flags, Tree, Result>, Path>>
	): Promise<RunOutcome<CommandShapeAt<CommandShape<A, Flags, Tree, Result>, Path>["result"]>>;
	async run<const Path extends CommandPath<Tree>, const Input>(
		path: Path & KnownCommandPath<Path, Tree>,
		input: Input,
		// Validate after inference: a recursive Input intersection exhausts contextual typing
		// even for a broad string supplied to a simple choice flag. Check the whole
		// input union so a valid branch cannot hide an invalid one.
		...validation: [Input] extends [
			CompatibleRunInput<
				CommandShapeAt<CommandShape<A, Flags, Tree, Result>, NoInfer<Path>>,
				Input
			>,
		]
			? readonly [io?: Partial<InvocationIO>]
			: readonly [invalidInput: never]
	): Promise<RunOutcome<CommandShapeAt<CommandShape<A, Flags, Tree, Result>, Path>["result"]>>;
	async run(path: readonly string[], ...args: readonly unknown[]): Promise<RunOutcome<unknown>> {
		// SAFETY: the public overloads constrain structured input to this runtime value union.
		const structuredInput = (args[0] ?? {}) as RunInputPayload;
		// SAFETY: the public overloads constrain the second argument to invocation IO.
		const io = args[1] as Partial<InvocationIO> | undefined;
		// Programmatic calls capture failures and never change process status.
		return await runInvocation(
			this._node,
			{ path, input: structuredInput },
			io,
			materializeCommandDefinition,
		);
	}

	/**
	 * Parse `process.argv`, resolve subcommands, run Extension hooks, and
	 * execute the matched Command Action.
	 *
	 * This is the terminal CLI boundary — call it on the root builder. It
	 * renders a failure once (through Extension `onError` hooks, ending in
	 * Core's default renderer), sets `process.exitCode` (`1`, or
	 * `130` for an `AbortError` cancellation), and resolves to the exit code.
	 *
	 * @param options - Optional overrides (e.g. custom `argv` and captured
	 *                   `io` for in-process testing of exit codes and
	 *                   rendered failures)
	 * @returns The terminal exit code (`0`, `1`, or `130` for cancellation)
	 */
	async execute(options?: { argv?: string[]; io?: Partial<InvocationIO> }): Promise<number> {
		// Terminal calls render failures and set process exit status instead of throwing.
		return await executeInvocation(this._node, options, materializeCommandDefinition);
	}
}

// Root applications supply Contexts with .provide(); only recipes expose .use().
function useContextDemand(this: ErasedCrust, ...factories: AnyContextFactory[]): ErasedCrust {
	return this._clone({
		demands: [...this._node.demands, ...factories.map(contextFactoryData)],
	});
}
Object.defineProperty(Crust.prototype, "use", {
	value: useContextDemand,
	writable: true,
	configurable: true,
});
