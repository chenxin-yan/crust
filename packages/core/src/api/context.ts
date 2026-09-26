import { CrustError, type CaughtError } from "../errors.ts";
import { toFlagsRecord } from "../parsing/spellings.ts";
import type { FlagsDef, InferFlags, InvocationIO, MergeFlags, NamedFlagDef } from "../types.ts";
import type {
	AttachedFlags,
	ContextOwnedFlags,
	ValidateLocalFlagDefs,
} from "../validation/flags.brands.ts";
import type {
	Awaitable,
	MergeProviders,
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

export interface ContextConfig {
	readonly flags?: readonly NamedFlagDef[];
	readonly use?: readonly AnyContextFactory[];
}

type ValidateContextConfig<R extends ContextConfig> = {
	readonly flags?: R["flags"] extends readonly NamedFlagDef[]
		? ValidateLocalFlagDefs<R["flags"], never>
		: "flags" extends keyof R
			? {}
			: never;
	readonly use?: R["use"] extends readonly AnyContextFactory[]
		? R["use"]
		: "use" extends keyof R
			? {}
			: never;
};

interface ContextSetupInput<OF extends FlagsDef = FlagsDef> extends InvocationIO {
	readonly signal: AbortSignal;
	readonly flags: InferFlags<OF>;
	readonly ctx: ContextBag<ContextMap>;
	readonly defer: (cleanup: () => void | PromiseLike<void>) => void;
}

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
	/** @internal — declared direct dependency factories */
	readonly use: readonly AnyContextFactory[];
	/** @internal defining factory, for adapters that identify Contexts by factory */
	readonly factory: AnyContextFactory;
	setup(input: ContextSetupInput<OF>): Awaitable<Value>;
	readonly _ownedFlags?: OF;
	/** @internal — phantom carrying the transitive dependency closure */
	readonly _deps?: Deps;
}

/** @internal Existential registry constraint; never evidence for trusted attachment. */
export type AnyContextInstance = ContextInstance<string, unknown, any, any>;

/** Whatever a Context setup produces, erased at the runtime registry. */
export type ContextValue = Awaited<ReturnType<AnyContextInstance["setup"]>>;

export interface ContextSetup<
	Options,
	OF extends FlagsDef = {},
	Deps extends ContextMap = {},
