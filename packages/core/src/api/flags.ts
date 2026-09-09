import { normalizeFlag, normalizeArg } from "../parsing/spellings.ts";
import { isRuntimeInput, runtimeInputValue, type RuntimeInput } from "../runtime.ts";
import type { ArgDef, FlagDef, NamedFlagDef } from "../types.ts";
import type { EmptyArgNameBrand } from "../validation/args.brands.ts";
import type {
	LocalFlagBrand,
	LocalFlagFieldsBrand,
	LocalFlagNameBrand,
} from "../validation/flags.brands.ts";
import type { KnownNameBrand, LocalValueBrand } from "../validation/shared.ts";

/** Distribute `Omit<_, "name">` over the {@link ArgDef} union. */
type OmitName<T> = T extends { name: string } ? Omit<T, "name"> : never;

/** A positional argument definition without its name — the `defineArg` input shape. */
export type UnnamedArgDef = OmitName<ArgDef>;

// Preserve conditional fields before mapping the normalized readonly definition.
type Named<N extends string, D> = D extends unknown
	? {
			readonly [K in keyof ({ readonly name: N } & D)]: K extends "aliases" | "choices"
				? Readonly<({ readonly name: N } & D)[K]>
				: K extends "default"
					? D extends { multiple: true }
						? Readonly<({ readonly name: N } & D)[K]>
						: ({ readonly name: N } & D)[K]
					: ({ readonly name: N } & D)[K];
		}
	: never;
type Errors<T> = Pick<T, Extract<keyof T, `FIX_${string}`>>;

/** Define and own one flag locally; checked definitions still need destination collision proof. */
export function defineFlag<const N extends string, const D extends FlagDef>(
	name: N & LocalFlagNameBrand<N>,
	def: D & Errors<LocalFlagBrand<{ name: N } & D>>,
): Named<N, D>;
export function defineFlag<const N extends string, const D extends FlagDef>(
	name: RuntimeInput<N>,
	def: D & LocalFlagFieldsBrand<D>,
): Named<N, D>;
export function defineFlag<const N extends string, const D extends FlagDef>(
	name: (N & LocalFlagNameBrand<N>) | RuntimeInput<N>,
	def: RuntimeInput<D>,
): Named<N, D>;
export function defineFlag(
	nameInput: string | RuntimeInput<string>,
	defInput: FlagDef | RuntimeInput<FlagDef>,
): NamedFlagDef {
	const name = isRuntimeInput(nameInput) ? runtimeInputValue(nameInput) : nameInput;
	const def = isRuntimeInput(defInput) ? runtimeInputValue(defInput) : defInput;
	return normalizeFlag(
		name,
		{ ...def, name },
		isRuntimeInput(nameInput) || isRuntimeInput(defInput),
		isRuntimeInput(defInput),
	);
}

/** Define and own one positional argument; layout belongs to its consuming command. */
export function defineArg<const N extends string, const D extends UnnamedArgDef>(
	name: (N & KnownNameBrand<N> & EmptyArgNameBrand<N>) | RuntimeInput<N>,
	def: D & LocalValueBrand<D>,
): Named<N, D>;
export function defineArg<const N extends string, const D extends UnnamedArgDef>(
	name: (N & KnownNameBrand<N> & EmptyArgNameBrand<N>) | RuntimeInput<N>,
	def: RuntimeInput<D>,
): Named<N, D>;
export function defineArg(
	nameInput: string | RuntimeInput<string>,
	defInput: UnnamedArgDef | RuntimeInput<UnnamedArgDef>,
): ArgDef {
	const name = isRuntimeInput(nameInput) ? runtimeInputValue(nameInput) : nameInput;
	const def = isRuntimeInput(defInput) ? runtimeInputValue(defInput) : defInput;
	return normalizeArg(
		{ ...def, name },
		isRuntimeInput(nameInput) || isRuntimeInput(defInput),
		isRuntimeInput(defInput),
	);
}
