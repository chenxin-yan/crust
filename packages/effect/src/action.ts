import { type CrustCommandContext, CrustError } from "@crustjs/core";
import { Context, Effect } from "effect";

import { actionExits, type EffectContextFactory } from "./context.ts";
import { unwrapExit } from "./errors.ts";

type ServicesOfFactory<F> = F extends EffectContextFactory<string, infer S> ? S : never;

/** Union of the services built by the given Effect Context factories. */
export type ServicesOf<Factories extends readonly EffectContextFactory[]> = ServicesOfFactory<
	Factories[number]
>;

type ActionInput = CrustCommandContext<any, any, any>;

/**
 * Adapt an Effect-returning function to a Crust action. Services from the
 * listed {@link effectContext} factories are pulled from `ctx` and provided;
 * a failure rethrows the original error so `execute()` renders it unchanged,
 * and interruption rethrows an `AbortError` so cancellation exits with 130.
 */
export function effectAction<Input extends ActionInput, Out, E>(
	fn: (input: Input) => Effect.Effect<Out, E>,
): (input: Input) => Promise<Out>;
export function effectAction<
	Input extends ActionInput,
	Out,
	E,
	const Factories extends readonly EffectContextFactory[],
>(
	contexts: Factories,
	fn: (input: Input) => Effect.Effect<Out, E, ServicesOf<Factories>>,
): (input: Input) => Promise<Out>;
export function effectAction<Input extends ActionInput, Out, E>(
	contextsOrFn: readonly EffectContextFactory[] | ((input: Input) => Effect.Effect<Out, E, any>),
	maybeFn?: (input: Input) => Effect.Effect<Out, E, any>,
): (input: Input) => Promise<Out> {
	type Fn = (input: Input) => Effect.Effect<Out, E, any>;
	const [contexts, fn]: [readonly EffectContextFactory[], Fn] = Array.isArray(contextsOrFn)
		? [contextsOrFn, maybeFn!]
		: // SAFETY: the overloads only admit a function when no factory array is passed.
			[[], contextsOrFn as Fn];
	return async (input) => {
		const bag: Readonly<Record<string, Promise<Context.Context<unknown>>>> = input.ctx;
		const built = await Promise.all(contexts.map(({ contextName }) => pull(bag, contextName)));
		const exit = await Effect.runPromiseExit(
			Effect.provideContext(fn(input), Context.mergeAll(...built)),
		);
		for (const services of built) actionExits.set(services, exit);
		return unwrapExit(exit);
	};
}

/** Names outside the command path never reach the bag, so Core's missing-provider error is raised here. */
function pull(
	bag: Readonly<Record<string, Promise<Context.Context<unknown>>>>,
	name: string,
): Promise<Context.Context<unknown>> {
	if (Object.hasOwn(bag, name)) return bag[name]!;
	return Promise.reject(
		new CrustError(
			"DEFINITION",
			`No provider for Context "${name}". Add .provide(${name}(...)) to the app or an ancestor command.`,
			{ subject: "context", name, reason: "missing-context" },
		),
	);
}
