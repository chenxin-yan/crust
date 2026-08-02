export type ContextMap = Record<string, unknown>;
export type Awaitable<T> = T | Promise<T>;
export type Simplify<T> = { [K in keyof T]: T[K] };
export type MergeContext<A, B> = Simplify<A & B>;
export type ContextOutput<S> =
	S extends ContextInstance<infer Name, infer Value> ? { [K in Name]: Awaited<Value> } : never;

/**
 * A named command dependency produced by invoking a Context factory.
 * Attach with `.provide()`; the value is constructed only when the
 * resolved command path executes.
 */
export interface ContextInstance<Name extends string = string, Value = unknown> {
	readonly kind: "context";
	readonly name: Name;
	setup(): Awaitable<Value>;
}

export interface ContextFactory<Name extends string, Options, Value> {
	(options: Options): ContextInstance<Name, Value>;
}

/** @internal — a Context value derived from earlier values on the command path. */
export interface DerivedContextInstance<Name extends string = string, Value = unknown> {
	readonly kind: "derive";
	readonly name: Name;
	setup(input: { ctx: Readonly<ContextMap> }): Awaitable<Value>;
}

/** @internal — one registration-ordered Context construction entry. */
export type ContextEntry = ContextInstance | DerivedContextInstance;

/**
 * Define a Context — a named command dependency.
 *
 * Always returns a factory that must be invoked, including zero-option
 * setups, so the API reads uniformly as
 * `defineContext("db", factory)` → `.provide(db(options))` → `ctx.db`.
 *
 * Factories receive only their options. Cleanup belongs to the value
 * itself: implement `Symbol.dispose` or `Symbol.asyncDispose` and Core
 * disposes constructed values in reverse order after success or failure.
 */
export function defineContext<Name extends string, Value, Options = void>(
	name: Name,
	setup: (options: Options) => Awaitable<Value>,
): ContextFactory<Name, Options, Value> {
	return (options: Options) => ({
		kind: "context" as const,
		name,
		setup: () => setup(options),
	});
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
 * Construct Context values in registration order, registering disposable
 * values on `disposal` so they are torn down in reverse construction order.
 */
export async function buildContexts(
	contexts: readonly ContextEntry[],
	disposal: AsyncDisposableStack,
): Promise<ContextMap> {
	const values: ContextMap = {};
	for (const item of contexts) {
		const value = await (item.kind === "derive" ? item.setup({ ctx: values }) : item.setup());
		values[item.name] = value;
		registerDisposable(value, disposal);
	}
	return values;
}
