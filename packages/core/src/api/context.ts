import { CrustError } from "../errors.ts";
import { flagRecordEntries, toFlagsRecord } from "../parsing/spellings.ts";
import { validateCommandSections } from "../sections.ts";
import type {
	Awaitable,
	CommandSection,
	FlagsDef,
	InferFlags,
	InvocationIO,
	MergeFlags,
	MergeProviders,
	RuntimeCommandSectionInput,
} from "../types.ts";
import type { LocalSectionsBrand } from "../validation/commands.brands.ts";
import type {
	ContextOwnedFlags,
	FlagRecordErrors,
	FlagsInput,
	DefinedFlags,
	LocalSpellingsOf,
} from "../validation/flags.brands.ts";
import type {
	IsAny,
	IsStaticTuple,
	IsUnion,
	IsClosedName,
	UnionToIntersection,
} from "../validation/shared.ts";

/** Upper bound for phantom name-to-value context maps. */
export type ContextMap = object;

const defining: unique symbol = Symbol("crust.defining");
declare const contextProof: unique symbol;

/** @internal Immutable defining data retained through public structural copies. */
export interface Defining<T> {
	readonly [defining]: T;
}

/** @internal */
export type DefiningOf<T> = T extends Defining<unknown> ? T[typeof defining] : T;

/** @internal */
export function definingOf<T extends Defining<unknown>>(value: T): DefiningOf<T> {
	// SAFETY: T's Defining constraint proves the indexed value is DefiningOf<T>.
	return value[defining] as DefiningOf<T>;
}

/** @internal */
export function seal<T extends object>(value: T): T & Defining<T> {
	return sealHandle(value, value);
}

/** @internal Freeze a public handle whose defining data is a separate record. */
export function sealHandle<T extends object, D>(handle: T, data: D): T & Defining<D> {
	return Object.freeze(Object.assign(handle, { [defining]: data }));
}

/**
 * Adapter hook: the Context sources a bag was built from, exposed as a
 * non-enumerable symbol property. Reading it never starts construction.
 */
export const contextSources: unique symbol = Symbol.for("crust.contextSources");

/** Lazy, invocation-scoped Context values. Reading a property starts construction. */
export type ContextBag<Deps extends ContextMap = {}> = {
	readonly [K in keyof Deps]: Promise<Deps[K]>;
} & {
	// Optional: hand-built bags (tests) omit it; resolver bags always define it.
	readonly [contextSources]?: readonly (AnyContextFactory | AnyContextInstance)[];
};

export interface ContextInstance<
	Name extends string = string,
	Value = unknown,
	OF extends FlagsDef = FlagsDef,
	Deps extends ContextMap = Record<string, ContextValue>,
	// Flags a command that uses this Context parses: its own and its setup dependencies', transitively.
	UF extends FlagsDef = OF,
> extends Defining<ContextInstance<Name, Value, OF, Deps, UF>> {
	readonly [contextProof]?: string extends keyof OF | keyof Deps
		? unknown
		: (state: [OF, Deps]) => void;
	readonly name: Name;
	readonly ownedFlags: FlagsDef;
	/** Validated {@link ContextBuilder.sections}, frozen at declaration. */
	readonly sections: readonly CommandSection[];
	/** @internal — declared direct dependency factories */
	readonly use: readonly AnyContextFactory[];
	/** @internal defining factory, for adapters that identify Contexts by factory */
	readonly factory: AnyContextFactory;
	setup(input: ContextSetup<OF, ContextMap>): Awaitable<Value>;
	readonly _ownedFlags?: OF;
	/** @internal — phantom carrying the transitive dependency closure */
	readonly _deps?: Deps;
	/** @internal — phantom carrying the flags a `.use()` of an Extension providing it installs */
	readonly _useFlags?: UF;
}

/** Any Context instance: the open bound for provider lists; never evidence for trusted attachment. */
export type AnyContextInstance = ContextInstance<string, unknown, any, any>;

/** Whatever a Context setup produces, erased at the runtime registry. */
export type ContextValue = Awaited<ReturnType<AnyContextInstance["setup"]>>;

/** Invocation input passed to a Context's `.setup()` callback; factory options arrive as its second parameter. */
export interface ContextSetup<
	OF extends FlagsDef = {},
	Deps extends ContextMap = {},
> extends InvocationIO {
	/** The invocation's cancellation signal; pass it to cancellable setup work. */
	readonly signal: AbortSignal;
	readonly flags: InferFlags<OF>;
	readonly ctx: ContextBag<Deps>;
	/**
	 * Registers cleanup on the invocation's disposal stack: callbacks run after
	 * post-run hooks in reverse registration order. Throws once setup has settled.
	 */
	readonly defer: (cleanup: () => void | PromiseLike<void>) => void;
}

