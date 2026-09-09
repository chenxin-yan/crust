const runtimeValue: unique symbol = Symbol("crust.runtime");

/** Typed dynamic input checked by its consuming operation, not by the wrapper. */
export interface RuntimeInput<T> {
	readonly [runtimeValue]: T;
}

/** Opt into runtime validation at the consuming operation. Does not copy or validate the value. */
export function runtime<const T>(value: T): RuntimeInput<T> {
	return { [runtimeValue]: value };
}

/** @internal */
export function isRuntimeInput<T>(value: T | RuntimeInput<T>): value is RuntimeInput<T> {
	return typeof value === "object" && value !== null && runtimeValue in value;
}

/** @internal */
export function runtimeInputValue<T>(input: RuntimeInput<T>): T {
	return input[runtimeValue];
}
