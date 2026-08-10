import type { ContextInstance, ContextMap } from "../api/context.ts";
import type { DefName, Overlap } from "./shared.ts";

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

/** Canonical names claimed by more than one instance in the same `.provide()` call. */
type DuplicateContextNames<
	Cs extends readonly ContextInstance[],
	Seen extends string = never,
> = Cs extends readonly [infer Head, ...infer Tail extends readonly ContextInstance[]]
	? (DefName<Head> & Seen) | DuplicateContextNames<Tail, Seen | DefName<Head>>
	: never;

type DuplicateContextBrand<C, Existing extends string> =
	Overlap<DefName<C>, Existing> extends infer Duplicate extends string
		? [Duplicate] extends [never]
			? {}
			: {
					readonly FIX_DUPLICATE_CONTEXT: `Context "${Duplicate}" is already provided on this command path`;
				}
		: never;

/**
 * Brand instances whose name is already provided on this builder chain or
 * repeated within the same `.provide()` call. The accumulated Context value
 * map doubles as the name registry (its keys are the provided names), so no
 * separate accumulator is needed — and unlike the `Deps` graph, wrappers
 * generic over the builder type it as `any`, which opts out via the
 * `string extends keyof Ctx` guard instead of deferring. Widened names opt
 * out via `DefName`; a parent-provided Context that the definition does not
 * `requires` stays runtime-only because it is not in `Ctx`.
 */
export type ValidateContextNames<
	Ctx extends ContextMap,
	Cs extends readonly ContextInstance[],
	// Hoisted invariants — computed once per call, not per element.
	Existing extends string = string extends keyof Ctx ? never : keyof Ctx & string,
	Dups extends string = DuplicateContextNames<Cs>,
> = {
	[I in keyof Cs]: Cs[I] & DuplicateContextBrand<Cs[I], Existing | Dups>;
};

// ────────────────────────────────────────────────────────────────────────────
