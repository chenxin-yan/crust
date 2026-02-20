// ────────────────────────────────────────────────────────────────────────────
// Literal-to-primitive mapping
// ────────────────────────────────────────────────────────────────────────────

/** Supported type literals for args and flags */
export type ValueType = "string" | "number" | "boolean";

/**
 * Resolves a type literal to its corresponding TypeScript primitive type.
 *
 * - `"string"` → `string`
 * - `"number"` → `number`
 * - `"boolean"` → `boolean`
 */
type ResolvePrimitive<T extends ValueType> = T extends "string"
	? string
	: T extends "number"
		? number
		: T extends "boolean"
			? boolean
			: never;

// ────────────────────────────────────────────────────────────────────────────
// ArgDef — Positional argument definition
// ────────────────────────────────────────────────────────────────────────────

/**
 * Defines a single positional argument for a CLI command.
 *
 * Args are defined as an ordered tuple so that positional ordering is explicit
 * and the type system can enforce that only the last arg may be variadic.
 *
 * @example
 * ```ts
 * const args = [
 *   { name: "port", type: "number", description: "Port number", default: 3000 },
 *   { name: "name", type: "string", required: true },
 *   { name: "files", type: "string", variadic: true },
 * ] as const satisfies ArgsDef;
 * ```
 */
export interface ArgDef<
	N extends string = string,
	T extends ValueType = ValueType,
	D extends ResolvePrimitive<T> | undefined = ResolvePrimitive<T> | undefined,
	R extends boolean = boolean,
	V extends boolean = boolean,
> {
	/** The argument name (used as the key in the parsed result and in help text) */
	name: N;
	/** Type literal indicating the argument's type: `"string"`, `"number"`, or `"boolean"` */
	type: T;
	/** Human-readable description for help text */
	description?: string;
	/** Default value when the argument is not provided */
	default?: D;
	/** Whether this argument must be provided (errors if missing) */
	required?: R;
	/** Whether this argument collects all remaining positionals into an array */
	variadic?: V;
}

/** Ordered tuple of positional argument definitions */
export type ArgsDef = readonly ArgDef[];

// ────────────────────────────────────────────────────────────────────────────
// FlagDef — Named flag definition
// ────────────────────────────────────────────────────────────────────────────

/**
 * Defines a single named flag for a CLI command.
 *
 * @example
 * ```ts
 * const flags = {
 *   verbose: { type: "boolean", description: "Enable verbose logging", alias: "v" },
 *   port: { type: "number", description: "Port number", default: 3000 },
 * } satisfies FlagsDef;
 * ```
 */
export interface FlagDef<
	T extends ValueType = ValueType,
	R extends boolean = boolean,
	M extends boolean = boolean,
> {
	/** Type literal indicating the flag's type: `"string"`, `"number"`, or `"boolean"` */
	type: T;
	/** Human-readable description for help text */
	description?: string;
	/** Default value when the flag is not provided. Must be an array when `multiple: true`. */
	default?: M extends true ? ResolvePrimitive<T>[] : ResolvePrimitive<T>;
	/** Whether this flag must be provided (errors if missing) */
	required?: R;
	/** Short alias or array of aliases (e.g. `"v"` or `["v", "V"]`) */
	alias?: string | string[];
	/** Whether this flag can be provided multiple times, collecting values into an array */
	multiple?: M;
}

/** Record mapping flag names to their definitions */
export type FlagsDef = Record<string, FlagDef>;

// ────────────────────────────────────────────────────────────────────────────
// Flag alias collision detection (compile-time)
// ────────────────────────────────────────────────────────────────────────────

/** Extract alias string literals from a single FlagDef */
type ExtractAliases<F extends FlagDef> = F extends { alias: infer A }
	? A extends string
		? A
		: A extends readonly string[]
			? A[number]
			: never
	: never;

/**
 * Collects all alias literals across a FlagsDef, then intersects with `keyof F`.
 * Resolves to `never` when no alias matches a flag name, or the colliding
 * name(s) when a match exists.
 */
type FlagAliasNameCollision<F extends FlagsDef> = {
	[K in keyof F & string]: ExtractAliases<F[K]>;
}[keyof F & string] &
	keyof F;

