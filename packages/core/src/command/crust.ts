import type { JsonCompatible, JsonValue } from "@crustjs/utils/json";

import type {
	AnyContextFactory,
	ContextBag,
	ContextDependencies,
	ContextInstance,
	ContextMap,
	ContextsOutput,
	ContextsOwnedFlags,
} from "../api/context.ts";
import type { Extension, ExtensionsProvidesOutput } from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import type { ExtensionId } from "../identity.ts";
import { isListed } from "../sections.ts";
import type {
	ArgDef,
	ArgsDef,
	CommandMeta,
	CommandSectionInput,
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
	ExtensionCommandDefs,
	ExtensionsCommandSpellings,
	ValidateCommandConfig,
	ValidateCommandDefinitions,
	ValidateExtensionCommands,
} from "../validation/commands.brands.ts";
import type {
	MissingDeclaredDependencyBrand,
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
	SpellingsOf,
	ValidateNamedFlagDefs,
} from "../validation/flags.brands.ts";
import type {
	IsStaticTuple,
	IsUnion,
	MergeContext,
	UnionToIntersection,
} from "../validation/shared.ts";
import {
	cloneCommandNode,
	installExtensionContexts,
	validateCommandSections,
} from "./extensions-install.ts";
import { executeInvocation, prepareInvocation, runInvocation } from "./invocation.ts";
import { type CommandAction, type CommandNode, createCommandNode, registerFlag } from "./node.ts";
import { resolveCommand } from "./router.ts";
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
	readonly result: Result;
}

/** Result of a successful programmatic invocation. */
export type RunOutcome<Result> =
	| { readonly status: "completed"; readonly result: Result }
	| { readonly status: "finished"; readonly by: ExtensionId };

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

