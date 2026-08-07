import type { ArgDef, FlagDef } from "../types.ts";
import type { Simplify } from "./context.ts";

/** Distribute `Omit<_, "name">` over the {@link ArgDef} union. */
type OmitName<T> = T extends { name: string } ? Omit<T, "name"> : never;

/** A positional argument definition without its name — the `defineArg` input shape. */
export type UnnamedArgDef = OmitName<ArgDef>;

/**
 * Define one named flag while preserving its literal definition type.
 *
 * The returned value carries its `name` and is attached with the variadic
 * `.flags(...defs)` or referenced in `requires.flags` arrays.
 */
export function defineFlag<const N extends string, const D extends FlagDef>(
	name: N,
	def: D,
): Simplify<{ readonly name: N } & D> {
	return { ...def, name } as Simplify<{ readonly name: N } & D>;
}

/**
 * Define one named positional argument while preserving its literal
 * definition type. Attach with the variadic `.args(...defs)`.
 */
export function defineArg<const N extends string, const D extends UnnamedArgDef>(
	name: N,
	def: D,
): Simplify<{ readonly name: N } & D> {
	return { ...def, name } as Simplify<{ readonly name: N } & D>;
}
