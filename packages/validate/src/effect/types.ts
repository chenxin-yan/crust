import type { CommandContext, CommandDef } from "@crustjs/core";
import type * as schema from "effect/Schema";
import type { ValidatedContext } from "../types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Core schema aliases
// ────────────────────────────────────────────────────────────────────────────

/**
 * An Effect schema used by the Effect entrypoint.
 *
 * v1 intentionally supports context-free schemas only (`R = never`).
 * Schemas must also be **synchronous** — async combinators such as
 * `Schema.filterEffect` or async `Schema.transformOrFail` will cause
 * `Effect.runSync` to throw at runtime.
 */
export type EffectSchemaLike = schema.Schema.AnyNoContext;

/** Infer output type from an Effect schema. */
export type InferSchemaOutput<S> =
	S extends schema.Schema<infer A, infer _I, infer _R> ? A : never;

// ────────────────────────────────────────────────────────────────────────────
// `arg()` DSL types
// ────────────────────────────────────────────────────────────────────────────

/** Optional metadata for a positional argument declared with `arg()`. */
export interface ArgOptions {
	/** Collect remaining positionals into this arg as an array. */
	readonly variadic?: true;
}

/** A single positional argument spec produced by `arg()`. */
export interface ArgSpec<
	Name extends string = string,
	SchemaType extends EffectSchemaLike = EffectSchemaLike,
	Variadic extends true | undefined = true | undefined,
> {
	readonly kind: "arg";
	readonly name: Name;
	readonly schema: SchemaType;
	readonly variadic: Variadic;
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
	readonly alias?: string | readonly string[];
}

/** A named flag schema wrapper produced by `flag()`. */
export interface FlagSpec<
	SchemaType extends EffectSchemaLike = EffectSchemaLike,
	Alias extends string | readonly string[] | undefined =
		| string
		| readonly string[]
		| undefined,
> {
	readonly kind: "flag";
	readonly schema: SchemaType;
	readonly alias: Alias;
}

/** Allowed value shape for `flags` in `defineEffectCommand()`. */
export type FlagShape = Record<string, EffectSchemaLike | FlagSpec>;

/** Extract the schema from a flag shape value (plain schema or `flag()` wrapper). */
type ExtractFlagSchema<V> =
	V extends FlagSpec<infer S> ? S : V extends EffectSchemaLike ? V : never;

/** Infer validated flags object type from the flags shape. */
export type InferFlagsFromShape<F extends FlagShape> = {
	[K in keyof F]: InferSchemaOutput<ExtractFlagSchema<F[K]>>;
};

// ────────────────────────────────────────────────────────────────────────────
// Handler + command definition types
// ────────────────────────────────────────────────────────────────────────────

/** Handler type for `defineEffectCommand()` with validated/transformed context. */
export type EffectCommandRunHandler<ArgsOut, FlagsOut> = (
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

type EffectOverriddenKeys = "args" | "flags" | "run" | "preRun" | "postRun";

/** Config for `defineEffectCommand()` using `arg()` + `flag()` schema-first DSL. */
export interface EffectCommandDef<
	A extends ArgSpecs | undefined = undefined,
	F extends FlagShape | undefined = undefined,
> extends Omit<CommandDef, EffectOverriddenKeys> {
	/** Ordered positional args as `arg()` specs. */
	readonly args?: A;
	/** Named flags as plain schemas or `flag()` wrappers. */
	readonly flags?: F;
	/** Optional setup hook before schema validation runs. */
	readonly preRun?: (context: CommandContext) => void | Promise<void>;
	/** Main handler with validated/transformed args and flags. */
	readonly run?: EffectCommandRunHandler<
		InferArgsFromConfig<A>,
		InferFlagsFromConfig<F>
	>;
	/** Optional teardown hook after command execution. */
	readonly postRun?: (context: CommandContext) => void | Promise<void>;
}
