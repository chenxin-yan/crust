import { CrustError } from "../errors.ts";
import type {
	FlagDef,
	FlagsDef,
	InferFlags,
	InvocationIO,
	MergeFlags,
	NamedFlagDef,
	NamedFlagsRecord,
} from "../types.ts";
import type { ValidateNamedFlagDefs } from "../validation/flags.brands.ts";

export type ContextMap = Record<string, unknown>;
export type Awaitable<T> = T | Promise<T>;
export type Simplify<T> = { [K in keyof T]: T[K] };
export type MergeContext<A, B> = A & B;

/** Lazy, invocation-scoped Context values. Reading a property starts construction. */
export type ContextBag<Deps extends ContextMap = {}> = {
	readonly [K in keyof Deps]: Promise<Deps[K]>;
};

export interface ContextConfig<
	Uses extends readonly AnyContextFactory[] = readonly AnyContextFactory[],
> {
	readonly flags?: readonly NamedFlagDef[];
	readonly uses?: Uses;
}

type ValidateContextConfig<R extends ContextConfig<any>> = {
	readonly flags?: R["flags"] extends readonly NamedFlagDef[]
		? ValidateNamedFlagDefs<R["flags"]>
		: never;
};

interface ContextSetupInput<OF extends FlagsDef = FlagsDef> extends InvocationIO {
	readonly flags: InferFlags<OF>;
	readonly ctx: ContextBag<ContextMap>;
}

export interface ContextInstance<
	Name extends string = string,
	Value = unknown,
	OF extends FlagsDef = {},
	Deps extends ContextMap = {},
> {
	readonly kind: "context";
	readonly name: Name;
	readonly ownedFlags: FlagsDef;
	/** @internal — declared direct dependency factories */
	readonly uses: readonly AnyContextFactory[];
	setup(input: ContextSetupInput<OF>): Awaitable<Value>;
	readonly _ownedFlags?: OF;
	/** @internal — phantom carrying the transitive dependency closure */
	readonly _deps?: Deps;
}

export interface ContextSetup<
	Options,
	OF extends FlagsDef = {},
	Deps extends ContextMap = {},
> extends InvocationIO {
	readonly options: Options;
	readonly flags: InferFlags<OF>;
	readonly ctx: ContextBag<Deps>;
}

export interface ContextFactory<
	Name extends string,
	Options,
	Value,
	OF extends FlagsDef = {},
	Deps extends ContextMap = {},
> {
	(options: Options): ContextInstance<Name, Value, OF, Deps>;
	readonly contextName: Name;
	/** @internal — declared direct dependency factories */
	readonly uses: readonly AnyContextFactory[];
	of(value: Value): ContextInstance<Name, Value, OF>;
	readonly _deps?: Deps;
}

export type AnyContextFactory = ContextFactory<string, any, any, any, any>;

export type ContextOutput<C> =
	C extends ContextInstance<infer Name, infer Value, any, any>
		? { [K in Name]: Awaited<Value> }
		: never;

export type ContextsOutput<Cs extends readonly ContextInstance[]> = Cs extends readonly [
	infer H,
	...infer T extends readonly ContextInstance[],
]
	? ContextOutput<H> & ContextsOutput<T>
	: {};

export type ContextsOwnedFlags<Cs extends readonly ContextInstance[]> = Cs extends readonly [
	infer H,
	...infer T extends readonly ContextInstance[],
]
	? MergeFlags<ContextOwnedFlags<H>, ContextsOwnedFlags<T>>
	: {};

type ContextOwnedFlags<C> = C extends ContextInstance<any, any, infer OF, any> ? OF : {};

export type FactoryOutput<F> =
	F extends ContextFactory<infer Name, any, infer Value, any, any>
		? { [K in Name]: Awaited<Value> }
		: never;

export type FactoriesOutput<Fs extends readonly AnyContextFactory[]> = Fs extends readonly [
	infer H,
	...infer T extends readonly AnyContextFactory[],
]
	? FactoryOutput<H> & FactoriesOutput<T>
	: {};

type FactoryDeps<F> = F extends ContextFactory<any, any, any, any, infer Deps> ? Deps : {};
type FactoriesDeps<Fs extends readonly AnyContextFactory[]> = Fs extends readonly [
	infer H,
	...infer T extends readonly AnyContextFactory[],
]
	? FactoryDeps<H> & FactoriesDeps<T>
	: {};

export type ContextDependencies<Uses extends readonly AnyContextFactory[]> = FactoriesOutput<Uses> &
	FactoriesDeps<Uses>;

export type ContextDepsOf<C> = C extends ContextInstance<any, any, any, infer Deps> ? Deps : {};
export type ContextsDependencies<Cs extends readonly ContextInstance[]> = Cs extends readonly [
	infer H,
	...infer T extends readonly ContextInstance[],
]
	? ContextDepsOf<H> & ContextsDependencies<T>
	: {};

export type OwnedFlagsOf<R extends ContextConfig<any>> = R extends {
	flags: infer F extends readonly NamedFlagDef[];
}
	? NamedFlagsRecord<F>
	: {};

type UsesOf<R extends ContextConfig<any>> = R extends {
	uses: infer Uses extends readonly AnyContextFactory[];
}
	? Uses
	: readonly [];