export interface ContextFactory<
	Name extends string,
	Options,
	Value,
	OF extends FlagsDef = {},
	Deps extends ContextMap = {},
	// Flags a command that uses this Context parses: its own and its setup dependencies', transitively.
	UF extends FlagsDef = OF,
> extends Defining<ContextFactory<Name, Options, Value, OF, Deps, UF>> {
	/** Options may be omitted when their type accepts `undefined` (including no-option `void`). */
	(
		...options: undefined extends Options ? [options?: Options] : [options: Options]
	): ContextInstance<Name, Value, OF, Deps, UF>;
	readonly contextName: Name;
	/** @internal — declared direct dependency factories */
	readonly use: readonly AnyContextFactory[];
	/** @internal — owned flags, installed on the commands that use this Context */
	readonly ownedFlags: FlagsDef;
	of(value: Value): ContextInstance<Name, Value, OF, {}, UF>;
	readonly _deps?: Deps;
	/** @internal — phantom carrying the flags `.use()` installs */
	readonly _useFlags?: UF;
}

export type AnyContextFactory = ContextFactory<string, any, any, any, any>;

type NamedOutput<Name extends string, Value> =
	IsClosedName<Name> extends false
		? Record<string, Awaited<Value>>
		: IsUnion<Name> extends true
			? Record<string, Awaited<Value>>
			: { [K in Name]: Awaited<Value> };

type ContextOutput<C> = C extends AnyContextInstance
	? DefiningOf<C> extends ContextInstance<infer Name, infer Value, any, any>
		? NamedOutput<Name, Value>
		: never
	: never;

// `[...Init, Last]` never matches a tuple with an optional tail (`[A, B?]`), so such tuples
// fold over their required prefix, which head-first recursion used to visit. Tuples that end
// in a required element skip the extra pass.
type FoldableContexts<Cs extends readonly unknown[]> = Cs extends readonly [...unknown[], unknown]
	? Cs
	: RequiredPrefix<Cs>;

type RequiredPrefix<
	Cs extends readonly unknown[],
	Acc extends unknown[] = [],
> = Cs extends readonly [infer H, ...infer T] ? RequiredPrefix<T, [...Acc, H]> : Acc;

// Folds from the last Context so the tail-recursive walk keeps last-write-wins
// nesting while one `.provide()` takes 46+ Contexts without TS2589.
type StaticContextsOutput<Cs extends readonly unknown[], Acc = {}> = Cs extends readonly [
	...infer Init,
	infer Last,
]
	? StaticContextsOutput<Init, MergeProviders<ContextOutput<Last>, Acc>>
	: Acc;

export type ContextsOutput<Cs extends readonly AnyContextInstance[]> =
	IsStaticTuple<Cs> extends true
		? StaticContextsOutput<FoldableContexts<Cs>>
		: Cs[number] extends never
			? {}
			: Record<
					string,
					ContextOutput<Cs[number]> extends infer O
						? O extends unknown
							? O[keyof O]
							: never
						: never
				>;

type StaticContextsOwnedFlags<
	Cs extends readonly unknown[],
	Acc extends FlagsDef = {},
> = Cs extends readonly [...infer Init, infer Last]
	? StaticContextsOwnedFlags<Init, MergeFlags<ContextOwnedFlags<Last>, Acc>>
	: Acc;

export type ContextsOwnedFlags<Cs extends readonly AnyContextInstance[]> =
	IsStaticTuple<Cs> extends true
		? StaticContextsOwnedFlags<FoldableContexts<Cs>>
		: keyof UnionToIntersection<ContextOwnedFlags<Cs[number]>> extends never
			? {}
			: FlagsDef;

/** @internal The Context name a factory or instance provides. */
export function contextNameOf(source: AnyContextInstance | AnyContextFactory): string {
	return "contextName" in source ? source.contextName : source.name;
}

/** Check only declared availability; setup, callback values, and cycles belong to invocation. */
export function validateContextAvailability(
	contexts: readonly AnyContextInstance[],
	sources: readonly (AnyContextInstance | AnyContextFactory)[],
): void {
	const names = new Set(contexts.map((instance) => instance.name));
	const visited = new Set<AnyContextInstance | AnyContextFactory>();
	const visit = (source: AnyContextInstance | AnyContextFactory): void => {
		if (visited.has(source)) return;
		visited.add(source);
		const name = contextNameOf(source);
		if (!names.has(name)) {
			throw new CrustError("DEFINITION", `No provider for Context "${name}"`, {
				subject: "context",
				name,
				reason: "missing-context",
			});
		}
		for (const dependency of source.use) visit(dependency);
	};
	for (const source of sources) visit(source);
}

