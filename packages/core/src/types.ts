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
// ArgDef — Positional argument definition (discriminated by `type`)
// ────────────────────────────────────────────────────────────────────────────

/** Shared fields present on every positional argument definition */
interface ArgDefBase {
	/** The argument name (used as the key in the parsed result and in help text) */
	name: string;
	/** Human-readable description for help text */
	description?: string;
	/** When `true`, the parser throws if the argument is not provided */
	required?: true;
	/** When `true`, collects all remaining positional values into an array */
	variadic?: true;
}

/** A positional argument whose value is a string */
interface StringArgDef extends ArgDefBase {
	type: "string";
	/** Default string value when the argument is not provided */
	default?: string;
}

/** A positional argument whose value is a number */
interface NumberArgDef extends ArgDefBase {
	type: "number";
	/** Default number value when the argument is not provided */
	default?: number;
}

/** A positional argument whose value is a boolean */
interface BooleanArgDef extends ArgDefBase {
	type: "boolean";
	/** Default boolean value when the argument is not provided */
	default?: boolean;
}

/**
 * Defines a single positional argument for a CLI command.
 *
 * Discriminated by `type` for type-safe `default` values. Boolean toggle
 * fields (`required`, `variadic`) only accept `true`.
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
export type ArgDef = StringArgDef | NumberArgDef | BooleanArgDef;

/** Ordered tuple of positional argument definitions */
export type ArgsDef = readonly ArgDef[];

// ────────────────────────────────────────────────────────────────────────────
// FlagDef — Named flag definition (discriminated by `type` × `multiple`)
// ────────────────────────────────────────────────────────────────────────────

/** Shared fields present on every flag definition */
interface FlagDefBase {
	/** Human-readable description for help text */
	description?: string;
	/** Short alias or array of aliases (e.g. `"v"` or `["v", "V"]`) */
	alias?: string | string[];
	/** When `true`, the parser throws if the flag is not provided */
	required?: true;
}

// ── Single-value flags ────────────────────────────────────────────────────

/** Base for single-value flags — `multiple` must be omitted */
interface SingleFlagBase extends FlagDefBase {
	/** Must be omitted for single-value flags — set to `true` for multi-value */
	multiple?: never;
}

/** A single-value string flag */
interface StringFlagDef extends SingleFlagBase {
	type: "string";
	/** Default string value */
	default?: string;
}

/** A single-value number flag */
interface NumberFlagDef extends SingleFlagBase {
	type: "number";
	/** Default number value */
	default?: number;
}

/** A single-value boolean flag */
interface BooleanFlagDef extends SingleFlagBase {
	type: "boolean";
	/** Default boolean value */
	default?: boolean;
}

// ── Multi-value flags ─────────────────────────────────────────────────────

/** Base for multi-value flags — `multiple` is required as `true` */
interface MultiFlagBase extends FlagDefBase {
	/** Collect repeated values into an array */
	multiple: true;
}

/** A multi-value string flag (collects repeated values into an array) */
interface StringMultiFlagDef extends MultiFlagBase {
	type: "string";
	/** Default string array value */
	default?: string[];
}

/** A multi-value number flag (collects repeated values into an array) */
interface NumberMultiFlagDef extends MultiFlagBase {
	type: "number";
	/** Default number array value */
	default?: number[];
}

/** A multi-value boolean flag (collects repeated values into an array) */
interface BooleanMultiFlagDef extends MultiFlagBase {
	type: "boolean";
	/** Default boolean array value */
	default?: boolean[];
}

/**
 * Defines a single named flag for a CLI command.
 *
 * Discriminated by `type` and `multiple` for type-safe `default` values.
 * Boolean toggle fields (`required`, `multiple`) only accept `true`.
 *
 * @example
 * ```ts
 * const flags = {
 *   verbose: { type: "boolean", description: "Enable verbose logging", alias: "v" },
 *   port: { type: "number", description: "Port number", default: 3000 },
 *   files: { type: "string", multiple: true, default: ["index.ts"] },
 * } satisfies FlagsDef;
 * ```
 */
export type FlagDef =
	| StringFlagDef
	| NumberFlagDef
	| BooleanFlagDef
	| StringMultiFlagDef
	| NumberMultiFlagDef
	| BooleanMultiFlagDef;

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
// CommandDef — Input shape for defineCommand
// ────────────────────────────────────────────────────────────────────────────

/**
 * Configuration object accepted by `defineCommand()`.
 *
 * Identical shape to {@link Command} but uses `NoInfer` on lifecycle-hook
 * parameters so TypeScript infers `A` and `F` solely from the `args` / `flags`
 * data properties — not from callbacks. This ensures full contextual typing
 * (e.g. `description` is `string`, not `any`) when writing command definitions.
 *
 * Compile-time validation for variadic args and flag alias collisions is
 * enforced via parameter-level intersection in `defineCommand()`.
 */
export interface CommandDef<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
> {
	/** Command metadata (name, description, usage) */
	meta: CommandMeta;
	/** Positional argument definitions */
	args?: A;
	/** Flag definitions */
	flags?: F;
	/** Named subcommands */
	subCommands?: Record<string, AnyCommand>;
	/** Called before `run()` — useful for initialization */
	preRun?(
		context: CommandContext<NoInfer<A>, NoInfer<F>>,
	): void | Promise<void>;
	/** The main command handler */
	run?(context: CommandContext<NoInfer<A>, NoInfer<F>>): void | Promise<void>;
	/** Called after `run()` (even if it throws) — useful for teardown */
	postRun?(
		context: CommandContext<NoInfer<A>, NoInfer<F>>,
	): void | Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────
// Command — Unified command shape
// ────────────────────────────────────────────────────────────────────────────

/** Frozen command object returned by `defineCommand()` and used at runtime. */
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