/**
 * Collects aliases from every flag *except* flag K.
 * Used to detect alias→alias duplicates across different flags.
 */
type AliasesExcluding<F extends FlagsDef, K extends keyof F & string> = {
	[J in Exclude<keyof F & string, K>]: ExtractAliases<F[J]>;
}[Exclude<keyof F & string, K>];

/**
 * Resolves to the alias literal(s) that appear in more than one flag's
 * alias list, or `never` when no duplicate aliases exist.
 */
type FlagAliasAliasCollision<F extends FlagsDef> = {
	[K in keyof F & string]: ExtractAliases<F[K]> & AliasesExcluding<F, K>;
}[keyof F & string];

/**
 * Compile-time check that no flag alias collides with another flag's name
 * or another flag's alias.
 *
 * - Resolves to `unknown` (no-op intersection) when no collision exists.
 * - Resolves to a descriptive error tuple when a collision is found,
 *   causing a type error on the `flags` property.
 */
export type CheckFlagAliasCollisions<F extends FlagsDef> =
	FlagAliasNameCollision<F> extends never
		? FlagAliasAliasCollision<F> extends never
			? unknown
			: [
					"ERROR: Duplicate flag alias across different flags. Colliding alias(es):",
					FlagAliasAliasCollision<F>,
				]
		: [
				"ERROR: Flag alias collides with a flag name. Colliding name(s):",
				FlagAliasNameCollision<F>,
			];

// ────────────────────────────────────────────────────────────────────────────
// Variadic arg validation (compile-time)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether any element in `Init` (all elements except the last) has
 * `variadic: true`. Used by {@link CheckVariadicArgs} to ensure only the
 * last positional arg can be variadic.
 */
type InitHasVariadic<T extends readonly ArgDef[]> = T extends readonly [
	infer Head,
	...infer Tail extends readonly ArgDef[],
]
	? Head extends { variadic: true }
		? true
		: InitHasVariadic<Tail>
	: false;

/**
 * Compile-time check that only the last positional arg has `variadic: true`.
 *
 * Since args are now an ordered tuple, we can split it into `[...Init, Last]`
 * and verify that no element in `Init` is variadic.
 *
 * - Resolves to `unknown` (no-op intersection) when the constraint is satisfied.
 * - Resolves to a descriptive error string when a non-last arg is variadic,
 *   causing a type error on the `args` property.
 */
export type CheckVariadicArgs<A extends ArgsDef> = A extends readonly [
	...infer Init extends readonly ArgDef[],
	ArgDef,
]
	? InitHasVariadic<Init> extends true
		? "ERROR: Only the last positional argument can be variadic"
		: unknown
	: unknown;

// ────────────────────────────────────────────────────────────────────────────
// InferArgs / InferFlags — Type inference utilities
// ────────────────────────────────────────────────────────────────────────────

/**
 * Infer the resolved type for a single ArgDef:
 *
 * - **variadic** → `primitive[]`
 * - **required** or **has default** → `primitive` (non-optional)
 * - otherwise → `primitive | undefined`
 */
type InferArgValue<A extends ArgDef> =
	// Variadic always produces an array
	A extends { variadic: true }
		? ResolvePrimitive<A["type"]>[]
		: // Required or has a default → guaranteed present
			A extends { required: true }
			? ResolvePrimitive<A["type"]>
			: A extends { default: ResolvePrimitive<A["type"]> }
				? ResolvePrimitive<A["type"]>
				: ResolvePrimitive<A["type"]> | undefined;

/**
 * Recursively converts an ArgsDef tuple into a named object type.
 *
 * Each element's `name` literal becomes a key, and its value is resolved
 * via {@link InferArgValue}. Uses intersection + `Simplify` to flatten.
 */
type InferArgsTuple<A extends readonly ArgDef[]> = A extends readonly [
	infer Head extends ArgDef,
	...infer Tail extends readonly ArgDef[],
]
	? { [K in Head["name"]]: InferArgValue<Head> } & InferArgsTuple<Tail>
	: // biome-ignore lint/complexity/noBannedTypes: empty base case for recursive intersection
		{};

/** Flattens an intersection of objects into a single object type for readability */
type Simplify<T> = { [K in keyof T]: T[K] };

