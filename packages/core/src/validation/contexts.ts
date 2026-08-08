import type { ContextInstance, ContextMap } from "../api/context.ts";
import type { DefName } from "./shared.ts";

// ────────────────────────────────────────────────────────────────────────────
// Compile-time Context dependency cycle detection
// ────────────────────────────────────────────────────────────────────────────

/** Context name → directly required Context names. */
export type ContextDeps = Record<string, string>;

type RequiredNames<C> = C extends {
	readonly _requires?: { ctx: infer RC extends ContextMap };
}
	? string extends keyof RC
		? never
		: keyof RC & string
	: never;

type InstanceDeps<C> =
	DefName<C> extends infer Name extends string
		? [Name] extends [never]
			? {}
			: { [K in Name]: RequiredNames<C> }
		: {};

type ContextsDeps<Cs extends readonly ContextInstance[]> = Cs extends readonly [
	infer Head,
	...infer Tail extends readonly ContextInstance[],
]
	? InstanceDeps<Head> & ContextsDeps<Tail>
	: {};

/** Add the dependency edges carried by a `.provide()` tuple to the accumulated graph. */
export type MergeContextDeps<
	Deps extends ContextDeps,
	Cs extends readonly ContextInstance[],
> = Deps & ContextsDeps<Cs>;

type AnyReachable<
	Deps extends ContextDeps,
	Current extends string,
	Target extends string,
	Seen extends string,
> = Current extends unknown ? Reachable<Deps, Current, Target, Seen> : never;

type Reachable<
	Deps extends ContextDeps,
	Current extends string,
	Target extends string,
	Seen extends string,
> = string extends Current
	? false
	: Current extends Target
		? true
		: Current extends Seen
			? false
			: Current extends keyof Deps
				? true extends AnyReachable<Deps, Deps[Current] & string, Target, Seen | Current>
					? true
					: false
				: false;

type HasCycleFrom<Deps extends ContextDeps, Name extends keyof Deps & string> =
	true extends AnyReachable<Deps, Deps[Name] & string, Name, Name> ? true : false;

type ContextCycleBrand<C, Deps extends ContextDeps> =
	DefName<C> extends infer Name extends string
		? [Name] extends [never]
			? {}
			: [RequiredNames<C>] extends [never]
				? {}
				: string extends keyof Deps
					? {}
					: Name extends keyof Deps
						? HasCycleFrom<Deps, Name> extends true
							? {
									readonly FIX_CONTEXT_CYCLE: `Context "${Name}" forms a dependency cycle`;
								}
							: {}
						: {}
		: {};

/**
 * Validate only the instances introduced by this `.provide()` call against
 * the merged graph. A missing dependency is not a cycle and stays valid so
 * provide order remains free; `sortContexts` checks missing dependencies at run time.
 */
export type ValidateContextCycles<
	Deps extends ContextDeps,
	Cs extends readonly ContextInstance[],
	Merged extends ContextDeps = MergeContextDeps<Deps, Cs>,
> = {
	[I in keyof Cs]: Cs[I] & ContextCycleBrand<Cs[I], Merged>;
};