type FactoryOutput<F> = F extends AnyContextFactory
	? DefiningOf<F> extends ContextFactory<infer Name, any, infer Value, any, any>
		? NamedOutput<Name, Value>
		: never
	: never;

// Tail-recursive accumulators let one `.use()` take 46+ Contexts without TS2589.
type FactoriesOutput<Fs extends readonly AnyContextFactory[], Acc = {}> = Fs extends readonly [
	infer H,
	...infer T extends readonly AnyContextFactory[],
]
	? FactoriesOutput<T, Acc & FactoryOutput<H>>
	: Acc;

type FactoryDeps<F> = F extends AnyContextFactory
	? DefiningOf<F> extends ContextFactory<any, any, any, any, infer Deps>
		? Deps
		: {}
	: {};
type FactoriesDeps<Fs extends readonly AnyContextFactory[], Acc = {}> = Fs extends readonly [
	infer H,
	...infer T extends readonly AnyContextFactory[],
]
	? FactoriesDeps<T, Acc & FactoryDeps<H>>
	: Acc;

// A widened factory or instance may own any flags.
type FactoryUseFlags<F> =
	DefiningOf<F> extends { readonly _useFlags?: infer UF extends FlagsDef }
		? IsAny<UF> extends true
			? FlagsDef
			: UF
		: {};

/** Flags a command parses for the Contexts it uses: their own and their dependencies', transitively. */
export type ContextUseFlags<
	Fs extends readonly unknown[],
	Acc extends FlagsDef = {},
> = Fs extends readonly [infer H, ...infer T]
	? ContextUseFlags<T, AppendedFlags<Acc, FactoryUseFlags<H>>>
	: // A widened rest may hold any flag-owning factories, so its flags stay open.
		[Fs[number]] extends [never]
		? Acc
		: keyof FactoryUseFlags<Fs[number]> extends never
			? Acc
			: AppendedFlags<Acc, FlagsDef>;

export type ContextDependencies<Use extends readonly AnyContextFactory[]> =
	IsStaticTuple<Use> extends true
		? FactoriesOutput<Use> & FactoriesDeps<Use>
		: Record<string, ContextValue>;

export type ContextDepsOf<C> = C extends AnyContextInstance
	? DefiningOf<C> extends { readonly _deps?: infer Deps extends ContextMap }
		? Deps
		: {}
	: {};
// Tail-recursive so `.extend()` of an Extension providing 46+ Contexts avoids TS2589.
export type ContextsDependencies<
	Cs extends readonly AnyContextInstance[],
	Acc = {},
> = Cs extends readonly [infer H, ...infer T extends readonly AnyContextInstance[]]
	? ContextsDependencies<T, Acc & ContextDepsOf<H>>
	: Acc;

/** Factory options inferred from a setup callback's optional second parameter. */
type ContextOptionsOf<Args extends readonly unknown[]> = Args extends readonly [] ? void : Args[0];

/**
 * Immutable fluent Context authoring handle returned by {@link defineContext}.
 * `use`, `flags`, and `sections` append and return a new handle; `setup` ends the chain and
 * returns the callable {@link ContextFactory}. Callbacks are typed by the
 * declarations made before them.
 */
export interface ContextBuilder<
	Name extends string,
	Use extends readonly AnyContextFactory[] = [],
	OF extends FlagsDef = {},
