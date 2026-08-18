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
import { normalizeFlag } from "../validation/normalize.ts";

export type ContextMap = Record<string, unknown>;
export type Awaitable<T> = T | Promise<T>;
export type Simplify<T> = { [K in keyof T]: T[K] };
// Flat intersection — same rationale as MergeFlags: duplicate context names
// are branded at compile time (FIX_DUPLICATE_CONTEXT) and throw at .provide()
// time, so operands never overlap in valid programs, and
// the intersection keeps chained .provide() calls at constant instantiation
// depth (Simplify<A & B> and mapped merges nested a layer per call).
export type MergeContext<A, B> = A & B;

/** Context definition config: flags owned by the Context. */
export interface ContextConfig {
	readonly flags?: readonly NamedFlagDef[];
}

type ValidateContextConfig<R extends ContextConfig> = {
	readonly flags?: R["flags"] extends readonly NamedFlagDef[]
		? ValidateNamedFlagDefs<R["flags"]>
		: never;
};

/** The runtime input every Context setup receives (typed per-factory by `defineContext`). */
interface ContextSetupInput<OF extends FlagsDef = FlagsDef> extends InvocationIO {
	readonly flags: InferFlags<OF>;
	readonly ctx: ContextResolver;
}

/**
 * A named command dependency produced by invoking a Context factory.
 * Attach with `.provide()`; the value is constructed only when pulled.
 */
export interface ContextInstance<
	Name extends string = string,
	Value = unknown,
	OF extends FlagsDef = {},
> {
	readonly kind: "context";
	readonly name: Name;
	/** @internal — flags installed by this Context at its provide site */
	readonly ownedFlags: FlagsDef;
	/** @internal */
	setup(input: ContextSetupInput<OF>): Awaitable<Value>;
	/** @internal — phantom carrying flag ownership types */
	readonly _ownedFlags?: OF;
}

/** The typed setup input for one Context factory. */
export interface ContextSetup<Options, OF extends FlagsDef = {}> extends InvocationIO {
	/** The factory argument */
	readonly options: Options;
	/** Validated parsed flags owned by this Context. */
	readonly flags: InferFlags<OF>;
	/** Pull-based resolver for provided Contexts. */
	readonly ctx: ContextResolver;
}

export interface ContextFactory<Name extends string, Options, Value, OF extends FlagsDef = {}> {
	(options: Options): ContextInstance<Name, Value, OF>;
	/** The Context name this factory produces (used by `ctx.use()`). */
	readonly contextName: Name;
	/** Produce an instance whose setup returns the precomputed `value` — for test doubles. */
	of(value: Value): ContextInstance<Name, Value, OF>;
}

export type AnyContextFactory = ContextFactory<string, any, any, any>;

export type ContextOutput<C> =
	C extends ContextInstance<infer Name, infer Value, any> ? { [K in Name]: Awaited<Value> } : never;

/** Merged outputs of a tuple of Context instances (as attached by one `.provide()` call). */
export type ContextsOutput<Cs extends readonly ContextInstance[]> = Cs extends readonly [
	infer H,
	...infer T extends readonly ContextInstance[],
]
	? ContextOutput<H> & ContextsOutput<T>
	: {};

/** Merged flags owned by a tuple of Context instances. */
export type ContextsOwnedFlags<Cs extends readonly ContextInstance[]> = Cs extends readonly [
	infer H,
	...infer T extends readonly ContextInstance[],
]
	? MergeFlags<ContextOwnedFlags<H>, ContextsOwnedFlags<T>>
	: {};

type ContextOwnedFlags<C> = C extends ContextInstance<any, any, infer OF> ? OF : {};

/** @internal — flags owned by a Context config, as a record. */
export type OwnedFlagsOf<R extends ContextConfig> = R extends {
	flags: infer F extends readonly NamedFlagDef[];
}
	? NamedFlagsRecord<F>
	: {};

