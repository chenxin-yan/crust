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

/** Context capabilities required from the command path. */
export type ContextRequirements = readonly AnyContextFactory[];

/** Context definition config: owned flags plus required capabilities. */
export interface ContextConfig {
	readonly flags?: readonly NamedFlagDef[];
	readonly requires?: ContextRequirements;
}

type ValidateContextConfig<R extends ContextConfig> = {
	readonly flags?: R["flags"] extends readonly NamedFlagDef[]
		? ValidateNamedFlagDefs<R["flags"]>
		: never;
};

/** The runtime input every Context setup receives (typed per-factory by `defineContext`). */
interface ContextSetupInput<
	OF extends FlagsDef = FlagsDef,
	RC extends ContextMap = ContextMap,
> extends InvocationIO {
	readonly flags: InferFlags<OF>;
	readonly ctx: Readonly<RC>;
}

/**
 * A named command dependency produced by invoking a Context factory.
 * Attach with `.provide()`; the value is constructed only when the
 * resolved command requires it.
 *
 * Generic parameter `RC` carries the declared Context requirements.
 */
export interface ContextInstance<
	Name extends string = string,
	Value = unknown,
	RC extends ContextMap = {},
	OF extends FlagsDef = {},
> {
	readonly kind: "context";
	readonly name: Name;
	/** @internal — declared capability names (topological ordering) */
	readonly requiredCtx: readonly string[];
	/** @internal — flags installed by this Context at its provide site */
	readonly ownedFlags: FlagsDef;
	/** @internal */
	setup(input: ContextSetupInput<OF, RC>): Awaitable<Value>;
	/** @internal — phantom carrying requirement and ownership types */
	readonly _requires?: { ctx: RC; ownedFlags: OF };
}

/** The typed setup input for one Context factory. */
export interface ContextSetup<
	Options,
	RC extends ContextMap,
	OF extends FlagsDef = {},
> extends InvocationIO {
	/** The factory argument */
	readonly options: Options;
	/** Validated parsed flags owned by this Context. */
	readonly flags: InferFlags<OF>;
	/** Values of the declared capability dependencies */
	readonly ctx: Readonly<RC>;
}

export interface ContextFactory<
	Name extends string,
	Options,
	Value,
	RC extends ContextMap = {},
	OF extends FlagsDef = {},
> {
	(options: Options): ContextInstance<Name, Value, RC, OF>;
	/** The Context name this factory produces (used by `use()` and Context `requires`). */
	readonly contextName: Name;
	/**
	 * Produce an instance whose setup returns the precomputed `value`
	 * (requirements considered satisfied/absent) — for test doubles.
	 */
	of(value: Value): ContextInstance<Name, Value, {}, OF>;
}

export type AnyContextFactory = ContextFactory<string, any, any, any, any>;

export type ContextOutput<C> =
	C extends ContextInstance<infer Name, infer Value, any, any>
		? { [K in Name]: Awaited<Value> }
		: never;

/** Merged outputs of a tuple of Context instances (as attached by one `.provide()` call). */
export type ContextsOutput<Cs extends readonly ContextInstance[]> = Cs extends readonly [
	infer H,
	...infer T extends readonly ContextInstance[],
]
	? ContextOutput<H> & ContextsOutput<T>
	: {};

type FactoryOutput<F> =
	F extends ContextFactory<infer Name, any, infer Value, any, any>
		? { [K in Name]: Awaited<Value> }
		: never;

/** Merged outputs of a tuple of Context factories (as declared in `requires`). */
export type FactoriesOutput<Fs extends readonly AnyContextFactory[]> = Fs extends readonly [
	infer H,
	...infer T extends readonly AnyContextFactory[],
]
	? FactoryOutput<H> & FactoriesOutput<T>
	: {};

/** Merged flags owned by a tuple of Context instances. */
export type ContextsOwnedFlags<Cs extends readonly ContextInstance[]> = Cs extends readonly [
	infer H,
	...infer T extends readonly ContextInstance[],
]
	? MergeFlags<ContextOwnedFlags<H>, ContextsOwnedFlags<T>>
	: {};

type ContextOwnedFlags<C> = C extends ContextInstance<any, any, any, infer OF> ? OF : {};

/** @internal — flags owned by a Context config, as a record. */
export type OwnedFlagsOf<R extends ContextConfig> = R extends {
	flags: infer F extends readonly NamedFlagDef[];
}
	? NamedFlagsRecord<F>
	: {};

/** @internal — merged capability outputs from a config's `requires` array. */
export type RequirementCtxOf<R extends { readonly requires?: ContextRequirements }> = R extends {
	requires: infer C extends readonly AnyContextFactory[];
}
	? FactoriesOutput<C>
	: {};