> {
	/** Declare Contexts setup reads from `ctx`; consumers must provide their transitive closure. */
	use<const Fs extends readonly AnyContextFactory[]>(
		...factories: Fs
	): ContextBuilder<Name, readonly [...Use, ...Fs], OF>;
	/**
	 * Own flags, which setup reads from `flags`. A command parses them where its `ctx` exposes
	 * this Context: the providing command and inline `.command()` children after it, and
	 * reusable commands that `.use()` it (or a Context that depends on it).
	 * Takes one record keyed by flag name; repeated calls accumulate.
	 */
	flags<const F extends FlagsInput>(
		flags: F & FlagRecordErrors<F, LocalSpellingsOf<OF>>,
	): ContextBuilder<Name, Use, AppendedFlags<OF, DefinedFlags<F>>>;
	/** Document only the providing command (the root for Extension-provided Contexts). */
	sections<const S extends readonly RuntimeCommandSectionInput[]>(
		...sections: S & LocalSectionsBrand<{ sections: S }>["sections"]
	): ContextBuilder<Name, Use, OF>;
	/**
	 * Finish the definition. `setup` runs lazily, once per invocation, when a
	 * consumer first reads the Context. Annotate its optional second parameter to
	 * accept factory options: `.setup((input, options: { url: string }) => …)`.
	 */
	setup<Value, Args extends readonly [options?: unknown] = []>(
		setup: (input: ContextSetup<OF, ContextDependencies<Use>>, ...args: Args) => Awaitable<Value>,
	): ContextFactory<
		Name,
		ContextOptionsOf<Args>,
		Value,
		OF,
		ContextDependencies<Use>,
		ContextUseFlags<Use, OF>
	>;
}

// Only a definitely empty record is dropped; a union of disjoint records also has no common keys.
type AppendedFlags<OF extends FlagsDef, F extends FlagsDef> =
	IsUnion<OF> extends true
		? OF & F
		: keyof OF extends never
			? F
			: IsUnion<F> extends true
				? OF & F
				: keyof F extends never
					? OF
					: OF & F;

type ErasedContextBuilder = ContextBuilder<string, any, any>;
type ErasedContextOptions = Parameters<AnyContextFactory>[0];
type ErasedContextSetup = (
	input: ContextSetup<FlagsDef, ContextMap>,
	options: ErasedContextOptions,
) => Awaitable<ContextValue>;

function createContextBuilder(
	name: string,
	use: readonly AnyContextFactory[],
	ownedFlags: Readonly<FlagsDef>,
	sections: readonly CommandSection[],
): ErasedContextBuilder {
	const builder = {
		use: (...factories: readonly AnyContextFactory[]) =>
			createContextBuilder(
				name,
				Object.freeze([...use, ...factories.map(definingOf)]),
				ownedFlags,
				sections,
			),
		// Snapshot and collision-check each call's definitions eagerly, like one combined list.
		flags: (record: unknown) =>
			createContextBuilder(
				name,
				use,
				Object.freeze(toFlagsRecord(flagRecordEntries(record), ownedFlags)),
				sections,
			),
		sections: (...inputs: readonly RuntimeCommandSectionInput[]) =>
			createContextBuilder(
				name,
				use,
				ownedFlags,
				Object.freeze([...sections, ...validateCommandSections(name, inputs, "context")]),
			),
		setup: (setup: ErasedContextSetup) =>
			createContextFactory(name, use, ownedFlags, sections, setup),
	};
	// SAFETY: public signatures check inputs; the erased setup receives exactly (input, options).
	return Object.freeze(builder) as ErasedContextBuilder;
}

function createContextFactory(
	name: string,
	use: readonly AnyContextFactory[],
	ownedFlags: Readonly<FlagsDef>,
	sections: readonly CommandSection[],
	setup: ErasedContextSetup,
): AnyContextFactory {
	const instance = (
		instanceUse: readonly AnyContextFactory[],
		run: AnyContextInstance["setup"],
	): AnyContextInstance => {
		const value = { name, ownedFlags, sections, use: instanceUse, factory: sealed, setup: run };
		// SAFETY: seal installs the private defining proof before this runtime value is erased.
		return seal(value) as AnyContextInstance;
	};
	const factory = (options?: ErasedContextOptions): AnyContextInstance =>
		instance(use, (input) => setup(input, options));
	factory.contextName = name;
	factory.use = use;
	factory.ownedFlags = ownedFlags;
	factory.of = (value: ContextValue): AnyContextInstance =>
		instance(Object.freeze([]), () => value);
	// SAFETY: the mutable factory is fully populated before widening to the runtime registry type.
	const sealed = seal(factory) as AnyContextFactory;
	return sealed;
}

/**
 * Start an immutable fluent Context definition: a named, lazy command
 * dependency. Chain `.use()`, `.flags()`, and `.sections()`, then `.setup()` for the factory.
 */
export function defineContext<Name extends string>(name: Name): ContextBuilder<Name> {
	// SAFETY: the builder's public signatures carry the phantoms the erased runtime handle drops.
	return createContextBuilder(
		name,
		Object.freeze([]),
		Object.freeze({}),
		Object.freeze([]),
	) as ContextBuilder<Name>;
}

export type FactoryValueOf<F extends AnyContextFactory> =
	F extends ContextFactory<any, any, infer Value, any, any> ? Awaited<Value> : never;
