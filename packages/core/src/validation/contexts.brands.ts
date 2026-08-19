import type { ContextDepsOf, ContextInstance, ContextMap } from "../api/context.ts";
import type { DefName, Overlap } from "./shared.ts";

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
 * separate accumulator is needed. Wrappers generic over the builder type
 * use `any`, which opts out via the
 * `string extends keyof Ctx` guard instead of deferring. Widened names opt
 * out via `DefName`; a parent-provided Context stays runtime-only because it
 * is not in the definition's `Ctx`.
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

type MissingDependencyBrand<C, Known extends string> =
	Exclude<keyof ContextDepsOf<C> & string, Known> extends infer Missing extends string
		? [Missing] extends [never]
			? {}
			: {
					readonly FIX_MISSING_DEPENDENCY: `Context "${DefName<C>}" uses Context "${Missing}" which is not provided on this command path`;
				}
		: never;

/** Brand provided instances whose transitive dependency closure is unsatisfied. */
export type ValidateContextDeps<
	Ctx extends ContextMap,
	Cs extends readonly ContextInstance[],
	Known extends string =
		| (string extends keyof Ctx ? never : keyof Ctx & string)
		| DefName<Cs[number]>,
> = { [I in keyof Cs]: Cs[I] & MissingDependencyBrand<Cs[I], Known> };

/** Dependency closure carried by command definitions and Extensions. */
type IsAny<T> = 0 extends 1 & T ? true : false;
export type DeclaredDepsOf<T> =
	IsAny<T> extends true
		? {}
		: T extends { readonly _deps?: infer Deps extends ContextMap }
			? IsAny<Deps> extends true
				? {}
				: Deps
			: {};

type MissingDeclaredDependencyBrand<T, Known extends string> =
	Exclude<keyof DeclaredDepsOf<T> & string, Known> extends infer Missing extends string
		? [Missing] extends [never]
			? {}
			: { readonly FIX_MISSING_DEPENDENCY: `Uses Context "${Missing}" which is not provided` }
		: never;

/** Brand sealed units whose declared dependencies are absent at a composition site. */
export type ValidateDeclaredDeps<Ctx extends ContextMap, Items extends readonly unknown[]> = {
	[I in keyof Items]: Items[I] &
		MissingDeclaredDependencyBrand<Items[I], string extends keyof Ctx ? never : keyof Ctx & string>;
};

// ────────────────────────────────────────────────────────────────────────────
