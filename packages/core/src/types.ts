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
	/** Single-character short alias (e.g. `"v"` → `-v`) */
	short?: string;
	/** Additional long aliases (e.g. `["out"]` → `--out`) */
	aliases?: string[];
	/** When `true`, the parser throws if the flag is not provided */
	required?: true;
	/** When `true`, the flag is inherited by subcommands */
	inherit?: true;
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
	/** When `true`, hide the generated `--no-{name}` help label */
	noNegate?: true;
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
	/** When `true`, hide the generated `--no-{name}` help label */
	noNegate?: true;
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
 *   verbose: { type: "boolean", description: "Enable verbose logging", short: "v" },
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
// Flag alias collision detection (compile-time, per-flag granularity)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract the `short` alias literal from a flag definition.
 * Resolves to `never` when no `short` field exists or when the type
 * is the broad `string` (not a narrowed literal).
 */
type ExtractShort<F> = F extends { short: infer S }
	? S extends string
		? string extends S
			? never
			: S
		: never
	: never;

/**
 * Extract alias string literals from the `aliases` array of a flag definition.
 * Resolves to `never` when no `aliases` field exists or when the element type
 * is the broad `string` (not narrowed literals).
 */
type ExtractLongAliases<F> = F extends { aliases: infer A }
	? A extends readonly string[]
		? string extends A[number]
			? never
			: A[number]
		: never
	: never;

/**
 * Extract all alias identifiers (short + long) from a flag definition.
 *
 * Generalized to work with any shape (`FlagDef`, `FlagSpec`, etc.) —
 * values without `short`/`aliases` fields resolve to `never`.
 *
 * Includes `string extends ...` guards so non-narrowed types (e.g. the
 * broad `string` type from a default generic) resolve to `never` instead
 * of causing false-positive collisions.
 */
type ExtractAllAliases<F> = ExtractShort<F> | ExtractLongAliases<F>;

/**
 * Collects aliases from every flag *except* flag K.
 * Used to detect alias→alias duplicates across different flags.
 */
type AliasesExcluding<
	F extends Record<string, unknown>,
	K extends keyof F & string,
> = {
	[J in Exclude<keyof F & string, K>]: ExtractAllAliases<F[J]>;
}[Exclude<keyof F & string, K>];

/**
 * Per-flag collision detection: resolves to the alias literal(s) of flag K
 * that collide with another flag's name or another flag's alias,
 * or `never` when K's aliases are all unique.
 */
type CollidingAliases<
	F extends Record<string, unknown>,
	K extends keyof F & string,
> =
	| (ExtractAllAliases<F[K]> & Exclude<keyof F & string, K>) // alias→name
	| (ExtractAllAliases<F[K]> & AliasesExcluding<F, K>); // alias→alias

/**
 * Per-flag validation mapped type. Resolves to `F` when no collisions exist.
 * For flags with colliding aliases, adds a branded error property to the
 * specific flag definition, causing a type error on that flag's value.
 *
 * Generalized to work with any `Record<string, unknown>` shape — core uses
 * it with `FlagsDef`, the validate package uses it with `FlagShape`, etc.
 *
 * ```
 * Property 'FIX_ALIAS_COLLISION' is missing in type '{ type: "string"; short: "m" }'
 *   but required in type
 *     '{ readonly FIX_ALIAS_COLLISION: "Alias \"m\" collides with another flag name or alias" }'.
 * ```
 */
export type ValidateFlagAliases<F extends Record<string, unknown>> = {
	[K in keyof F & string]: CollidingAliases<F, K> extends never
		? F[K]
		: F[K] & {
				readonly FIX_ALIAS_COLLISION: `Alias "${CollidingAliases<F, K>}" collides with another flag name or alias`;
			};
};

// ────────────────────────────────────────────────────────────────────────────
// Inherited flag cross-collision detection (compile-time, per-flag granularity)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Collects aliases from inherited flags, excluding those whose keys the
 * child overrides (intentional override — child redefines a flag by name).
 */