type CompatibleRunValue<Expected, Actual> = Actual extends Expected
	? Actual
	: JsonValue extends Expected
		? Actual extends JsonCompatible<Actual>
			? Actual
			: never
		: Expected extends readonly (infer Item)[]
			? JsonValue extends Item
				? Actual extends JsonCompatible<Actual>
					? Actual
					: never
				: never
			: Actual extends object
				? {
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
export interface CommandConfig extends Omit<CommandMeta, "name" | "sections"> {
	/** Plain-text sections rendered after built-in command documentation. */
	readonly sections?: readonly CommandSectionInput[];
}

/** Static metadata accepted by the root command constructor. */
export type RootCommandMeta = Pick<CommandMeta, "description" | "usage"> & {
	/** Plain-text sections rendered after built-in command documentation. */
	readonly sections?: readonly CommandSectionInput[];
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
	any
>;

// Child builders start without inherited flags, so brands cannot see ancestor
// spellings from inside a sealed recipe. Materialization seeds the child with
// the parent's owned flags and catches collisions at runtime: `.flags()` hits
// the seeded spelling table, and recipe-provided Contexts are checked against
// ancestor owners in `materializeCommandDefinition`.
type CommandRecipe<Builder extends AnyCommandDefinitionBuilder = AnyCommandDefinitionBuilder> = (
	command: CommandDefinitionBuilder<{}, [], {}, never, never>,
) => Builder;

const commandDefinitionInternal: unique symbol = Symbol.for("crust.commandDefinition");

interface CommandDefinitionInternal {
	readonly recipe: (command: AnyCommandDefinitionBuilder) => AnyCommandDefinitionBuilder;
	readonly meta: Omit<CommandMeta, "name">;
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
	child._ancestorOwnedFlags = parent.ownedFlags;
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
	if (!(configured instanceof Crust) || configured._ancestorOwnedFlags !== parent.ownedFlags) {
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
	for (const { instance } of parent.contexts) {
		for (const [flagName, def] of Object.entries(instance.ownedFlags)) {
			for (const spelling of [flagName, def.short, ...(def.aliases ?? [])]) {
				if (spelling) ancestorFlagOwners.set(spelling, instance.name);
			}
		}
	}
	for (const { instance } of configured._node.contexts.slice(parent.contexts.length)) {
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
	out Ctx extends ContextMap = {},
	Sibs extends string = never,
	Sp extends string = SpellingsOf<Flags>,
	Tree extends object = {},
	out CtxFlags extends FlagsDef = {},
	Result = void,
	out Deps extends ContextMap = {},
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
		Result,
		Deps
	>;

	args<const NewA extends ArgsDef>(
		...defs: NewA & AppendArgsChecks<A, NewA>
	): CommandDefinitionBuilder<
		Flags,
		AppendedArgs<A, NewA>,
		Ctx,
		Sibs,
		Sp,
		Tree,
		CtxFlags,
		Result,
		Deps
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
	 * Declarations are type-only — nothing is recorded at runtime — so the
	 * signature requires a statically known, non-empty factory tuple: a widened
	 * or empty spread would contribute nothing and is rejected at compile time.
	 */
	use<const Fs extends readonly [AnyContextFactory, ...AnyContextFactory[]]>(
		...factories: Fs
	): CommandDefinitionBuilder<
		Flags,
		A,
		MergeContext<Ctx, ContextDependencies<Fs>>,
		Sibs,
		Sp,
		Tree,
		CtxFlags,
		Result,
		MergeContext<Deps, ContextDependencies<Fs>>
	>;

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
		Result,
		Deps
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
		Result,
		Deps
	>;

	action<R>(
		action: (ctx: NoInfer<CrustCommandContext<A, Flags, Ctx>>) => R,
	): CommandDefinitionBuilder<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, Awaited<R>, Deps>;
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
		infer Result,
		any
	>
		? CommandShape<A, Flags, Tree, Result>
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
		B extends CommandDefinitionBuilder<any, any, any, any, any, any, any, any, infer Deps>
			? Deps
			: {}
	> extends infer Merged extends ContextMap
		? Merged
		: {};

// Matching against CommandDefinitionSpellings (never for widened names) keeps a
// widened definition in the same tuple or union from degrading a literal
// sibling's shape: a widened `Name` would otherwise match every spelling.
type DefinitionShapeForSpelling<D, Spelling extends string> =
	D extends CommandDefinition<any, any, infer Shape, any>
		? Spelling extends CommandDefinitionSpellings<D>
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

// Mapped per slot: `Es[number]` cannot distinguish `.extend(a, b)` from
// `.extend(cond ? a : b)` — both index to the same union. Variable-length
// Extension lists (`.extend(...dynamicList)`) contribute nothing.
type ExtensionCommands<Es extends readonly Extension<any, any, any, any>[]> =
	number extends Es["length"]
		? readonly []
		: { [I in keyof Es]: ExtensionCommandDefs<Es[I]> }[number];

type StaticExtensionFlagDefs<E> =
	IsUnion<E> extends true
		? readonly []
		: E extends Extension<any, any, infer Defs, any>
			? IsStaticTuple<Defs> extends true
				? string extends Defs[number]["name"]
					? readonly []
					: Defs
				: readonly []
			: readonly [];

type ExtensionFlagDefs<Es extends readonly Extension<any, any, any, any>[]> =
	number extends Es["length"]
		? readonly []
		: { [I in keyof Es]: StaticExtensionFlagDefs<Es[I]> }[number];

type ExtensionFlags<Es extends readonly Extension<any, any, any, any>[]> = NamedFlagsRecord<
	ExtensionFlagDefs<Es>
>;

// Only a statically `true` (or omitted — the runtime default) `recursive` scope
// promotes a flag onto descendant inputs: a widened `boolean` scope may be
// `false` at runtime, which installs the flag on the root only.
type RecursiveExtensionFlags<Es extends readonly Extension<any, any, any, any>[]> = {
	[
		D in ExtensionFlagDefs<Es>[number] as D extends { readonly recursive: infer R }
			? [R] extends [true]
				? D["name"]
				: never
			: D["name"]
	]: Omit<D, "name">;
} extends infer F extends FlagsDef
	? F
	: never;

type TreeWithInheritedFlags<Tree, F extends FlagsDef> = {
	[K in keyof Tree]: ShapeWithInheritedFlags<Tree[K], F>;
};

type ExtendedTree<
	Tree,
	Commands extends readonly CommandDefinition<any, any, any, any>[],
	RecursiveFlags extends FlagsDef,
	InheritedFlags extends FlagsDef,
> = {} extends RecursiveFlags
	? Tree & DefinitionsTree<Commands, InheritedFlags>
	: TreeWithInheritedFlags<Tree & DefinitionsTree<Commands, InheritedFlags>, RecursiveFlags>;

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
	name: Name & EmptyNameBrand<Name>,
	recipe: CommandRecipe<Builder>,
): CommandDefinition<Name, readonly [], ShapeOfBuilder<Builder>, DepsOfBuilder<Builder>>;
export function defineCommand<
	const Name extends string,
	const C extends CommandConfig,
	Builder extends AnyCommandDefinitionBuilder,
>(
	name: Name & EmptyNameBrand<Name>,
	config: C & ValidateCommandConfig<Name, C>,
	recipe: CommandRecipe<Builder>,
): CommandDefinition<Name, AliasesOf<C>, ShapeOfBuilder<Builder>, DepsOfBuilder<Builder>>;
export function defineCommand(
	name: string,
	configOrRecipe: CommandConfig | CommandRecipe,
	maybeRecipe?: CommandRecipe,
): CommandDefinition {
	const hasConfig = !isCommandRecipe(configOrRecipe);
	const config: CommandConfig = hasConfig ? configOrRecipe : {};
	const recipe = hasConfig ? maybeRecipe : configOrRecipe;
	if (!recipe) throw new CrustError("DEFINITION", `Command "${name}" requires a recipe`);
	const { sections, ...metaRest } = config;
	const meta: Omit<CommandMeta, "name"> = {
		...metaRest,
		...(config.aliases ? { aliases: [...config.aliases] } : {}),
		...(sections ? { sections: validateCommandSections(name, sections) } : {}),
	};
	const internal: CommandDefinitionInternal = {
		// SAFETY: overloads pair each recipe with its declared dependency context; storage erases it.
		recipe: recipe as CommandDefinitionInternal["recipe"],
		meta,
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

function dedupeExtensions(extensions: readonly Extension[]): Extension[] {
	// ponytail: O(n^2) scan, fine for handfuls of extensions.
	return extensions.filter((e, i) => extensions.findLastIndex((x) => x.id === e.id) === i);
}

type RunInputValue = URL | JsonValue | readonly RunInputValue[];

interface RunInputPayload {
	readonly args?: Readonly<Record<string, RunInputValue>>;
	readonly flags?: Readonly<Record<string, RunInputValue>>;
	readonly raw?: readonly string[];
}

function serializeInputValue(
	definition: ArgDef | FlagDef,
	name: string,
	value: RunInputValue,
): string {
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
	input: RunInputPayload,
): string[] {
	const route = resolveCommand(root, [...path]);
	if (route.argv.length > 0) {
		// A path element the router could not consume must fail here; letting it
		// fall through would serialize it ahead of the real positionals.
		// SAFETY: the enclosing length check proves the first element exists.
		const candidate = route.argv[0]!;
		const parentCommand = snapshotCommand(route.command);
		throw new CrustError("COMMAND_NOT_FOUND", `Unknown command "${candidate}".`, {
			input: candidate,
			available: Object.entries(parentCommand.subCommands)
				.filter(([, child]) => isListed(child))
				.map(([name]) => name),
			commandPath: route.commandPath,
			parentCommand,
		});
	}
	const command = route.command;
	const argv = [...path];
	const args = input.args;
	let omittedArgument: string | undefined;
	let firstPositional: string | undefined;
	for (const definition of command.args) {
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
		if (!command.args.some((definition) => definition.name === name)) {
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

	const flags = input.flags;
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
 * - `CtxFlags` — Context-owned flags accumulated by `.provide()` and recursive
 *   Extension flags accumulated by `.extend()`, inherited by the shapes of
 *   definitions added afterwards
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
type CollisionSpellings<Extensions extends string = never, Tree extends string = never> = {
	readonly extension: Extensions;
	readonly tree: Tree;
};

type AfterFlags<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Sibs extends string,
	Sp extends string,
	Tree extends object,
	CtxFlags extends FlagsDef,
	CollisionSp extends CollisionSpellings,
	Result,
	Defs extends readonly NamedFlagDef[],
> = Crust<
	MergeFlags<Flags, NamedFlagsRecord<Defs>>,
	A,
	Ctx,
	Sibs,
	Sp | SpellingsOf<NamedFlagsRecord<Defs>>,
	Tree,
	CtxFlags,
	CollisionSp,
	Result
>;

type AfterArgs<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Sibs extends string,
	Sp extends string,
	Tree extends object,
	CtxFlags extends FlagsDef,
	CollisionSp extends CollisionSpellings,
	Result,
	NewA extends ArgsDef,
> = Crust<Flags, AppendedArgs<A, NewA>, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result>;

type AfterProvide<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Sibs extends string,
	Sp extends string,
	Tree extends object,
	CtxFlags extends FlagsDef,
	CollisionSp extends CollisionSpellings,
	Result,
	Cs extends readonly ContextInstance[],
> = Crust<
	MergeFlags<Flags, ContextsOwnedFlags<Cs>>,
	A,
	MergeContext<Ctx, ContextsOutput<Cs>>,
	Sibs,
	Sp | SpellingsOf<ContextsOwnedFlags<Cs>>,
	Tree,
	MergeFlags<CtxFlags, ContextsOwnedFlags<Cs>>,
	CollisionSp,
	Result
>;

type AfterAction<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Sibs extends string,
	Sp extends string,
	Tree extends object,
	CtxFlags extends FlagsDef,
	CollisionSp extends CollisionSpellings,
	R,
> = Crust<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Awaited<R>>;

type AfterExtend<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Sibs extends string,
	Sp extends string,
	Tree extends object,
	CtxFlags extends FlagsDef,
	CollisionSp extends CollisionSpellings,
	Result,
	Es extends readonly Extension<any, any, any, any>[],
> = Crust<
	MergeFlags<Flags, ExtensionFlags<Es>>,
	A,
	MergeContext<Ctx, ExtensionsProvidesOutput<Es>>,
	Sibs | ExtensionsCommandSpellings<Es>,
	Sp | ExtensionsSpellings<Es>,
	ExtendedTree<Tree, ExtensionCommands<Es>, RecursiveExtensionFlags<Es>, CtxFlags>,
	MergeFlags<CtxFlags, RecursiveExtensionFlags<Es>>,
	CollisionSpellings<
		CollisionSp["extension"] | ExtensionsSpellings<Es>,
		CollisionSp["tree"] | DefinitionTreeSpellings<ExtensionCommands<Es>>
	>,
	Result
>;

type AfterAdd<
	Flags extends FlagsDef,
	A extends ArgsDef,
	Ctx extends ContextMap,
	Sibs extends string,
	Sp extends string,
	Tree extends object,
	CtxFlags extends FlagsDef,
	CollisionSp extends CollisionSpellings,
	Result,
	Ds extends readonly CommandDefinition<any, any, any, any>[],
> = Crust<
	Flags,
	A,
	Ctx,
	Sibs | CommandDefinitionSpellings<Ds[number]>,
	Sp,
	Tree & DefinitionsTree<Ds, CtxFlags>,
	CtxFlags,
	CollisionSpellings<CollisionSp["extension"], CollisionSp["tree"] | DefinitionTreeSpellings<Ds>>,
	Result
>;

// Missing-dependency brand for inline `.command()`: parity with
// `ValidateDeclaredDeps` at `.add()`, attached to the name parameter because
// the builder type `B` is inferred from the recipe argument itself.
type ValidateInlineCommandDeps<Ctx extends ContextMap, B> = MissingDeclaredDependencyBrand<
	{ readonly _deps?: DepsOfBuilder<B> },
	string extends keyof Ctx ? never : keyof Ctx & string
>;

/** Broad application type for APIs that accept any fully-built Crust application. */
export type AnyCrust = Crust<any, any, any, any, any, any, any, any, any>;

export class Crust<
	Flags extends FlagsDef = {},
	A extends ArgsDef = ArgsDef,
	// `out` forces covariance over the contravariant brand positions in
	// provide()/extend(); those brands are best-effort lints (already bypassable
	// via widening), and the annotation skips a full structural comparison per
	// assignment. Do not "fix" it back to inferred variance.
	out Ctx extends ContextMap = {},
	Sibs extends string = never,
	Sp extends string = SpellingsOf<Flags>,
	Tree extends object = {},
	out CtxFlags extends FlagsDef = {},
	CollisionSp extends CollisionSpellings = CollisionSpellings,
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
	_node: CommandNode;

	/** @internal — Runtime identity anchor for the ancestor-owned flag carrier */
	_ancestorOwnedFlags: FlagsDef;

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
			this._node.meta.sections = validateCommandSections(name, meta.sections);
		}
		this._ancestorOwnedFlags = {};
	}

	/**
	 * @internal — Clone this builder with a new node, preserving generics.
	 */
	private _clone<Out = this>(nodeOverrides: Partial<CommandNode>): Out {
		// SAFETY: the clone uses the same prototype and receives every instance field below.
		const cloned = Object.create(Object.getPrototypeOf(this)) as this;
		const effectiveFlags = { ...this._node.effectiveFlags };
		const newNode: CommandNode = {
			...this._node,
			// Descendants are immutable builder values; sharing them keeps fluent updates O(1).
			localFlags: { ...this._node.localFlags },
			ownedFlags: { ...this._node.ownedFlags },
			effectiveFlags,
			flagSpellings: cloneFlagSpellings(this._node.flagSpellings, effectiveFlags),
			args: [...this._node.args],
			subCommands: { ...this._node.subCommands },
			contexts: [...this._node.contexts],
			contextExtensionIds: [...this._node.contextExtensionIds],
			extensions: [...this._node.extensions],
			meta: { ...this._node.meta },
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
		...defs: ValidateNamedFlagDefs<Defs, Sp>
	): AfterFlags<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Defs> {
		const cloned = this._clone<
			AfterFlags<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Defs>
		>({});
		for (const def of defs) {
			const { name, ...rest } = def;
			// SAFETY: removing name from a NamedFlagDef leaves its discriminated FlagDef.
			registerFlag(cloned._node, name, rest, "local");
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
	args<const NewA extends ArgsDef>(
		...defs: NewA & AppendArgsChecks<A, NewA>
	): AfterArgs<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, NewA> {
		const combined = [...this._node.args, ...defs.map((definition) => ({ ...definition }))];
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
		return this._clone<
			AfterArgs<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, NewA>
		>({ args: combined });
	}

	/**
	 * Attach Contexts — named command dependencies — to this command.
	 *
	 * Contexts are inherited by descendant commands and constructed lazily when
	 * their `ctx` property is accessed. Dependency order within one call does not
	 * affect construction. Disposable values are released in
	 * reverse construction order after post-run hooks. A Context-owned flag that
	 * collides with an existing flag throws a `DEFINITION` error.
	 *
	 */
	provide<const Cs extends readonly ContextInstance[]>(
		...instances: ProvideChecks<Sp, Cs> &
			ValidateContextNames<Ctx, Cs> &
			ValidateContextDeps<Ctx, Cs>
	): AfterProvide<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Cs> {
		// Positional by design: providers reach only this node and children added
		// afterwards (flag scoping; see definition.test.ts). Extension `provides`
		// differ deliberately — they are application-wide and walk the whole tree.
		const cloned = this._clone<
			AfterProvide<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Cs>
		>({ contexts: [...this._node.contexts, ...instances.map((instance) => ({ instance }))] });
		for (const instance of instances) {
			for (const [name, definition] of Object.entries(instance.ownedFlags)) {
				registerFlag(cloned._node, name, definition, "owned");
			}
		}
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
	): AfterAction<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, R> {
		// SAFETY: dispatch reconstructs this node's context from its own validated definitions.
		return this._clone<AfterAction<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, R>>({
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
	 * and its hooks run once, at the later position. Replacement is
	 * runtime-only: contributions already merged into the builder's static
	 * types stay visible, so invoking a replaced literal Extension's commands
	 * through typed `run()` fails at runtime with `COMMAND_NOT_FOUND`.
	 * Command definition builders do not expose this method.
	 */
	extend<const Es extends readonly Extension<any, any, any, any>[]>(
		...extensions: Es &
			ValidateDeclaredDeps<MergeContext<Ctx, ExtensionsProvidesOutput<Es>>, Es> &
			// Contributed command trees count as existing spellings: prepare
			// materializes commands before injecting Extension flags, so a shared
			// spelling makes injectExtensionFlag throw on every invocation.
			ValidateExtensionFlags<
				Es,
				Sp | CollisionSp["tree"] | DefinitionTreeSpellings<ExtensionCommands<Es>>
			> &
			ValidateExtensionCommands<Es, Sibs> &
			ValidateExtensionProvides<Es, Ctx>
	): AfterExtend<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Es> {
		const activeExtensions = dedupeExtensions([...this._node.extensions, ...extensions]);
		return this._clone<
			AfterExtend<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Es>
		>({
			...installExtensionContexts(
				this._node,
				activeExtensions,
				new Set(extensions.map((extension) => extension.id)),
			),
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
			ValidateDefinitionFlags<Ds, CollisionSp["extension"]>
	): AfterAdd<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Ds> {
		let result = this._clone<Crust<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result>>(
			{},
		);
		for (const definition of definitions) {
			result = result._addDefinition(definition);
		}
		return result._clone<
			AfterAdd<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result, Ds>
		>({});
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
		// ShapeFlagCollisionBrand keeps parity with `.add()`'s ValidateDefinitionFlags:
		// the recipe's whole tree (including nested `.add()` children, which the seeded
		// `Sp` cannot see) is checked against registered Extension flag spellings.
		name: N &
			EmptyNameBrand<N> &
			ValidateInlineCommandDeps<Ctx, B> &
			ShapeFlagCollisionBrand<ShapeOfBuilder<B>, CollisionSp["extension"]>,
		recipe: (
			command: CommandDefinitionBuilder<{}, [], Ctx, never, SpellingsOf<CtxFlags>, {}, CtxFlags>,
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
		readonly [CommandDefinition<N, readonly [], ShapeOfBuilder<B>, DepsOfBuilder<B>>]
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
		return this._addDefinition(definition)._clone<
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
				readonly [CommandDefinition<N, readonly [], ShapeOfBuilder<B>, DepsOfBuilder<B>>]
			>
		>({});
	}

	private _addDefinition(
		definition: CommandDefinition,
	): Crust<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result> {
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

		return this._clone<Crust<Flags, A, Ctx, Sibs, Sp, Tree, CtxFlags, CollisionSp, Result>>({
			subCommands: { ...this._node.subCommands, [definition.name]: childNode },
		});
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
	 * Invoke this application programmatically: serialize the typed input, resolve, parse,
	 * run the Extension hooks, and execute the selected Command Action.
	 *
	 * Unlike {@link Crust.execute}, `run()` throws the original definition,
	 * parse, Context, or action failure without rendering it (Extension
	 * `onError` hooks are a terminal presentation concern and never run
	 * here) and without changing process status. It resolves to a `completed`
	 * outcome carrying the selected action's return value after successful
	 * cleanup, or a `finished` outcome naming the Extension whose `preRun`
	 * hook ended the invocation first. Prompt cancellation surfaces as a
	 * standard `AbortError`.
	 *
	 * @param path - Typed path to the command to invoke (`[]` selects the root)
	 * @param input - Structured argument, flag, and raw values
	 * @param io - Optional `stdout(text)` / `stderr(text)` callbacks, also
	 *             exposed to Command Actions and Extensions
	 */
	async run<const Path extends CommandPath<Tree>, const Input>(
		path: Path,
		input: Input,
		...validation: Input extends CompatibleRunInput<
			CommandShapeAt<CommandShape<A, Flags, Tree, Result>, NoInfer<Path>>,
			Input
		>
			? readonly [io?: Partial<InvocationIO>]
			: readonly [invalidInput: never]
	): Promise<RunOutcome<CommandShapeAt<CommandShape<A, Flags, Tree, Result>, Path>["result"]>>;
	async run<const Path extends CommandPath<Tree>>(
		path: Path,
		...args: RunArguments<CommandShapeAt<CommandShape<A, Flags, Tree, Result>, Path>>
	): Promise<RunOutcome<CommandShapeAt<CommandShape<A, Flags, Tree, Result>, Path>["result"]>>;
	async run(path: readonly string[], ...args: readonly unknown[]): Promise<RunOutcome<unknown>> {
		// SAFETY: the public overloads constrain structured input to this runtime value union.
		const structuredInput = (args[0] ?? {}) as RunInputPayload;
		// SAFETY: the public overloads constrain the second argument to invocation IO.
		const io = args[1] as Partial<InvocationIO> | undefined;
		const root = prepareInvocation(this._node, materializeCommandDefinition).rootNode;
		const argv = serializeRunArgv(root, path, structuredInput);
		// Programmatic calls preserve raw failures and never change process status.
		return await runInvocation(this._node, argv, io, materializeCommandDefinition);
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

// `.use()` is a compile-time demand: it feeds the recipe builder's `Deps`
// generic and the sealed definition's `_deps` phantom, while invocation
// resolves values from the provided path contexts, so nothing is recorded at
// runtime. The implementation lives on the prototype because recipes execute
// against Crust instances, while Crust's declared type omits it — root
// applications supply Contexts with `.provide()`.
function useContextDemand(this: AnyCrust, ...factories: AnyContextFactory[]): AnyCrust {
	for (const factory of factories) {
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- recipes are an authoring boundary: the demand/supply mixup (`.use(logger())`) must fail loud here, not lazily at invocation.
		if (typeof factory !== "function" || typeof factory.contextName !== "string") {
			throw new CrustError(
				"DEFINITION",
				`.use() expects Context factories (e.g. \`.use(logger)\`); call \`.provide(logger())\` to supply a Context value`,
				{ subject: "context", name: String(factory), reason: "use-expects-factory" },
			);
		}
	}
	return this;
}
Object.defineProperty(Crust.prototype, "use", {
	value: useContextDemand,
	writable: true,
	configurable: true,
});
