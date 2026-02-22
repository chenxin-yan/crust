import type { AnyCommand, CommandMeta } from "@crustjs/core";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ValidatedContext } from "../wrapper.ts";

// ────────────────────────────────────────────────────────────────────────────
// Core schema aliases
// ────────────────────────────────────────────────────────────────────────────

/** A Standard Schema-compatible validator used by the Zod entrypoint. */
export type ZodSchemaLike<Input = unknown, Output = Input> = StandardSchemaV1<
	Input,
	Output
>;

/** Infer output type from a Standard Schema-compatible validator. */
export type InferSchemaOutput<S> =
	S extends StandardSchemaV1<infer _In, infer Out> ? Out : never;

// ────────────────────────────────────────────────────────────────────────────
// `arg()` DSL types
// ────────────────────────────────────────────────────────────────────────────

/** Optional metadata for a positional argument declared with `arg()`. */
export interface ArgOptions {
	/** Human-readable description for help text. */
	readonly description?: string;
	/** Collect remaining positionals into this arg as an array. */
	readonly variadic?: true;
}

/** A single positional argument spec produced by `arg()`. */
export interface ArgSpec<
	Name extends string = string,
	Schema extends ZodSchemaLike = ZodSchemaLike,
> {
	readonly kind: "arg";
	readonly name: Name;
	readonly schema: Schema;
	readonly description?: string;
	readonly variadic?: true;
}

/** Ordered positional argument specs. */
export type ArgSpecs = readonly ArgSpec[];

/** Output type for one ArgSpec in the validated handler context. */
type InferArgValue<S extends ArgSpec> = S["variadic"] extends true
	? InferSchemaOutput<S["schema"]>[]
	: InferSchemaOutput<S["schema"]>;

/** Flattens an intersection of objects for readable inferred types. */
type Simplify<T> = { [K in keyof T]: T[K] };

/** Recursively maps ordered ArgSpec entries to a named output object type. */
type InferArgsFromTuple<A extends readonly ArgSpec[]> = A extends readonly [
	infer Head extends ArgSpec,
	...infer Tail extends readonly ArgSpec[],
]
	? { [K in Head["name"]]: InferArgValue<Head> } & InferArgsFromTuple<Tail>
	: // biome-ignore lint/complexity/noBannedTypes: empty base case for recursive intersection
		{};

/** Infer validated args object type from ordered ArgSpec entries. */
export type InferArgsFromSpecs<A extends ArgSpecs> = Simplify<
	InferArgsFromTuple<A>
>;

// ────────────────────────────────────────────────────────────────────────────
// `flag()` DSL types
// ────────────────────────────────────────────────────────────────────────────

/** Optional metadata for a flag declared with `flag()`. */
export interface FlagOptions {
	/** Short alias or array of aliases (e.g. `"v"` or `["v", "V"]`). */
	readonly alias?: string | string[];
	/** Human-readable description for help text. */
	readonly description?: string;
}

/** A named flag schema wrapper produced by `flag()`. */
export interface FlagSpec<Schema extends ZodSchemaLike = ZodSchemaLike> {
	readonly kind: "flag";
	readonly schema: Schema;
	readonly alias?: string | string[];
	readonly description?: string;
}

/** Allowed value shape for `flags` in `defineZodCommand()`. */
export type FlagShape = Record<string, ZodSchemaLike | FlagSpec>;

/** Extract the schema from a flag shape value (plain schema or `flag()` wrapper). */
type ExtractFlagSchema<V> =
	V extends FlagSpec<infer S> ? S : V extends ZodSchemaLike ? V : never;

/** Infer validated flags object type from the flags shape. */
export type InferFlagsFromShape<F extends FlagShape> = {
	[K in keyof F]: InferSchemaOutput<ExtractFlagSchema<F[K]>>;
};

// ────────────────────────────────────────────────────────────────────────────
// Handler + command definition types
// ────────────────────────────────────────────────────────────────────────────

/** Handler type for `defineZodCommand()` with validated/transformed context. */
export type ZodCommandRunHandler<ArgsOut, FlagsOut> = (
	context: ValidatedContext<ArgsOut, FlagsOut>,
) => void | Promise<void>;

/** Infer args output type from command config args. */
export type InferArgsFromConfig<A> = A extends ArgSpecs
	? InferArgsFromSpecs<A>
	: Record<string, never>;

/** Infer flags output type from command config flags. */
export type InferFlagsFromConfig<F> = F extends FlagShape
	? InferFlagsFromShape<F>
	: Record<string, never>;

/** Config for `defineZodCommand()` using `arg()` + `flag()` schema-first DSL. */
export interface ZodCommandDef<
	A extends ArgSpecs | undefined = undefined,
	F extends FlagShape | undefined = undefined,
> {
	/** Command metadata (name, description, usage). */
	readonly meta: CommandMeta;
	/** Ordered positional args as `arg()` specs. */
	readonly args?: A;
	/** Named flags as plain schemas or `flag()` wrappers. */
	readonly flags?: F;
	/** Named subcommands. */
	readonly subCommands?: Record<string, AnyCommand>;
	/** Main handler with validated/transformed args and flags. */
	readonly run?: ZodCommandRunHandler<
		InferArgsFromConfig<A>,
		InferFlagsFromConfig<F>
	>;
}
