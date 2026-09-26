import { type AnyContextFactory, type ContextFactory, defineContext } from "@crustjs/core";
import { Context, Effect, Exit, Layer, Scope } from "effect";

import { unwrapExit } from "./errors.ts";

declare const LayerBrand: unique symbol;

/** A built Effect `Context.Context` produced by {@link layer}; the brand is type-only. */
export type LayerValue<S> = Context.Context<S> & { readonly [LayerBrand]: true };

/** Factories created by {@link layer}, matched by identity so a same-named plain Context never counts. */
export const layerFactories: WeakSet<AnyContextFactory> = new WeakSet();

/**
 * Handler outcome per built Context, keyed by identity so nothing leaks across
 * invocations or applications. `Scope.close` hands it to finalizers, which may
 * branch on success versus failure/interruption (commit versus rollback).
 */
export const actionExits: WeakMap<
	Context.Context<any>,
	Exit.Exit<unknown, unknown>
> = new WeakMap();

/**
 * Turn one fully composed Layer into a Crust Context whose value is the built
 * `Context.Context`. Every `layer()` on the command path is built when a
 * `handler()` action starts and released, in reverse order, by Crust's
 * invocation cleanup.
 */
export function layer<Name extends string, ROut, E>(
	name: Name,
	live: Layer.Layer<ROut, E>,
): ContextFactory<Name, void, LayerValue<ROut>> {
	const factory = defineContext(name).setup(
		async ({ defer, signal }): Promise<LayerValue<ROut>> => {
			const scope = Scope.makeUnsafe();
			let built: Context.Context<ROut> | undefined;
			// Registered before building so a partially built layer still releases.
			// Exit.void covers Contexts pulled without a handler() having run.
			defer(() =>
				Effect.runPromise(Scope.close(scope, (built && actionExits.get(built)) ?? Exit.void)),
			);
			built = unwrapExit(
				await Effect.runPromiseExit(Layer.buildWithScope(live, scope), { signal }),
			);
			// SAFETY: the brand exists only at the type level to mark handler-provided services.
			return built as LayerValue<ROut>;
		},
	);
	layerFactories.add(factory);
	return factory;
}
