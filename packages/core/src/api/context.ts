import { CrustError } from "../errors.ts";
import { toFlagsRecord } from "../parsing/spellings.ts";
import { validateCommandSections } from "../sections.ts";
import type {
	Awaitable,
	CommandSection,
	FlagsDef,
	InferFlags,
	InvocationIO,
	MergeFlags,
	MergeProviders,
	NamedFlagDef,
	RuntimeCommandSectionInput,
} from "../types.ts";
import type { LocalSectionsBrand } from "../validation/commands.brands.ts";
import type {
	AttachedFlags,
	AttachedSpellings,
	ContextOwnedFlags,
	ValidateLocalFlagDefs,
} from "../validation/flags.brands.ts";
import type {
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
> extends Defining<ContextInstance<Name, Value, OF, Deps>> {
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
}

/** @internal Existential registry constraint; never evidence for trusted attachment. */
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
> extends Defining<ContextFactory<Name, Options, Value, OF, Deps>> {
	/** Options may be omitted when their type accepts `undefined` (including no-option `void`). */
	(
		...options: undefined extends Options ? [options?: Options] : [options: Options]
	): ContextInstance<Name, Value, OF, Deps>;
	readonly contextName: Name;
	/** @internal — declared direct dependency factories */
	readonly use: readonly AnyContextFactory[];
	of(value: Value): ContextInstance<Name, Value, OF, {}>;
	readonly _deps?: Deps;
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

export type ContextsOutput<Cs extends readonly AnyContextInstance[]> =
	IsStaticTuple<Cs> extends true
		? Cs extends readonly [infer H, ...infer T extends readonly AnyContextInstance[]]
			? MergeProviders<ContextOutput<H>, ContextsOutput<T>>
			: {}
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

export type ContextsOwnedFlags<Cs extends readonly AnyContextInstance[]> =
	IsStaticTuple<Cs> extends true
		? Cs extends readonly [infer H, ...infer T extends readonly AnyContextInstance[]]
			? MergeFlags<ContextOwnedFlags<H>, ContextsOwnedFlags<T>>
			: {}
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

type FactoriesOutput<Fs extends readonly AnyContextFactory[]> = Fs extends readonly [
	infer H,
	...infer T extends readonly AnyContextFactory[],
]
	? FactoryOutput<H> & FactoriesOutput<T>
	: {};

type FactoryDeps<F> = F extends AnyContextFactory
	? DefiningOf<F> extends ContextFactory<any, any, any, any, infer Deps>
		? Deps
		: {}
	: {};
type FactoriesDeps<Fs extends readonly AnyContextFactory[]> = Fs extends readonly [
	infer H,
	...infer T extends readonly AnyContextFactory[],
]
	? FactoryDeps<H> & FactoriesDeps<T>
	: {};

export type ContextDependencies<Use extends readonly AnyContextFactory[]> =
	IsStaticTuple<Use> extends true
		? FactoriesOutput<Use> & FactoriesDeps<Use>
		: Record<string, ContextValue>;

export type ContextDepsOf<C> = C extends AnyContextInstance
	? DefiningOf<C> extends { readonly _deps?: infer Deps extends ContextMap }
		? Deps
		: {}
	: {};
export type ContextsDependencies<Cs extends readonly AnyContextInstance[]> = Cs extends readonly [
	infer H,
	...infer T extends readonly AnyContextInstance[],
]
	? ContextDepsOf<H> & ContextsDependencies<T>
	: {};

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
	Defs extends readonly NamedFlagDef[] = [],
> {
	/** Declare Contexts setup reads from `ctx`; consumers must provide their transitive closure. */
	use<const Fs extends readonly AnyContextFactory[]>(
		...factories: Fs
	): ContextBuilder<Name, readonly [...Use, ...Fs], Defs>;
	/** Own flags parsed wherever this Context is provided; setup reads them from `flags`. */
	flags<const Fs extends readonly NamedFlagDef[]>(
		...defs: ValidateLocalFlagDefs<Fs, AttachedSpellings<Defs>>
	): ContextBuilder<Name, Use, readonly [...Defs, ...Fs]>;
	/** Document only the providing command (the root for Extension-provided Contexts). */
	sections<const S extends readonly RuntimeCommandSectionInput[]>(
		...sections: S & LocalSectionsBrand<{ sections: S }>["sections"]
	): ContextBuilder<Name, Use, Defs>;
	/**
	 * Finish the definition. `setup` runs lazily, once per invocation, when a
	 * consumer first reads the Context. Annotate its optional second parameter to
	 * accept factory options: `.setup((input, options: { url: string }) => …)`.
	 */
	setup<Value, Args extends readonly [options?: unknown] = []>(
		setup: (
			input: ContextSetup<AttachedFlags<Defs>, ContextDependencies<Use>>,
			...args: Args
		) => Awaitable<Value>,
	): ContextFactory<
		Name,
		ContextOptionsOf<Args>,
		Value,
		AttachedFlags<Defs>,
		ContextDependencies<Use>
	>;
}

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
		flags: (...defs: readonly NamedFlagDef[]) =>
			createContextBuilder(name, use, Object.freeze(toFlagsRecord(defs, ownedFlags)), sections),
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
