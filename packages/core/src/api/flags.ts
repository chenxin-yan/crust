import { normalizeFlag, normalizeArg } from "../parsing/spellings.ts";
import type { ArgDef, FlagDef, NamedFlagDef, OmitName } from "../types.ts";
import type { EmptyArgNameBrand } from "../validation/args.brands.ts";
import type { LocalFlagBrand, LocalFlagNameBrand } from "../validation/flags.brands.ts";
import type { LocalValueBrand } from "../validation/shared.ts";

/** A positional argument definition without its name — the `defineArg` input shape. */
export type UnnamedArgDef = OmitName<ArgDef>;

type Frozen<T> = {
	readonly [K in keyof T]: K extends
		| "aliases"
		| "choices"
		| "env"
		| (T extends { multiple: true } ? "default" : never)
		? Readonly<T[K]>
		: T[K];
};

// Preserve conditional fields before mapping the normalized readonly definition.
type Owned<D> = D extends unknown ? Frozen<D> : never;
type Named<N extends string, D> = D extends unknown ? Frozen<{ name: N } & D> : never;

/**
 * Define one reusable flag, including its readonly env binding. The key it is
 * attached under names it (`.flags({ format })`); attachment checks the name and collisions.
 */
export function defineFlag<const D extends FlagDef>(def: D & LocalFlagBrand<D>): Owned<D>;
/** Define and own one named flag for the variadic `.flags(...defs)` form. */
export function defineFlag<const N extends string, const D extends FlagDef>(
	name: N & LocalFlagNameBrand<N>,
	def: D & LocalFlagBrand<{ name: N } & D>,
): Named<N, D>;

export function defineFlag(nameOrDef: string | FlagDef, def?: FlagDef): FlagDef | NamedFlagDef {
	if (typeof nameOrDef !== "string") return normalizeFlag(undefined, nameOrDef);
	// SAFETY: the named overload requires a definition.
	return normalizeFlag(nameOrDef, { ...(def as FlagDef), name: nameOrDef });
}

/** Define and own one positional argument; layout belongs to its consuming command. */
export function defineArg<const N extends string, const D extends UnnamedArgDef>(
	name: N & EmptyArgNameBrand<N>,
	def: D & LocalValueBrand<D>,
): Named<N, D>;

export function defineArg(name: string, def: UnnamedArgDef): ArgDef {
	return normalizeArg({ ...def, name });
}