/** Define a named, lazy command dependency. Declared `uses` are exposed on `ctx`. */
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
	config: R & ValidateContextConfig<R>,
	setup: (
		input: ContextSetup<Options, OwnedFlagsOf<R>, ContextDependencies<UsesOf<R>>>,
	) => Awaitable<Value>,
): ContextFactory<Name, Options, Value, OwnedFlagsOf<R>, ContextDependencies<UsesOf<R>>>;
export function defineContext(
	name: string,
	configOrSetup: ContextConfig<any> | ((input: never) => unknown),
	maybeSetup?: (input: never) => unknown,
): AnyContextFactory {
	const hasConfig = typeof configOrSetup !== "function";
	const config = hasConfig ? configOrSetup : {};
	const setup = hasConfig ? maybeSetup : configOrSetup;
	const ownedFlags: FlagsDef = {};
	for (const def of config.flags ?? []) {
		const { name: flagName, ...rest } = def;
		ownedFlags[flagName] = rest as FlagDef;
	}
	const uses = Object.freeze([...(config.uses ?? [])]);
	const factory = (options: unknown): ContextInstance => ({
		kind: "context",
		name,
		ownedFlags,
		uses,
		setup: (input) => (setup as (input: never) => unknown)({ options, ...input } as never),
	});
	factory.contextName = name;
	factory.uses = uses;
	factory.of = (value: unknown): ContextInstance => ({
		kind: "context",
		name,
		ownedFlags,
		uses: [],
		setup: () => value,
	});
	return factory as AnyContextFactory;
}

export type FactoryValueOf<F extends AnyContextFactory> =
	F extends ContextFactory<any, any, infer Value, any, any> ? Awaited<Value> : never;

function registerDisposable(
	value: unknown,
	disposal: AsyncDisposableStack,
	registered: WeakSet<object>,
): void {
	if (value === null || (typeof value !== "object" && typeof value !== "function")) {
		return;
	}
	// An alias setup can resolve to another Context's value; registering it twice
	// would double-dispose a non-idempotent Symbol.(async)Dispose.
	if (registered.has(value)) return;
	const candidate = value as {
		[Symbol.dispose]?: () => void;
		[Symbol.asyncDispose]?: () => PromiseLike<void>;
	};
	if (
		typeof candidate[Symbol.asyncDispose] === "function" ||
		typeof candidate[Symbol.dispose] === "function"
	) {
		// Marked only on actual registration: a bare value returned first must not
		// block disposal when a later setup decorates the same object and returns it.
		registered.add(value);
		disposal.use(candidate as Disposable | AsyncDisposable);
	}
}

/** Internal lazy invocation container. Public consumers receive scoped Context bags. */
export function createContextResolver(
	contexts: readonly ContextInstance[],
	io: InvocationIO,
	disposal: AsyncDisposableStack,
): {
	bag<Deps extends ContextMap>(
		sources: readonly (AnyContextFactory | ContextInstance)[],
	): ContextBag<Deps>;
	setValidatedFlags(flags: Record<string, unknown>): void;
	settle(): Promise<void>;
} {
	interface Entry {
		readonly name: string;
		readonly promise: Promise<unknown>;
		readonly resolve: (value: unknown) => void;
		readonly reject: (reason?: unknown) => void;
		readonly waitingOn: Set<string>;
		settled: boolean;
	}

	const byName = new Map(contexts.map((context) => [context.name, context]));
	const entries = new Map<string, Entry>();
	const registered = new WeakSet<object>();
	let validatedFlags: Record<string, unknown> | undefined;
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

	const isFlagValidationError = (error: unknown): boolean => {
		// Setups may wrap the pull rejection (e.g. new Error("...", { cause })); walk
		// the cause chain so the retry-after-validation marker survives wrapping.
		// A throwing `cause` getter must not escape: this runs while settling the
		// entry, and an escape would leave the promise pending for every puller.
		try {
			const seen = new Set<unknown>();
			for (let e = error; e != null && !seen.has(e); e = (e as { cause?: unknown }).cause) {
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

	const makePull =
		(origin: Entry | null) =>
		(name: string): Promise<unknown> => {
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
				const deferred = Promise.withResolvers<unknown>();
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
							flags: ownedFlags,
							ctx: makeBag(context.uses, current),
							...io,
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
		sources: readonly (AnyContextFactory | ContextInstance)[],
		origin: Entry | null,
	): ContextBag<Deps> => {
		const bag: Record<string, Promise<unknown>> = {};
		const add = (source: AnyContextFactory | ContextInstance): void => {
			const name = "contextName" in source ? source.contextName : source.name;
			if (Object.hasOwn(bag, name)) return;
			Object.defineProperty(bag, name, {
				enumerable: true,
				get: () => makePull(origin)(name),
			});
			// Follow the source's own declared graph: a provided .of() double cuts the
			// *instance* uses, but the bag must match the factory-typed closure so a
			// transitive read fails loud (missing-context) instead of yielding undefined.
			for (const dependency of source.uses ?? []) add(dependency);
		};
		for (const source of sources) add(source);
		return Object.freeze(bag) as ContextBag<Deps>;
	};

	return {
		bag: (sources) => makeBag(sources, null),
		setValidatedFlags(flags: Record<string, unknown>): void {
			validatedFlags = flags;
		},
		// Structured teardown: a rejected sibling pull must not abandon an in-flight
		// setup past disposal — a late value would register on a disposed stack and
		// leak. A running setup can start new pulls, so loop until quiescent.
		async settle(): Promise<void> {
			for (;;) {
				const pending = [...entries.values()].filter((entry) => !entry.settled);
				if (pending.length === 0) return;
				await Promise.allSettled(pending.map((entry) => entry.promise));
			}
		},
	};
}
