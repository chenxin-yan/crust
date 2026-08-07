import { CrustError } from "../errors.ts";
import { validateIncomingFlag } from "../parsing/flag-validation.ts";
import type {
	FlagDef,
	FlagsDef,
	InferFlags,
	MergeFlags,
	NamedFlagDef,
	NamedFlagsRecord,
	ValidateNamedFlagDefs,
} from "../types.ts";

export type ContextMap = Record<string, unknown>;
export type Awaitable<T> = T | Promise<T>;
export type Simplify<T> = { [K in keyof T]: T[K] };
export type MergeContext<A, B> = Simplify<A & B>;

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
interface ContextSetupInput {
	readonly flags: Record<string, unknown>;
	readonly ctx: Readonly<ContextMap>;
}

/**
 * A named command dependency produced by invoking a Context factory.
 * Attach with `.provide()`; the value is constructed only when the
 * resolved command path executes.
 *
 * Generic parameter `RC` carries the declared Context requirements for
 * compile-time checking at attach sites.
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
	setup(input: ContextSetupInput): Awaitable<Value>;
	/** @internal — phantom carrying requirement and ownership types */
	readonly _requires?: { ctx: RC; ownedFlags: OF };
}

/** The typed setup input for one Context factory. */
export interface ContextSetup<Options, RC extends ContextMap, OF extends FlagsDef = {}> {
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
	/** The Context name this factory produces (used in `requires` arrays). */
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
 * `defineContext("db", factory)` → `.provide(db(options))` → `ctx.db`.
 *
 * With a config argument, `flags` installs flags owned by the Context at
 * `.provide()`, while `requires` declares Context capabilities from the command
 * path. Setup receives the validated owned flags plus declared Context values (`ctx`).
 * Dependencies drive construction order: Contexts on
 * the resolved command path are constructed topologically, regardless of
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
	for (const def of config.flags ?? []) {
		const { name: flagName, ...rest } = def;
		validateIncomingFlag({ name: flagName, def: rest as FlagDef }, ownedFlags, `Context "${name}"`);
		ownedFlags[flagName] = rest as FlagDef;
	}
	const requiredCtx = (config.requires ?? []).map((dep) => dep.contextName);

	const factory = (options: unknown): ContextInstance => ({
		kind: "context",
		name,
		requiredCtx,
		ownedFlags,
		setup: (input) => setup({ options, flags: input.flags, ctx: input.ctx } as never),
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

/**
 * Order Context instances topologically by their declared capability
 * requirements, preserving registration order among independent Contexts.
 *
 * @param where - Attach-site label used in error messages (e.g. the command path)
 * @throws {CrustError} `DEFINITION` on a missing dependency or a dependency cycle
 */
export function sortContexts(
	contexts: readonly ContextInstance[],
	where: string,
): ContextInstance[] {
	const provided = new Set(contexts.map((context) => context.name));
	for (const context of contexts) {
		for (const dep of context.requiredCtx) {
			if (!provided.has(dep)) {
				throw new CrustError(
					"DEFINITION",
					`Context "${context.name}" requires Context "${dep}", which is not provided on ${where}`,
					{
						subject: "context",
						name: context.name,
						reason: "missing-context-dependency",
					},
				);
			}
		}
	}

	const sorted: ContextInstance[] = [];
	const constructed = new Set<string>();
	let remaining = [...contexts];
	while (remaining.length > 0) {
		const ready = remaining.filter((context) =>
			context.requiredCtx.every((dep) => constructed.has(dep)),
		);
		if (ready.length === 0) {
			const names = remaining.map((context) => `"${context.name}"`).join(", ");
			throw new CrustError("DEFINITION", `Contexts ${names} form a dependency cycle on ${where}`, {
				subject: "context",
				reason: "context-cycle",
			});
		}
		for (const context of ready) {
			sorted.push(context);
			constructed.add(context.name);
		}
		remaining = remaining.filter((context) => !constructed.has(context.name));
	}
	return sorted;
}

/**
 * Construct Context values in topological order, registering disposable
 * values on `disposal` so they are torn down in reverse construction order.
 *
 * @param flags - The validated parsed flags of the resolved invocation
 */
export async function buildContexts(
	contexts: readonly ContextInstance[],
	flags: Record<string, unknown>,
	disposal: AsyncDisposableStack,
	where: string,
): Promise<ContextMap> {
	const values: ContextMap = {};
	for (const item of sortContexts(contexts, where)) {
		const ownedFlags = Object.fromEntries(
			Object.keys(item.ownedFlags).map((name) => [name, flags[name]]),
		);
		const value = await item.setup({ flags: ownedFlags, ctx: values });
		values[item.name] = value;
		registerDisposable(value, disposal);
	}
	return values;
}
