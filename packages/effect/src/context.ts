import { defineContext, type ContextFactory } from "@crustjs/core";
import { Context, Exit, Layer, Scope } from "effect";

import { runEffect } from "./errors.ts";

/** A Crust Context whose value is a built Effect `Context.Context`, as produced by {@link effectContext}. */
export type EffectContextFactory<Name extends string = string, ROut = any> = ContextFactory<
	Name,
	void,
	Context.Context<ROut>
>;

/**
 * Action outcome per built Context, keyed by identity so nothing leaks across
 * invocations or applications. `Scope.close` hands it to finalizers, which may
 * branch on success versus failure/interruption (commit versus rollback).
 */
export const actionExits: WeakMap<
	Context.Context<any>,
	Exit.Exit<unknown, unknown>
> = new WeakMap();

/**
 * Turn one fully composed Layer into a Crust Context whose value is the built
 * `Context.Context`. Resources are acquired when the Context is first pulled
 * and released, in reverse order, by Crust's invocation cleanup.
 */
export function effectContext<Name extends string, ROut, E>(
	name: Name,
	layer: Layer.Layer<ROut, E>,
): EffectContextFactory<Name, ROut> {
	return defineContext(name, async ({ defer }) => {
		const scope = Scope.makeUnsafe();
		let built: Context.Context<ROut> | undefined;
		// Registered before building so a partially built layer still releases.
		// Exit.void covers Contexts pulled without an Effect action having run.
		defer(() => runEffect(Scope.close(scope, (built && actionExits.get(built)) ?? Exit.void)));
		built = await runEffect(Layer.buildWithScope(layer, scope));
		return built;
	});
}
