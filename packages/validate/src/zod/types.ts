import type { CommandContext, CommandDef } from "@crustjs/core";
import type * as z from "zod/v4/core";
import type { ValidatedContext } from "../types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Core schema aliases
// ────────────────────────────────────────────────────────────────────────────

/** A Zod schema used by the Zod entrypoint. */
export type ZodSchemaLike<Input = unknown, Output = Input> = z.$ZodType<
	Output,
	Input
>;

/** Infer output type from a Zod schema. */
export type InferSchemaOutput<S> = S extends z.$ZodType ? z.output<S> : never;

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

/**
 * A single positional argument spec produced by `arg()`.
 *
 * The `Variadic` generic parameter preserves the literal `true` from
 * `arg()` calls so `ValidateVariadicArgs` can distinguish variadic args
 * from non-variadic ones at compile time.
 *
 * - `ArgSpec<N, S, true>` — variadic arg (only valid in last position)
 * - `ArgSpec<N, S, undefined>` — normal positional arg
 * - `ArgSpec<N, S>` (default) — type-erased form used in constraints
 */
export interface ArgSpec<
	Name extends string = string,
	Schema extends ZodSchemaLike = ZodSchemaLike,
	Variadic extends true | undefined = true | undefined,
> {
	readonly kind: "arg";
	readonly name: Name;
	readonly schema: Schema;
	readonly description?: string;
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
	/** Human-readable description for help text. */
	readonly description?: string;
}

/**
 * A named flag schema wrapper produced by `flag()`.
 *
 * The `Alias` generic parameter preserves alias literals (e.g. `"v"` or
 * `readonly ["v", "V"]`) from `flag()` calls so `ValidateFlagAliases` can
 * detect collisions at compile time.
 *
 * - `FlagSpec<S, "v">` — flag with alias `"v"` (collision-detectable)
 * - `FlagSpec<S, undefined>` — flag without an alias
 * - `FlagSpec<S>` (default) — type-erased form used in constraints
 */
export interface FlagSpec<
	Schema extends ZodSchemaLike = ZodSchemaLike,
	Alias extends string | readonly string[] | undefined =
		| string
		| readonly string[]
		| undefined,
> {
	readonly kind: "flag";
	readonly schema: Schema;
	readonly alias: Alias;
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

/**
 * Keys from `CommandDef` that `ZodCommandDef` redefines with different types.
 *
 * - `args` / `flags`: Zod schema-based definitions replace core's `ArgsDef`/`FlagsDef`
 * - `run`: receives `ValidatedContext` instead of raw `CommandContext`
 * - `preRun` / `postRun`: use raw `CommandContext` (no `NoInfer` wrapper)
 *
 * All remaining `CommandDef` keys (e.g. `meta`, `subCommands`) are inherited
 * automatically via `Omit`. If a new passthrough field is added to `CommandDef`,
 * it propagates here without changes. The compile-time key exhaustiveness
 * assertion in `command.test.ts` will fail, forcing a review.
 */
type ZodOverriddenKeys = "args" | "flags" | "run" | "preRun" | "postRun";

/**
 * Config for `defineZodCommand()` using `arg()` + `flag()` schema-first DSL.
 *
 * Extends `CommandDef` (minus overridden keys) so passthrough fields like
 * `meta` and `subCommands` stay in sync automatically. If a new field is
 * added to `CommandDef`, the key exhaustiveness assertion in
 * `command.test.ts` fails at compile time, forcing a review.
 */
export interface ZodCommandDef<
	A extends ArgSpecs | undefined = undefined,
	F extends FlagShape | undefined = undefined,
> extends Omit<CommandDef, ZodOverriddenKeys> {
	/** Ordered positional args as `arg()` specs. */
	readonly args?: A;
	/** Named flags as plain schemas or `flag()` wrappers. */
	readonly flags?: F;
	/**
	 * Optional setup hook before schema validation runs.
	 *
	 * Receives raw parser output (`CommandContext`), not schema-transformed values.
	 */
	readonly preRun?: (context: CommandContext) => void | Promise<void>;
	/** Main handler with validated/transformed args and flags. */
	readonly run?: ZodCommandRunHandler<
		InferArgsFromConfig<A>,
		InferFlagsFromConfig<F>
	>;
	/**
	 * Optional teardown hook after command execution.
	 *
	 * Receives raw parser output (`CommandContext`), not schema-transformed values.
	 */
	readonly postRun?: (context: CommandContext) => void | Promise<void>;
}