/**
 * Define a Context — a named command dependency.
 *
 * Always returns a factory that must be invoked, including zero-option
 * setups, so the API reads uniformly as
 * `defineContext("db", factory)` → `.provide(db(options))` → `await ctx.use(db)`.
 *
 * With a config argument, `flags` installs flags owned by the Context at
 * `.provide()`, while `requires` declares Context capabilities from the command
 * path. Setup receives the validated owned flags, declared Context values (`ctx`),
 * and the invocation's injectable output callbacks. Dependencies drive construction
 * order: Contexts the resolved command requires are constructed topologically, regardless of
 * `.provide()` order.
 *
 * Cleanup belongs to the value itself: implement `Symbol.dispose` or
 * `Symbol.asyncDispose` and Core disposes constructed values in reverse
 * construction order after success or failure.
 */
export function defineContext<Name extends string, Value, Options = void>(
	name: Name,
	setup: (input: ContextSetup<Options, {}>) => Awaitable<Value>,
): ContextFactory<Name, Options, Value>;
export function defineContext<
	Name extends string,
	const R extends ContextConfig,
	Value,
	Options = void,
>(
	name: Name,
	config: R & ValidateContextConfig<R>,
	setup: (input: ContextSetup<Options, RequirementCtxOf<R>, OwnedFlagsOf<R>>) => Awaitable<Value>,
): ContextFactory<Name, Options, Value, RequirementCtxOf<R>, OwnedFlagsOf<R>>;
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
	const requiredCtx = (config.requires ?? []).map((dep) => dep.contextName);

	const factory = (options: unknown): ContextInstance => ({
		kind: "context",
		name,
		requiredCtx,
		ownedFlags,
		setup: (input) => setup({ options, ...input } as never),
	});
	factory.contextName = name;
	factory.of = (value: unknown): ContextInstance => ({
		kind: "context",
		name,
		requiredCtx: [],
		ownedFlags,
		setup: () => value,
	});
	return factory as AnyContextFactory;
}

export type FactoryValueOf<F extends AnyContextFactory> =
	F extends ContextFactory<any, any, infer Value, any, any> ? Awaited<Value> : never;

/** Pull-based resolver for provided Contexts, exposed to actions as `ctx`. */
export interface ContextResolver {
	readonly use: <F extends AnyContextFactory>(factory: F) => Promise<FactoryValueOf<F>>;
}

function registerDisposable(value: unknown, disposal: AsyncDisposableStack): void {
	if (value === null || (typeof value !== "object" && typeof value !== "function")) {
		return;
	}
	const candidate = value as {
		[Symbol.dispose]?: () => void;
		[Symbol.asyncDispose]?: () => PromiseLike<void>;
	};
	if (
		typeof candidate[Symbol.asyncDispose] === "function" ||
		typeof candidate[Symbol.dispose] === "function"
	) {
		disposal.use(candidate as Disposable | AsyncDisposable);
	}
}

/** Create the lazy, invocation-scoped Context resolver used by actions and hooks. */
export function createContextResolver(
	contexts: readonly ContextInstance[],
	io: InvocationIO,
	disposal: AsyncDisposableStack,
): ContextResolver & { setValidatedFlags(flags: Record<string, unknown>): void } {
	const byName = new Map(contexts.map((context) => [context.name, context]));
	const values = new Map<string, Promise<unknown>>();
	let validatedFlags: Record<string, unknown> | undefined;

	// Cycles are rejected at .provide() time, so the recursion terminates.
	const closureOwnsFlags = (context: ContextInstance): boolean =>
		Object.keys(context.ownedFlags).length > 0 ||
		context.requiredCtx.some((name) => closureOwnsFlags(byName.get(name)!));

	const resolve = (context: ContextInstance): Promise<unknown> => {
		const existing = values.get(context.name);
		if (existing) return existing;

		const pending = (async () => {
			const ctx: ContextMap = {};
			for (const name of context.requiredCtx) {
				ctx[name] = await resolve(byName.get(name)!);
			}
			const ownedFlags = Object.fromEntries(
				Object.keys(context.ownedFlags).map((name) => [name, validatedFlags?.[name]]),
			);
			const value = await context.setup({ flags: ownedFlags, ctx, ...io });
			registerDisposable(value, disposal);
			return value;
		})();
		values.set(context.name, pending);
		return pending;
	};

	return {
		use: <F extends AnyContextFactory>(factory: F): Promise<FactoryValueOf<F>> => {
			const name = factory.contextName;
			const context = byName.get(name);
			if (!context) {
				return Promise.reject(
					new CrustError(
						"DEFINITION",
						`No provider for Context "${name}". Add .provide(${name}(...)) to the app or an ancestor command.`,
						{ subject: "context", name, reason: "missing-context" },
					),
				);
			}
			if (validatedFlags === undefined && closureOwnsFlags(context)) {
				return Promise.reject(
					new CrustError(
						"DEFINITION",
						`Context "${name}" owns flags and cannot be pulled before flag validation. Pull it from an action or a postRun hook after a validated invocation.`,
						{ subject: "context", name, reason: "flags-before-validation" },
					),
				);
			}
			return resolve(context) as Promise<FactoryValueOf<F>>;
		},
		setValidatedFlags(flags: Record<string, unknown>): void {
			validatedFlags = flags;
		},
	};
}
