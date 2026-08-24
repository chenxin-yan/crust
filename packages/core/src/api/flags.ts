import type { ArgDef, FlagDef } from "../types.ts";
import type { EmptyArgNameBrand } from "../validation/args.brands.ts";
import type { EmptyFlagSpellingBrand } from "../validation/flags.brands.ts";

/** Distribute `Omit<_, "name">` over the {@link ArgDef} union. */
type OmitName<T> = T extends { name: string } ? Omit<T, "name"> : never;

/** A positional argument definition without its name — the `defineArg` input shape. */
export type UnnamedArgDef = OmitName<ArgDef>;

/* oxlint-disable anti-slop/no-known-value-widening -- inline mapped returns keep exported inferred declarations flat and nameable without exposing the internal Simplify helper. */

/**
 * Define one named flag while preserving its literal definition type.
 *
 * The returned value carries its `name` and is attached with the variadic
 * `.flags(...defs)` or owned by a Context.
 */
export function defineFlag<const N extends string, const D extends FlagDef>(
	name: N & EmptyFlagSpellingBrand<N>,
	def: D,
): { [K in keyof ({ readonly name: N } & D)]: ({ readonly name: N } & D)[K] } {
	return { ...def, name };
}

/**
 * Define one named positional argument while preserving its literal
 * definition type. Attach with the variadic `.args(...defs)`.
 */
export function defineArg<const N extends string, const D extends UnnamedArgDef>(
	name: N & EmptyArgNameBrand<N>,
	def: D,
): { [K in keyof ({ readonly name: N } & D)]: ({ readonly name: N } & D)[K] } {
	return { ...def, name };
}

/* oxlint-enable anti-slop/no-known-value-widening */
