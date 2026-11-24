import { normalizeFlag, normalizeArg } from "../parsing/spellings.ts";
import type { ArgDef, FlagDef, OmitName } from "../types.ts";
import type { LocalValueBrand, UnknownKeysBrand } from "../validation/shared.ts";

/** A positional argument definition without its name — the `defineArg` input shape. */
export type UnnamedArgDef = OmitName<ArgDef>;

type Frozen<T> = {
	readonly [K in keyof T]: K extends
		| "aliases"
		| "choices"
		| "env"
		| "requires"
		| (T extends { multiple: true } ? "default" : never)
		? Readonly<T[K]>
		: K extends "flags"
			? { readonly [M in keyof T[K]]: Frozen<T[K][M]> }
			: T[K];
};

// Preserve conditional fields before mapping the normalized readonly definition.
type Owned<D> = D extends unknown ? Frozen<D> : never;
type Named<N extends string, D> = D extends unknown ? Frozen<{ name: N } & D> : never;

/**
 * Define one reusable flag, including its readonly env binding. The key it is
 * attached under names it (`.flags({ format })`); attachment checks the name and collisions.
 */
export function defineFlag<const D extends FlagDef>(
	def: D & LocalValueBrand<D> & UnknownKeysBrand<D, FlagDef>,
): Owned<D>;

export function defineFlag(def: FlagDef): FlagDef {
	return normalizeFlag(undefined, def);
}

/** Define and own one positional argument; layout belongs to its consuming command. */
export function defineArg<const N extends string, const D extends UnnamedArgDef>(
	name: N,
	def: D & LocalValueBrand<D> & UnknownKeysBrand<D, UnnamedArgDef>,
): Named<N, D>;

export function defineArg(name: string, def: UnnamedArgDef): ArgDef {
	return normalizeArg({ ...def, name });
}
