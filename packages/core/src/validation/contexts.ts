import type { ContextInstance, ContextMap } from "../api/context.ts";
import { CrustError } from "../errors.ts";
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

// ────────────────────────────────────────────────────────────────────────────
// Runtime validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validate one incoming Context instance against those already provided on
 * the command path. The type system already rejects both misuses; this
 * catches plain-JS callers.
 */
export function validateIncomingContext(
	instance: ContextInstance,
	existing: readonly ContextInstance[],
): void {
	// Catches plain-JS misuse, most commonly passing the factory instead
	// of an instance (.provide(db) instead of .provide(db())).
	if ((instance as Partial<ContextInstance> | null)?.kind !== "context") {
		throw new CrustError(
			"DEFINITION",
			"provide() requires Context instances — invoke the factory returned by defineContext() (e.g. .provide(db(options)))",
			{ subject: "context", reason: "not-a-context" },
		);
	}
	if (existing.some((entry) => entry.name === instance.name)) {
		throw new CrustError(
			"DEFINITION",
			`Context "${instance.name}" is already provided on this command path`,
			{
				subject: "context",
				name: instance.name,
				reason: "duplicate-context",
			},
		);
	}
}