> extends InvocationIO {
	readonly options: Options;
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
	(options: Options): ContextInstance<Name, Value, OF, Deps>;
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

export type ContextOutput<C> = C extends AnyContextInstance
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
		const name = "contextName" in source ? source.contextName : source.name;
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

export type FactoryOutput<F> = F extends AnyContextFactory
	? DefiningOf<F> extends ContextFactory<infer Name, any, infer Value, any, any>
		? NamedOutput<Name, Value>
		: never
	: never;

export type FactoriesOutput<Fs extends readonly AnyContextFactory[]> = Fs extends readonly [
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

export type OwnedFlagsOf<R extends ContextConfig> = R extends {
	flags: infer F extends readonly NamedFlagDef[];
}
	? AttachedFlags<F>
	: "flags" extends keyof R
		? FlagsDef
		: {};

export type UseOf<R extends ContextConfig> = R extends {
	use: infer Use extends readonly AnyContextFactory[];
}
	? Use
	: "use" extends keyof R
		? readonly AnyContextFactory[]
		: readonly [];

type ErasedContextSetup = (input: never) => Awaitable<ContextValue>;

function isContextSetup(value: ContextConfig | ErasedContextSetup): value is ErasedContextSetup {
	return typeof value === "function";
}

/** Define a named, lazy command dependency. Declared `use` Contexts are exposed on `ctx`. */
export function defineContext<Name extends string, Value, Options = void>(
	name: Name,
	setup: (input: ContextSetup<Options>) => Awaitable<Value>,
): ContextFactory<Name, Options, Value>;
export function defineContext<
	Name extends string,
	const R extends ContextConfig,
	Value,
	Options = void,
>(
	name: Name,
	config: R & ValidateContextConfig<R> & ContextConfig,
	setup: (
		input: ContextSetup<Options, OwnedFlagsOf<R>, ContextDependencies<UseOf<R>>>,
	) => Awaitable<Value>,
): ContextFactory<Name, Options, Value, OwnedFlagsOf<R>, ContextDependencies<UseOf<R>>>;

export function defineContext(
	name: string,
	configOrSetup: ContextConfig | ErasedContextSetup,
	maybeSetup?: ErasedContextSetup,
): AnyContextFactory {
	const hasConfig = !isContextSetup(configOrSetup);
	const config = hasConfig ? configOrSetup : {};
	// Authoring overloads require setup in both call forms.
	const setup = hasConfig ? maybeSetup! : configOrSetup;
	const ownedFlags = Object.freeze(toFlagsRecord(config.flags ?? []));
	const use = Object.freeze((config.use ?? []).map(definingOf));
	const instance = (
		instanceUse: readonly AnyContextFactory[],
		run: AnyContextInstance["setup"],
	): AnyContextInstance => {
		const value = { name, ownedFlags, use: instanceUse, factory: sealed, setup: run };
		// SAFETY: seal installs the private defining proof before this runtime value is erased.
		return seal(value) as AnyContextInstance;
	};
	const factory = (options: Parameters<AnyContextFactory>[0]): AnyContextInstance =>
		instance(use, (input) => {
			// SAFETY: public overloads pair setup with exactly this merged input shape.
			return setup({ options, ...input } as never);
		});
	factory.contextName = name;
	factory.use = use;
	factory.of = (value: ContextValue): AnyContextInstance =>
		instance(Object.freeze([]), () => value);
	// SAFETY: the mutable factory is fully populated before widening to the runtime registry type.
	const sealed = seal(factory) as AnyContextFactory;
	return sealed;
}

export type FactoryValueOf<F extends AnyContextFactory> =
	F extends ContextFactory<any, any, infer Value, any, any> ? Awaited<Value> : never;

/**
 * The slice of `AsyncDisposableStack` invocation disposal actually uses.
 *
 * Typed structurally because the global `AsyncDisposableStack` constructor
 * only exists on Bun, Deno, and Node >= 24 (V8 13.8); on Node 22 invocations
 * run with {@link FallbackAsyncDisposableStack} instead.
 */
export interface DisposalScope {
	use<T extends Disposable | AsyncDisposable>(value: T): T;
	defer(onDisposeAsync: () => void | PromiseLike<void>): void;
}

type DisposeCallback = () => void | PromiseLike<void>;

// Untyped callers can still hand the fallback a non-function at runtime.
function isDisposeCallback(value: DisposeCallback | undefined | null): value is DisposeCallback {
	return typeof value === "function";
}

/**
 * Minimal `AsyncDisposableStack` stand-in for runtimes without the global
 * (Node 22): LIFO disposal of used resources and deferred callbacks,
 * preferring `Symbol.asyncDispose` over `Symbol.dispose`.
 *
 * ponytail: multiple disposal errors aggregate as `AggregateError` instead of
 * the native `SuppressedError` chain; delete this class when Node 22 leaves
 * the support floor.
 *
 * @internal Exported for unit testing and invocation wiring.
 */
export class FallbackAsyncDisposableStack implements DisposalScope, AsyncDisposable {
	#entries: (() => void | PromiseLike<void>)[] = [];
	#disposed = false;

	// Same class of error as the native stack, so a late registration fails loud
	// on every runtime instead of silently leaking here.
	#assertPending(): void {
		if (this.#disposed) throw new ReferenceError("AsyncDisposableStack is already disposed");
	}

	use<T extends Disposable | AsyncDisposable>(value: T): T {
		this.#assertPending();
		const dispose = hasAsyncDispose(value) ? value[Symbol.asyncDispose] : value[Symbol.dispose];
		this.#entries.push(() => dispose.call(value));
		return value;
	}

	defer(onDisposeAsync: () => void | PromiseLike<void>): void {
		this.#assertPending();
		// Native rejects at registration; failing at teardown instead would hide the bug.
		if (!isDisposeCallback(onDisposeAsync)) throw new TypeError("defer callback is not callable");
		this.#entries.push(onDisposeAsync);
	}

	async [Symbol.asyncDispose](): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		const errors: unknown[] = [];
		for (let index = this.#entries.length - 1; index >= 0; index--) {
			try {
				await this.#entries[index]!();
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) throw new AggregateError(errors, "Disposal failed");
	}
}

/**
 * Disposal-stack constructor for the current runtime: the native
 * `AsyncDisposableStack` when the global exists, else the fallback.
 */
// SAFETY: this platform feature has the TC39 constructor shape when present; older runtimes use the fallback.
const NativeDisposalStack = (
	globalThis as { AsyncDisposableStack?: new () => DisposalScope & AsyncDisposable }
).AsyncDisposableStack;
export const DisposalStack: new () => DisposalScope & AsyncDisposable =
	NativeDisposalStack ?? FallbackAsyncDisposableStack;

function hasAsyncDispose(value: Disposable | AsyncDisposable): value is AsyncDisposable {
	// SAFETY: structural property probe; the result is checked before use.
	return typeof (value as Partial<AsyncDisposable>)[Symbol.asyncDispose] === "function";
}

function isDisposableValue(value: ContextValue): value is Disposable | AsyncDisposable {
	if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
	// SAFETY: structural property probe on an object; both properties are checked below.
	const candidate = value as Partial<Disposable & AsyncDisposable>;
	return (
		typeof candidate[Symbol.asyncDispose] === "function" ||
		typeof candidate[Symbol.dispose] === "function"
	);
}

function registerDisposable(
	value: ContextValue,
	disposal: DisposalScope,
	registered: WeakSet<object>,
): void {
	if (!isDisposableValue(value) || registered.has(value)) return;
	// Marked only on actual registration: a bare value returned first must not
	// block disposal when a later setup decorates the same object and returns it.
	registered.add(value);
	disposal.use(value);
}

/** Validated flag values for one invocation, erased to the resolver. */
type ValidatedFlags = InferFlags<FlagsDef>;

export interface ContextResolver {
	bag<Deps extends ContextMap>(
		sources: readonly (AnyContextFactory | AnyContextInstance)[],
	): ContextBag<Deps>;
	setValidatedFlags(flags: ValidatedFlags): void;
	settle(): Promise<void>;
}

/** Internal lazy invocation container. Public consumers receive scoped Context bags. */
export function createContextResolver(
	contexts: readonly AnyContextInstance[],
	io: InvocationIO,
	disposal: DisposalScope,
	signal: AbortSignal,
): ContextResolver {
	interface Entry {
		readonly name: string;
		readonly promise: Promise<ContextValue>;
		readonly resolve: (value: ContextValue) => void;
		readonly reject: (reason?: CaughtError) => void;
		readonly waitingOn: Set<string>;
		settled: boolean;
	}

	const byName = new Map(contexts.map((context) => [context.name, context]));
	const entries = new Map<string, Entry>();
	const registered = new WeakSet<object>();
	let validatedFlags: ValidatedFlags | undefined;
	// Construction closes when settle() finds no in-flight setup; existing entries
	// stay readable until the disposal marker below flips `disposed`.
	let constructing = true;
	let disposed = false;
	// Registered first so it runs last (LIFO): the flag flips only after every
	// Context value has been disposed. onError hooks receiving the same frozen
	// context object then get a clear rejection instead of a resurrected value.
	disposal.defer(() => {
		disposed = true;
	});

	const pathTo = (
		from: Entry,
		target: string,
		visited = new Set<string>(),
	): string[] | undefined => {
		if (from.name === target) return [from.name];
		if (visited.has(from.name)) return undefined;
		visited.add(from.name);
		for (const name of from.waitingOn) {
			const next = entries.get(name);
			if (!next) continue;
			const path = pathTo(next, target, visited);
			if (path) return [from.name, ...path];
		}
		return undefined;
	};

	const isFlagValidationError = (error: CaughtError): boolean => {
		// Setups may wrap the pull rejection (e.g. new Error("...", { cause })); walk
		// the cause chain so the retry-after-validation marker survives wrapping.
		// A throwing `cause` getter must not escape: this runs while settling the
		// entry, and an escape would leave the promise pending for every puller.
		try {
			const seen = new Set<unknown>();
			// SAFETY: structural probe of an arbitrary thrown value; the getter is protected by this try block.
			for (let e = error; e != null && !seen.has(e); e = (e as Partial<{ cause: unknown }>).cause) {
				seen.add(e);
				if (
					e instanceof CrustError &&
					e.code === "DEFINITION" &&
					e.details?.reason === "flags-before-validation"
				) {
					return true;
				}
			}
			return false;
		} catch {
			return false;
		}
	};

	// Bag getters run under enumeration (spread, JSON.stringify, deep-equal)
	// where nothing awaits the result; an early rejection must arrive pre-handled
	// or it crashes the process as an unhandledRejection.
	function handledRejection(reason: CrustError): Promise<never> {
		const rejection = Promise.reject(reason);
		void rejection.catch(() => {});
		return rejection;
	}

	const makePull = (origin: Entry | null) => (name: string) => {
		const originSuffix = origin ? ` (pulled while constructing Context "${origin.name}")` : "";
		if (disposed) {
			return handledRejection(
				new CrustError(
					"DEFINITION",
					`Context "${name}" cannot be pulled from onError because invocation Contexts have already been disposed.`,
					{ subject: "context", name, reason: "context-after-disposal" },
				),
			);
		}
		const context = byName.get(name);
		if (!context) {
			return handledRejection(
				new CrustError(
					"DEFINITION",
					`No provider for Context "${name}". Add .provide(${name}(...)) to the app or an ancestor command.${originSuffix}`,
					{ subject: "context", name, reason: "missing-context" },
				),
			);
		}
		if (!constructing && !entries.has(name)) {
			return handledRejection(
				new CrustError(
					"DEFINITION",
					`Context "${name}" cannot be constructed during invocation cleanup. Read it while setting up the Context whose cleanup needs it.`,
					{ subject: "context", name, reason: "context-during-disposal" },
				),
			);
		}
		if (validatedFlags === undefined && Object.keys(context.ownedFlags).length > 0) {
			return handledRejection(
				new CrustError(
					"DEFINITION",
					`Context "${name}" owns flags and cannot be pulled before flag validation${originSuffix}. Pull it from an action or a postRun hook after a validated invocation.`,
					{ subject: "context", name, reason: "flags-before-validation" },
				),
			);
		}

		let entry = entries.get(name);
		if (!entry) {
			const deferred = Promise.withResolvers<ContextValue>();
			// Transitive cycle failures can reject an internal entry before a caller
			// observes its derived wait promise; keep the raw deferred rejection handled.
			void deferred.promise.catch(() => {});
			entry = {
				name,
				promise: deferred.promise,
				resolve: deferred.resolve,
				reject: deferred.reject,
				waitingOn: new Set(),
				settled: false,
			};
			entries.set(name, entry);
			const current = entry;
			void (async () => {
				try {
					const ownedFlags = Object.fromEntries(
						Object.keys(context.ownedFlags).map((flag) => [flag, validatedFlags?.[flag]]),
					);
					const value = await context.setup({
						// Spread first: injected io is only typed as stdout/stderr, but runtime
						// extras must not shadow the lifecycle fields below.
						...io,
						signal,
						flags: ownedFlags,
						ctx: makeBag(context.use, current),
						defer(cleanup) {
							if (current.settled) {
								throw new CrustError(
									"DEFINITION",
									`Context "${name}" cannot register cleanup after its setup has finished.`,
									{ subject: "context", name, reason: "context-defer-after-setup" },
								);
							}
							disposal.defer(cleanup);
						},
					});
					registerDisposable(value, disposal, registered);
					current.resolve(value);
				} catch (error) {
					if (isFlagValidationError(error)) entries.delete(name);
					current.reject(error);
				} finally {
					current.settled = true;
				}
			})();
		}

		if (origin && !entry.settled) {
			const path = pathTo(entry, origin.name);
			if (path) {
				const cycle = [origin.name, ...path].map((part) => `"${part}"`).join(" -> ");
				return handledRejection(
					new CrustError("DEFINITION", `Context dependency cycle: ${cycle}`, {
						subject: "context",
						name: origin.name,
						reason: "context-cycle",
					}),
				);
			}
			origin.waitingOn.add(name);
			return entry.promise.finally(() => origin.waitingOn.delete(name));
		}
		return entry.promise;
	};

	const makeBag = <Deps extends ContextMap>(
		sources: readonly (AnyContextFactory | AnyContextInstance)[],
		origin: Entry | null,
	): ContextBag<Deps> => {
		const bag: Record<string, Promise<ContextValue>> = {};
		const add = (source: AnyContextFactory | AnyContextInstance): void => {
			const name = "contextName" in source ? source.contextName : source.name;
			if (Object.hasOwn(bag, name)) return;
			Object.defineProperty(bag, name, {
				enumerable: true,
				get: () => makePull(origin)(name),
			});
			// Follow the source's own declared graph: a provided .of() double cuts the
			// *instance* use list, but the bag must match the factory-typed closure so a
			// transitive read fails loud (missing-context) instead of yielding undefined.
			for (const dependency of source.use ?? []) add(dependency);
		};
		for (const source of sources) add(source);
		Object.defineProperty(bag, contextSources, { value: Object.freeze([...sources]) });
		// SAFETY: the loop defines every name reachable from the source dependency closure inferred as Deps.
		return Object.freeze(bag) as ContextBag<Deps>;
	};

	return {
		bag: (sources) => makeBag(sources, null),
		setValidatedFlags(flags: ValidatedFlags): void {
			validatedFlags = flags;
		},
		// Structured teardown: a rejected sibling pull must not abandon an in-flight
		// setup past disposal — a late value would register on a disposed stack and
		// leak. A running setup can start new pulls, so loop until quiescent.
		// This is the drain boundary (single call site: dispatch()'s finally). The
		// close is synchronous with the quiescent check so no fire-and-forget pull
		// can start a setup between it and the disposal scope exit.
		async settle(): Promise<void> {
			for (;;) {
				const pending = [...entries.values()].filter((entry) => !entry.settled);
				if (pending.length === 0) {
					constructing = false;
					return;
				}
				await Promise.allSettled(pending.map((entry) => entry.promise));
			}
		},
	};
}
