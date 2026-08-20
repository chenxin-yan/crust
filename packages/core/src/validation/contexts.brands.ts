import type { ContextDepsOf, ContextInstance, ContextMap, ContextsOutput } from "../api/context.ts";
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
 * out via `DefName`; a parent-provided Context is not in the definition's
 * `Ctx` and therefore cannot be checked at this call site.
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

type InstanceNames<P extends readonly unknown[]> = P extends readonly [
	infer H,
	...infer T extends readonly unknown[],
]
	? DefName<H> | InstanceNames<T>
	: never;

/** Statically known names of an Extension's provided Contexts; widened Extensions opt out. */
type ExtensionProvidedNames<E> = E extends {
	readonly provides?: infer P extends readonly unknown[];
}
	? InstanceNames<P>
	: never;

type ExtensionContextBrand<E, Existing extends string> =
	Overlap<ExtensionProvidedNames<E>, Existing> extends infer Duplicate extends string
		? [Duplicate] extends [never]
			? {}
			: {
					readonly FIX_DUPLICATE_CONTEXT: `Extension-provided Context "${Duplicate}" is already provided on this command path`;
				}
		: never;

type ValidateExtensionProvidesWorker<
	Es extends readonly unknown[],
	Existing extends string,
> = Es extends readonly [infer H, ...infer T extends readonly unknown[]]
	? readonly [
			H & ExtensionContextBrand<H, Existing>,
			...ValidateExtensionProvidesWorker<T, Existing | ExtensionProvidedNames<H>>,
		]
	: Es;

/**
 * Brand Extensions whose provided Context names replace one already on the
 * command path (or one provided by an earlier Extension in the same call).
 * The resolver is last-write-wins, so a silent replacement would hand actions
 * bound before `.extend()` a value of a different static type.
 */
export type ValidateExtensionProvides<
	Es extends readonly unknown[],
	Ctx extends ContextMap,
> = ValidateExtensionProvidesWorker<Es, string extends keyof Ctx ? never : keyof Ctx & string>;

// Widened instances (Deps = any, or a string-indexed Deps map) opt out to
// runtime-only validation, mirroring DeclaredDepsOf below.
type ProvidedDepsOf<C> =
	IsAny<C> extends true
		? {}
		: IsAny<ContextDepsOf<C>> extends true
			? {}
			: string extends keyof ContextDepsOf<C>
				? {}
				: ContextDepsOf<C>;

type MissingDependencyBrand<C, Known extends string> =
	Exclude<keyof ProvidedDepsOf<C> & string, Known> extends infer Missing extends string
		? [Missing] extends [never]
			? {}
			: {
					readonly FIX_MISSING_DEPENDENCY: `Context "${DefName<C>}" uses Context "${Missing}" which is not provided on this command path`;
				}
		: never;

// A same-name provider must also deliver the value type the consumer's
// declared factory promises; name-only matching would compile-cleanly mistype
// `ctx.<name>`. `any`-valued providers opt out (runtime-only), and there is no
// runtime twin because values are opaque until setup runs.
type MismatchedDependencyNames<Deps, KnownValues> = {
	[K in keyof Deps & keyof KnownValues & string]: IsAny<KnownValues[K]> extends true
		? never
		: IsAny<Deps[K]> extends true
			? never
			: KnownValues[K] extends Deps[K]
				? never
				: K;
}[keyof Deps & keyof KnownValues & string];

type MismatchedDependencyBrand<C, KnownValues> =
	MismatchedDependencyNames<ProvidedDepsOf<C>, KnownValues> extends infer Mismatched extends string
		? [Mismatched] extends [never]
			? {}
			: {
					readonly FIX_DEPENDENCY_TYPE: `Context "${DefName<C>}" uses Context "${Mismatched}" whose provided value does not satisfy the declared dependency type`;
				}
		: never;

/** Brand provided instances whose transitive dependency closure is unsatisfied. */
export type ValidateContextDeps<
	Ctx extends ContextMap,
	Cs extends readonly ContextInstance[],
	Known extends string =
		| (string extends keyof Ctx ? never : keyof Ctx & string)
		| DefName<Cs[number]>,
	KnownValues extends ContextMap = (string extends keyof Ctx ? {} : Ctx) & ContextsOutput<Cs>,
> = {
	[I in keyof Cs]: Cs[I] &
		MissingDependencyBrand<Cs[I], Known> &
		MismatchedDependencyBrand<Cs[I], KnownValues>;
};

/** Dependency closure carried by command definitions and Extensions. */
type IsAny<T> = 0 extends 1 & T ? true : false;
export type DeclaredDepsOf<T> =
	IsAny<T> extends true
		? {}
		: T extends { readonly _deps?: infer Deps extends ContextMap }
			? IsAny<Deps> extends true
				? {}
				: string extends keyof Deps
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