type InheritedAliasesExcluding<
	I extends Record<string, unknown>,
	OverrideKeys extends string,
> = {
	[K in Exclude<keyof I & string, OverrideKeys>]: ExtractAllAliases<I[K]>;
}[Exclude<keyof I & string, OverrideKeys>];

/**
 * Per-flag cross-collision detection between a child flag K (from local
 * flags F) and the inherited flag set I. Resolves to the colliding
 * identifier, or `never` when no collision exists.
 *
 * Detects three collision classes:
 * 1. Child alias → inherited flag name
 * 2. Child alias → inherited flag alias
 * 3. Child flag name → inherited flag alias
 *
 * Intentional name overrides (child defines a flag with the same key as
 * an inherited flag) are excluded — those are handled by `MergeFlags`.
 */
type CrossCollision<
	I extends Record<string, unknown>,
	F extends Record<string, unknown>,
	K extends keyof F & string,
> =
	| (ExtractAllAliases<F[K]> & Exclude<keyof I & string, keyof F & string>) // child alias → inherited name (excluding overrides)
	| (ExtractAllAliases<F[K]> & InheritedAliasesExcluding<I, keyof F & string>) // child alias → inherited alias
	| (K & InheritedAliasesExcluding<I, keyof F & string>); // child name → inherited alias

/**
 * Per-flag validation mapped type for cross-collisions between inherited
 * and local flags. Resolves to `F` when no collisions exist.
 *
 * When `Inherited` is the wide `FlagsDef` type (root commands with no
 * parent), the validation is skipped to avoid false positives since
 * `keyof FlagsDef` is `string`.
 *
 * ```
 * Property 'FIX_INHERITED_COLLISION' is missing in type '{ type: "string"; aliases: ["verbose"] }'
 *   but required in type
 *     '{ readonly FIX_INHERITED_COLLISION: "\"verbose\" collides with inherited flag" }'.
 * ```
 */
export type ValidateCrossCollisions<
	I extends Record<string, unknown>,
	F extends Record<string, unknown>,
> = string extends keyof I
	? F // Wide type (root command) — skip validation
	: {
			[K in keyof F & string]: CrossCollision<I, F, K> extends never
				? F[K]
				: F[K] & {
						readonly FIX_INHERITED_COLLISION: `"${CrossCollision<I, F, K> & string}" collides with inherited flag`;
					};
		};

// ────────────────────────────────────────────────────────────────────────────
// "no-" prefix validation (compile-time, per-flag granularity)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Detects whether a single alias literal starts with `"no-"`.
 * Resolves to the offending alias, or `never` when it is clean.
 */
type NoPrefixedAlias<A> = A extends `no-${string}` ? A : never;

/**
 * Collects all `"no-"`-prefixed alias literals from a flag definition.
 * Checks both `short` and `aliases` fields.
 * Non-narrowed `string` types resolve to `never` to avoid false positives.
 */
type NoPrefixedAliases<F> =
	| NoPrefixedAlias<ExtractShort<F>>
	| NoPrefixedAlias<ExtractLongAliases<F>>;

/**
 * Per-flag validation mapped type. Resolves to `F` when no `"no-"` prefixes
 * exist on flag names, short aliases, or long aliases. For flags with offending values,
 * adds a branded error property causing a compile-time type error.
 *
 * The `"no-"` prefix is reserved for boolean flag negation (`--no-flag`).
 * Define only the positive form (e.g. `cache`) and use `--no-cache` at runtime.
 *
 * ```
 * Property 'FIX_NO_PREFIX' is missing in type '{ type: "boolean" }'
 *   but required in type
 *     '{ readonly FIX_NO_PREFIX: "Flag name \"no-cache\" must not start with \"no-\"; define \"cache\" instead and use \"--no-cache\" at runtime" }'.
 * ```
 */