/**
 * Define a Context — a named command dependency.
 *
 * Always returns a factory that must be invoked, including zero-option
 * setups, so the API reads uniformly as
 * `defineContext("db", factory)` → `.provide(db(options))` → `await ctx.use(db)`.
 *
 * With a config argument, `flags` installs flags owned by the Context at
 * `.provide()`. Setup receives the validated owned flags, a pull-based `ctx`
 * resolver, and the invocation's injectable output callbacks. Pull dependencies
 * with `await ctx.use(factory)` before acquiring resources.
 *
 * Cleanup belongs to the value itself: implement `Symbol.dispose` or
 * `Symbol.asyncDispose` and Core disposes constructed values in reverse
 * construction order after success or failure.
 */
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
	setup: (input: ContextSetup<Options, OwnedFlagsOf<R>>) => Awaitable<Value>,
): ContextFactory<Name, Options, Value, OwnedFlagsOf<R>>;
export function defineContext(
	name: string,
	configOrSetup: ContextConfig | ((input: never) => unknown),
	maybeSetup?: (input: never) => unknown,
): AnyContextFactory {
	const hasConfig = typeof configOrSetup !== "function";
	const config = hasConfig ? configOrSetup : {};
	const setup = hasConfig ? maybeSetup : configOrSetup;
	if (typeof setup !== "function") {
		throw new CrustError("DEFINITION", `Context "${name}" requires a setup function`, {
			subject: "context",
			name,
			reason: "missing-setup",
		});
	}

	const ownedFlags: FlagsDef = {};
	const spellings = new Map();
	for (const def of config.flags ?? []) {
		const { name: flagName, ...rest } = def;
		normalizeFlag(
			{ name: flagName, def: rest as FlagDef },
			ownedFlags,
			spellings,
			`Context "${name}"`,
		);
		ownedFlags[flagName] = rest as FlagDef;
	}
	const factory = (options: unknown): ContextInstance => ({
		kind: "context",
		name,
		ownedFlags,
		setup: (input) => setup({ options, ...input } as never),
	});
	factory.contextName = name;
	factory.of = (value: unknown): ContextInstance => ({
		kind: "context",
		name,
		ownedFlags,
		setup: () => value,
	});
	return factory as AnyContextFactory;
}

export type FactoryValueOf<F extends AnyContextFactory> =
	F extends ContextFactory<any, any, infer Value, any> ? Awaited<Value> : never;

/** Pull-based resolver for provided Contexts, exposed to actions, hooks, and Context setup as `ctx`. */
export interface ContextResolver {
	readonly use: <F extends AnyContextFactory>(factory: F) => Promise<FactoryValueOf<F>>;
}

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

/** Create the lazy, invocation-scoped Context resolver used by actions and hooks. */
export function createContextResolver(
	contexts: readonly ContextInstance[],
	io: InvocationIO,
	disposal: AsyncDisposableStack,
): ContextResolver & { setValidatedFlags(flags: Record<string, unknown>): void } {
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

	const makeUse =
		(origin: Entry | null): ContextResolver["use"] =>
		<F extends AnyContextFactory>(factory: F): Promise<FactoryValueOf<F>> => {
			const name = factory.contextName;
			const originSuffix = origin ? ` (pulled while constructing Context "${origin.name}")` : "";
			if (disposed) {
				return Promise.reject(
					new CrustError(
						"DEFINITION",
						`Context "${name}" cannot be pulled from onError because invocation Contexts have already been disposed.`,
						{ subject: "context", name, reason: "context-after-disposal" },
					),
				);
			}
			const context = byName.get(name);
			if (!context) {
				return Promise.reject(
					new CrustError(
						"DEFINITION",
						`No provider for Context "${name}". Add .provide(${name}(...)) to the app or an ancestor command.${originSuffix}`,
						{ subject: "context", name, reason: "missing-context" },
					),
				);
			}
			if (validatedFlags === undefined && Object.keys(context.ownedFlags).length > 0) {
				return Promise.reject(
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
							ctx: { use: makeUse(current) },
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
					return Promise.reject(
						new CrustError("DEFINITION", `Context dependency cycle: ${cycle}`, {
							subject: "context",
							name: origin.name,
							reason: "context-cycle",
						}),
					);
				}
				origin.waitingOn.add(name);
				return entry.promise.finally(() => origin.waitingOn.delete(name)) as Promise<
					FactoryValueOf<F>
				>;
			}
			return entry.promise as Promise<FactoryValueOf<F>>;
		};

	return {
		use: makeUse(null),
		setValidatedFlags(flags: Record<string, unknown>): void {
			validatedFlags = flags;
		},
	};
}