/**
 * Maps an ArgsDef tuple to resolved arg types keyed by each arg's `name`.
 *
 * @example
 * ```ts
 * type Result = InferArgs<readonly [
 *   { name: "port"; type: "number"; default: 3000 },
 *   { name: "name"; type: "string"; required: true },
 *   { name: "files"; type: "string"; variadic: true },
 * ]>;
 * // Result = { port: number; name: string; files: string[] }
 * ```
 */
export type InferArgs<A> = A extends ArgsDef
	? Simplify<InferArgsTuple<A>>
	: Record<string, never>;

/**
 * Infer the resolved type for a single FlagDef:
 *
 * - **multiple** → wraps the resolved type in an array
 * - **required** or **has default** → `primitive` (non-optional)
 * - otherwise → `primitive | undefined`
 */
type InferFlagValue<F extends FlagDef> = F extends { multiple: true }
	? F extends { required: true }
		? ResolvePrimitive<F["type"]>[]
		: F extends { default: ResolvePrimitive<F["type"]>[] }
			? ResolvePrimitive<F["type"]>[]
			: ResolvePrimitive<F["type"]>[] | undefined
	: F extends { required: true }
		? ResolvePrimitive<F["type"]>
		: F extends { default: ResolvePrimitive<F["type"]> }
			? ResolvePrimitive<F["type"]>
			: ResolvePrimitive<F["type"]> | undefined;

/**
 * Maps a full FlagsDef record to resolved flag types.
 *
 * @example
 * ```ts
 * type Result = InferFlags<{
 *   verbose: { type: "boolean" };
 *   port: { type: "number", default: 3000 };
 * }>;
 * // Result = { verbose: boolean | undefined; port: number }
 * ```
 */
export type InferFlags<F> = F extends FlagsDef
	? { [K in keyof F]: InferFlagValue<F[K]> }
	: Record<string, never>;

// ────────────────────────────────────────────────────────────────────────────
// CommandMeta — Command metadata
// ────────────────────────────────────────────────────────────────────────────

/** Metadata describing a CLI command */
export interface CommandMeta {
	/** The command name (used in help text and routing) */
	name: string;
	/** Human-readable description for help text */
	description?: string;
	/** Custom usage string (overrides auto-generated usage) */
	usage?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// ParseResult — Output of parseArgs
// ────────────────────────────────────────────────────────────────────────────

/**
 * The result of parsing argv against a command's arg/flag definitions.
 *
 * Generic parameters flow from the command definition to provide
 * strongly-typed `args` and `flags` objects.
 */
export interface ParseResult<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
> {
	/** Resolved positional arguments, keyed by arg name */
	args: InferArgs<A>;
	/** Resolved flags, keyed by flag name */
	flags: InferFlags<F>;
	/** Raw arguments that appeared after the `--` separator */
	rawArgs: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// CommandContext — Runtime context passed to lifecycle hooks
// ────────────────────────────────────────────────────────────────────────────

/**
 * The runtime context object passed to `preRun()`, `run()`, and `postRun()` hooks.
 *
 * Extends {@link ParseResult} with a back-reference to the resolved command.
 */
export interface CommandContext<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
> extends ParseResult<A, F> {
	/** The resolved command that is being executed */
	command: AnyCommand;
}

// ────────────────────────────────────────────────────────────────────────────
// Command — Unified command shape
// ────────────────────────────────────────────────────────────────────────────

/** Unified command shape used for both command definitions and resolved commands. */
export interface Command<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
> {
	/** Command metadata (name, description, usage) */
	readonly meta: CommandMeta;
	/** Positional argument definitions */
	readonly args?: A;
	/** Flag definitions */
	readonly flags?: F;
	/** Named subcommands */
	readonly subCommands?: Record<string, AnyCommand>;
	/** Called before `run()` — useful for initialization */
	preRun?(context: CommandContext<A, F>): void | Promise<void>;
	/** The main command handler */
	run?(context: CommandContext<A, F>): void | Promise<void>;
	/** Called after `run()` (even if it throws) — useful for teardown */
	postRun?(context: CommandContext<A, F>): void | Promise<void>;
}

// biome-ignore lint/suspicious/noExplicitAny: needed for type-erased command boundaries
export type AnyCommand = Command<any, any>;
