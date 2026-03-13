import type { ArgDef, FlagDef } from "@crustjs/core";
import {
	COMPLETION_SOURCE,
	type CompletionArgDef,
	type CompletionFlagDef,
	type CompletionSource,
} from "./types.ts";

function withCompletionSource<T extends ArgDef | FlagDef>(
	def: T,
	source: CompletionSource,
): T {
	const clone = { ...def };
	Object.defineProperty(clone, COMPLETION_SOURCE, {
		value: source,
		enumerable: true,
		configurable: false,
		writable: false,
	});
	return clone;
}

export function completeArg<const T extends ArgDef>(
	def: T,
	source: CompletionSource,
): CompletionArgDef<T> {
	return withCompletionSource(def, source) as CompletionArgDef<T>;
}

export function completeFlag<const T extends FlagDef>(
	def: T,
	source: CompletionSource,
): CompletionFlagDef<T> {
	return withCompletionSource(def, source) as CompletionFlagDef<T>;
}

export function getCompletionSource(
	def: ArgDef | FlagDef | undefined,
): CompletionSource | undefined {
	return def
		? ((def as CompletionArgDef | CompletionFlagDef)[COMPLETION_SOURCE] ??
				undefined)
		: undefined;
}