export type ValidateNoPrefixedFlags<F extends Record<string, unknown>> = {
	[K in keyof F & string]: K extends `no-${infer Base}`
		? F[K] & {
				readonly FIX_NO_PREFIX: `Flag name "${K}" must not start with "no-"; define "${Base}" instead and use "--no-${Base}" at runtime`;
			}
		: NoPrefixedAliases<F[K]> extends never
			? F[K]
			: F[K] & {
					readonly FIX_NO_PREFIX: `Alias "${NoPrefixedAliases<F[K]>}" must not start with "no-"; the "no-" prefix is reserved for boolean negation`;
				};
};

// ────────────────────────────────────────────────────────────────────────────
// Variadic arg validation (compile-time, per-arg granularity)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Per-arg validation tuple type. Resolves to `A` when the constraint is
 * satisfied (only the last arg is variadic). For non-last args that have
 * `variadic: true`, adds a branded error property to the specific arg.
 *
 * Generalized to work with any ordered tuple of object-typed definitions —
 * core uses it with `ArgsDef`, the validate package uses it with
 * `ArgSpec[]`, etc. Uses `readonly object[]` to avoid TypeScript's weak
 * type detection (all-optional constraint rejection).
 *
 * ```
 * Property 'FIX_VARIADIC_POSITION' is missing in type '{ name: "files"; ... variadic: true }'
 *   but required in type
 *     '{ readonly FIX_VARIADIC_POSITION: "Only the last positional argument can be variadic" }'.
 * ```
 */
export type ValidateVariadicArgs<A extends readonly object[]> =
	A extends readonly [infer Head, ...infer Tail extends readonly object[]]
		? Tail extends readonly [unknown, ...unknown[]]
			? Head extends { variadic: true }
				? readonly [
						Head & {
							readonly FIX_VARIADIC_POSITION: "Only the last positional argument can be variadic";
						},
						...ValidateVariadicArgs<Tail>,
					]
				: readonly [Head, ...ValidateVariadicArgs<Tail>]
			: readonly [Head]
		: A;

// ────────────────────────────────────────────────────────────────────────────
// Flag inheritance utility types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Picks only the flags from `F` that have `inherit: true`.
 *
 * Flags without `inherit` (or with `inherit` omitted) are excluded.
 *
 * @example
 * ```ts
 * type Flags = {
 *   verbose: { type: "boolean"; inherit: true };
 *   port: { type: "number" };
 * };
 * type Result = InheritableFlags<Flags>;
 * // Result = { verbose: { type: "boolean"; inherit: true } }
 * ```
 */
export type InheritableFlags<F extends FlagsDef> = {
	[K in keyof F as F[K] extends { inherit: true } ? K : never]: F[K];
};

/**
 * Merges parent flags with local flags, where local keys override parent keys.
 *
 * @example
 * ```ts
 * type Parent = { verbose: { type: "boolean" }; port: { type: "number" } };
 * type Local = { port: { type: "string" } };
 * type Result = MergeFlags<Parent, Local>;
 * // Result = { verbose: { type: "boolean" }; port: { type: "string" } }
 * ```
 */
export type MergeFlags<
	Parent extends FlagsDef,
	Local extends FlagsDef,
> = Simplify<Omit<Parent, keyof Local> & Local>;

/**
 * Computes the effective flags for a command by filtering the inherited flags
 * (only those with `inherit: true`) and merging them with local flags.
 *
 * Local flags override inherited flags with the same key.
 *
 * @example
 * ```ts
 * type Inherited = {
 *   verbose: { type: "boolean"; inherit: true };
 *   port: { type: "number" };
 * };
 * type Local = { output: { type: "string" } };
 * type Result = EffectiveFlags<Inherited, Local>;
 * // Result = { verbose: { type: "boolean"; inherit: true }; output: { type: "string" } }
 * ```
 */
export type EffectiveFlags<
	Inherited extends FlagsDef,
	Local extends FlagsDef,
> = string extends keyof Inherited
	? Local
	: MergeFlags<InheritableFlags<Inherited>, Local>;

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
