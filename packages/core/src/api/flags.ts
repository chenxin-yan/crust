import type { FlagDef, FlagsDef } from "../types.ts";

/** Define one flag while preserving its literal definition type. */
export interface DefineFlag {
	<const F extends FlagDef>(definition: F): F;
}

/** Define a named flag map while preserving each literal definition type. */
export interface DefineFlags {
	<const F extends FlagsDef>(definitions: F): F;
}

export const defineFlag: DefineFlag = <const F extends FlagDef>(definition: F): F => definition;

export const defineFlags: DefineFlags = <const F extends FlagsDef>(definitions: F): F =>
	definitions;
