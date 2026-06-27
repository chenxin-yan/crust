export type ContextMap = Record<string, unknown>;
export type Awaitable<T> = T | Promise<T>;
export type Simplify<T> = { [K in keyof T]: T[K] };
export type MergeContext<A, B> = Simplify<A & B>;
export type ContextOutput<S> =
	S extends ContextInstance<infer Name, infer Value, infer _Deps>
		? { [K in Name]: Awaited<Value> }
		: never;

export interface ContextInstance<
	Name extends string = string,
	Value = unknown,
	Deps extends ContextMap = ContextMap,
> {
	readonly kind: "context";
	readonly name: Name;
	setup(context: Readonly<Deps>): Awaitable<Value>;
}

export interface ContextFactory<
	Name extends string,
	Options,
	Value,
	Deps extends ContextMap = ContextMap,
> {
	(options: Options): ContextInstance<Name, Value, Deps>;
}

export function context<Name extends string, Value>(
	name: Name,
	setup: () => Awaitable<Value>,
): ContextInstance<Name, Value, {}>;
export function context<Name extends string, Options, Value, Deps extends ContextMap = ContextMap>(
	name: Name,
	setup: (options: Options, context: Readonly<Deps>) => Awaitable<Value>,
): ContextFactory<Name, Options, Value, Deps>;
export function context<Name extends string, Options, Value, Deps extends ContextMap = ContextMap>(
	name: Name,
	setup:
		| (() => Awaitable<Value>)
		| ((options: Options, context: Readonly<Deps>) => Awaitable<Value>),
): any {
	if (setup.length === 0) {
		return {
			kind: "context" as const,
			name,
			setup: () => (setup as () => Awaitable<Value>)(),
		} satisfies ContextInstance<Name, Value, {}>;
	}

	return (options: Options) =>
		({
			kind: "context" as const,
			name,
			setup: (context: Readonly<Deps>) =>
				(setup as (options: Options, context: Readonly<Deps>) => Awaitable<Value>)(
					options,
					context,
				),
		}) satisfies ContextInstance<Name, Value, Deps>;
}

export async function buildContexts(contexts: readonly ContextInstance[]): Promise<ContextMap> {
	const context: ContextMap = {};
	for (const item of contexts) {
		context[item.name] = await item.setup(context);
	}
	return context;
}
