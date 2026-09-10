import { normalizeFlag, normalizeArg } from "../parsing/spellings.ts";
import type { ArgDef, FlagDef, NamedFlagDef } from "../types.ts";
import type { EmptyArgNameBrand } from "../validation/args.brands.ts";
import type { LocalFlagBrand, LocalFlagNameBrand } from "../validation/flags.brands.ts";
import type { LocalValueBrand } from "../validation/shared.ts";

/** Distribute `Omit<_, "name">` over the {@link ArgDef} union. */
type OmitName<T> = T extends { name: string } ? Omit<T, "name"> : never;

/** A positional argument definition without its name — the `defineArg` input shape. */
export type UnnamedArgDef = OmitName<ArgDef>;

type Frozen<T> = {
	readonly [K in keyof T]: K extends
		| "aliases"
		| "choices"
		| (T extends { multiple: true } ? "default" : never)
		? Readonly<T[K]>
		: T[K];
};

// Preserve conditional fields before mapping the normalized readonly definition.
type Named<N extends string, D> = D extends unknown ? Frozen<{ name: N } & D> : never;

/** Define and own one flag locally; attachment checks destination collisions. */
export function defineFlag<const N extends string, const D extends FlagDef>(
	name: N & LocalFlagNameBrand<N>,
	def: D & LocalFlagBrand<{ name: N } & D>,
): Named<N, D>;

export function defineFlag(name: string, def: FlagDef): NamedFlagDef {
	return normalizeFlag(name, { ...def, name });
}

/** Define and own one positional argument; layout belongs to its consuming command. */
export function defineArg<const N extends string, const D extends UnnamedArgDef>(
	name: N & EmptyArgNameBrand<N>,
	def: D & LocalValueBrand<D>,
): Named<N, D>;

export function defineArg(name: string, def: UnnamedArgDef): ArgDef {
	return normalizeArg({ ...def, name });
}
