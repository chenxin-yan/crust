import type { BaseValueType, ResolvePrimitive } from "@crustjs/utils/primitive";
import type { InferOutput, StandardSchema } from "@crustjs/utils/schema";

// ────────────────────────────────────────────────────────────────────────────
// Primitive type vocabulary
// ────────────────────────────────────────────────────────────────────────────

/**
 * Supported type literals for args and flags.
 *
 * Extends `BaseValueType` (`"string" | "number" | "boolean"`) with three
 * formatted built-ins:
 *
 * - `"url"`  — the raw value is parsed via `new URL()` into a {@link URL}
 * - `"path"` — the raw value is expanded (`~`) and resolved against
 *              `process.cwd()` into an absolute `string`
 * - `"json"` — the raw value is parsed via `JSON.parse()` into `unknown`
 */
export type ValueType = BaseValueType | "url" | "path" | "json";

/**
 * Resolve a {@link ValueType} literal to its runtime TypeScript type.
 *
 * Delegates to `ResolvePrimitive<T>` for the three base types; maps the
 * three formatted types (`"url"`, `"path"`, `"json"`) to `URL`, `string`,
 * and `unknown` respectively.
 */
export type Resolve<T extends ValueType> = T extends BaseValueType
	? ResolvePrimitive<T>
	: T extends "url"
		? URL
		: T extends "path"
			? string
			: T extends "json"
				? unknown
				: never;

/**
 * Resolve the inferred runtime type for a flag/arg definition.
 *
 * When the def declares a `parse` escape hatch (only allowed on `"string"`
 * variants), the inferred type is `ReturnType<typeof parse>`. Otherwise it
 * delegates to {@link Resolve} on the declared `type`.
 */
export type ResolveBaseType<F> = F extends {
	parse: (raw: string) => infer R;
}
	? R
	: F extends { type: infer T extends ValueType }
		? Resolve<T>
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
	/**
	 * When `true`, the parser throws if the argument is not provided.
	 *
	 * For variadic args, this means the array cannot be empty — the runtime
	 * value is still `T[]`, just rejected when it has length 0.
	 */
	required?: true;
	/** Not supported with core value options — see {@link SchemaArgDef} */
	schema?: never;
	/**
	 * When `true`, collects all remaining positional values into an array.
	 *
	 * The inferred TypeScript type is always `T[]` — never `T[] | undefined` —
	 * regardless of `required` or `default`. `required` only controls whether
	 * an empty array fails validation; it does not change the runtime shape
	 * or the inferred type.
	 */
	variadic?: true;
}

/** A positional argument whose value is a string */
interface StringArgDef extends ArgDefBase {
	type: "string";
	/** Default string value when the argument is not provided */
	default?: string;
	/**
	 * Static enum of valid values for this argument.
	 *
	 * Validated at parse time before `parse` runs. Passing a value outside
	 * `choices` throws `CrustError("PARSE", …)` before any `parse` transform
	 * is applied. Also consumed by shell-completion plugins
	 * (e.g. `@crustjs/extensions/completion`) to emit value candidates.
	 *
	 * Only available on string-typed args; not supported on number/boolean.
	 *
	 * @example
	 * { name: "target", type: "string", choices: ["browser", "bun", "node"] }
	 */
	choices?: readonly string[];
	/**
	 * Custom synchronous parser for the raw argv string. Runs per element
	 * for variadic args. See {@link StringFlagDef.parse} for full semantics.
	 *
	 * @example
	 * { name: "port", type: "string", parse: (s) => Number(s) }
	 */
	parse?: (raw: string) => unknown;
}

/** A positional argument whose value is a number */
interface NumberArgDef extends ArgDefBase {
	type: "number";
	/** Default number value when the argument is not provided */
	default?: number;
	/** Not supported on number args — use `type: "string"` with `parse`. */
	parse?: never;
}

/** A positional argument whose value is a boolean */
interface BooleanArgDef extends ArgDefBase {
	type: "boolean";
	/** Default boolean value when the argument is not provided */
	default?: boolean;
	/** Not supported on boolean args — use `type: "string"` with `parse`. */
	parse?: never;
}

/** A positional argument whose value is a {@link URL} */
interface UrlArgDef extends ArgDefBase {
	type: "url";
	/** Default URL value when the argument is not provided */
	default?: URL;
	/** Not supported on url args — use `type: "string"` with `parse`. */
	parse?: never;
}

/** A positional argument whose value is an absolute filesystem path */
interface PathArgDef extends ArgDefBase {
	type: "path";
	/** Default path string when the argument is not provided */
	default?: string;
	/** Not supported on path args — use `type: "string"` with `parse`. */
	parse?: never;
}

/** A positional argument whose value is JSON parsed to `unknown` */
interface JsonArgDef extends ArgDefBase {
	type: "json";
	/** Default parsed JSON value when the argument is not provided */
	default?: unknown;
	/** Not supported on json args — use `type: "string"` with `parse`. */
	parse?: never;
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
interface RawArgDef extends ArgDefBase {
	/** Optional parser hint. Omit for raw schema-backed validation. */
	type?: never;
	/** Raw default value when the argument is not provided */
	default?: unknown;
	choices?: readonly string[];
	/** Not supported on raw args — schema validators own the transform. */
	parse?: never;
}

/**
 * A positional argument validated by a Standard Schema (exclusive mode).
 *
 * The schema receives the raw string token (`string | undefined` when the
 * argument is absent; `string[]` for variadic args) and exclusively owns
 * coercion, defaults, requiredness, choices, and validation. Its inferred
 * output type reaches the Command Handler. Core value options (`type`,
 * `default`, `required`, `choices`, `parse`) cannot be mixed in.
 */
interface SchemaArgDef {
	/** The argument name (used as the key in the parsed result and in help text) */
	name: string;
	/** Human-readable description for help text */
	description?: string;
	/** When `true`, collects all remaining raw tokens into a `string[]` for the schema */
	variadic?: true;
	/** Standard Schema that owns coercion, defaults, requiredness, and validation */
	schema: StandardSchema;
	type?: never;
	required?: never;
	default?: never;
	choices?: never;
	parse?: never;
}

export type ArgDef =
	| StringArgDef
	| NumberArgDef
	| BooleanArgDef
	| UrlArgDef
	| PathArgDef
	| JsonArgDef
	| SchemaArgDef
	| RawArgDef;

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
	/** Not supported with core value options — see {@link SchemaStringFlagDef} */
	schema?: never;
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
	/**
	 * Static enum of valid values for this flag.
	 *
	 * Validated at parse time before `parse` runs. Passing a value outside
	 * `choices` throws `CrustError("PARSE", …)` before any `parse` transform
	 * is applied. Also consumed by shell-completion plugins
	 * (e.g. `@crustjs/extensions/completion`) to emit value candidates.
	 *
	 * Only available on string-typed flags; not supported on number/boolean.
	 *
	 * @example
	 * { type: "string", choices: ["browser", "bun", "node"] }
	 */
	choices?: readonly string[];
	/**
	 * Custom synchronous parser for the raw argv string.
	 *
	 * Receives the raw token as it appeared on the command line (after
	 * `choices` validation, when present) and returns the resolved value
	 * that flows to the `run` handler. The return type is inferred and
	 * becomes the flag's runtime type.
	 *
	 * Constraints:
	 * - Synchronous only. `async` parsers are rejected at command setup
	 *   with `CrustError("DEFINITION", …)`.
	 * - Only allowed on `type: "string"` (single + multi) and string args.
	 *   `parse?: never` on every non-string variant prevents misuse at
	 *   compile time.
	 * - When `default` is set and argv is absent, `parse(String(default))`
	 *   runs so the runtime value matches the inferred type.
	 *
	 * @example
	 * { type: "string", parse: (s) => Number(s) }
	 */
	parse?: (raw: string) => unknown;
}

/** A single-value number flag */
interface NumberFlagDef extends SingleFlagBase {
	type: "number";
	/** Default number value */
	default?: number;
	/** Not supported on number flags — use `type: "string"` with `parse`. */
	parse?: never;
}

/** A single-value boolean flag */
interface BooleanFlagDef extends SingleFlagBase {
	type: "boolean";
	/** Default boolean value */
	default?: boolean;
	/** When `true`, hide the generated `--no-{name}` help label */
	noNegate?: true;
	/** Not supported on boolean flags — use `type: "string"` with `parse`. */
	parse?: never;
}

/** A single-value URL flag (parsed via `new URL()`) */
interface UrlFlagDef extends SingleFlagBase {
	type: "url";
	/** Default URL value */
	default?: URL;
	/** Not supported on url flags — use `type: "string"` with `parse`. */
	parse?: never;
}

/** A single-value path flag (expanded `~` + resolved against `process.cwd()`) */
interface PathFlagDef extends SingleFlagBase {
	type: "path";
	/** Default path string value */
	default?: string;
	/** Not supported on path flags — use `type: "string"` with `parse`. */
	parse?: never;
}

/** A single-value JSON flag (parsed via `JSON.parse()` to `unknown`) */
interface JsonFlagDef extends SingleFlagBase {
	type: "json";
	/** Default parsed JSON value */
	default?: unknown;
	/** Not supported on json flags — use `type: "string"` with `parse`. */
	parse?: never;
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
	/**
	 * Static enum of valid values for each occurrence of this flag.
	 *
	 * Each element is validated at parse time before `parse` runs. Passing
	 * a value outside `choices` throws `CrustError("PARSE", …)` before any
	 * `parse` transform is applied. Also consumed by shell-completion
	 * plugins (e.g. `@crustjs/extensions/completion`) to emit value candidates.
	 *
	 * Only available on string-typed multi-flags; not supported on number/boolean.
	 *
	 * @example
	 * { type: "string", multiple: true, choices: ["unit", "integration"] }
	 */
	choices?: readonly string[];
	/**
	 * Custom synchronous per-element parser for each raw argv string.
	 * See {@link StringFlagDef.parse} for full semantics. Runs once per
	 * occurrence; the resolved value is `ReturnType<typeof parse>[]`.
	 */
	parse?: (raw: string) => unknown;
}

/** A multi-value number flag (collects repeated values into an array) */
interface NumberMultiFlagDef extends MultiFlagBase {
	type: "number";
	/** Default number array value */
	default?: number[];
	/** Not supported — use `type: "string"`, `multiple: true`, with `parse`. */
	parse?: never;
}

/** A multi-value boolean flag (collects repeated values into an array) */
interface BooleanMultiFlagDef extends MultiFlagBase {
	type: "boolean";
	/** Default boolean array value */
	default?: boolean[];
	/** When `true`, hide the generated `--no-{name}` help label */
	noNegate?: true;
	/** Not supported — use `type: "string"`, `multiple: true`, with `parse`. */
	parse?: never;
}

/** A multi-value URL flag (collects repeated URL values into an array) */
interface UrlMultiFlagDef extends MultiFlagBase {
	type: "url";
	/** Default URL array value */
	default?: URL[];
	/** Not supported — use `type: "string"`, `multiple: true`, with `parse`. */
	parse?: never;
}

/** A multi-value path flag (collects repeated path strings into an array) */
interface PathMultiFlagDef extends MultiFlagBase {
	type: "path";
	/** Default path array value */
	default?: string[];
	/** Not supported — use `type: "string"`, `multiple: true`, with `parse`. */
	parse?: never;
}

/** A multi-value JSON flag (collects repeated parsed JSON values) */
interface JsonMultiFlagDef extends MultiFlagBase {
	type: "json";
	/** Default parsed JSON array value */
	default?: unknown[];
	/** Not supported — use `type: "string"`, `multiple: true`, with `parse`. */
	parse?: never;
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
/** Shared fields for schema-backed flags (exclusive mode) */
interface SchemaFlagBase {
	/** Human-readable description for help text */
	description?: string;
	/** Single-character short alias (e.g. `"v"` → `-v`) */
	short?: string;
	/** Additional long aliases (e.g. `["out"]` → `--out`) */
	aliases?: string[];
	/** When `true`, the flag is inherited by subcommands */
	inherit?: true;
	/** Standard Schema that owns coercion, defaults, requiredness, and validation */
	schema: StandardSchema;
	required?: never;
	default?: never;
	choices?: never;
	parse?: never;
}

/**
 * A schema-backed flag that consumes a value token (`--flag value`).
 * The schema receives the raw string (`string | undefined`, or `string[]`
 * with `multiple: true`) and exclusively owns coercion, defaults,
 * requiredness, and validation. `type` declares token consumption only.
 */
interface SchemaStringFlagDef extends SchemaFlagBase {
	type: "string";
	/** When `true`, the flag is repeatable and the schema receives `string[]` */
	multiple?: true;
	noNegate?: never;
}

/**
 * A schema-backed toggle flag (no value token). The schema receives the raw
 * `boolean | undefined` (or `boolean[]` with `multiple: true`).
 */
interface SchemaBooleanFlagDef extends SchemaFlagBase {
	type: "boolean";
	/** When `true`, the flag is repeatable and the schema receives `boolean[]` */
	multiple?: true;
	/** When `true`, disables the auto-generated `--no-<name>` negation */
	noNegate?: true;
}

export type FlagDef =
	| StringFlagDef
	| NumberFlagDef
	| BooleanFlagDef
	| UrlFlagDef
	| PathFlagDef
	| JsonFlagDef
	| SchemaStringFlagDef
	| SchemaBooleanFlagDef
	| StringMultiFlagDef
	| NumberMultiFlagDef
	| BooleanMultiFlagDef
	| UrlMultiFlagDef
	| PathMultiFlagDef
	| JsonMultiFlagDef;

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
type AliasesExcluding<F extends Record<string, unknown>, K extends keyof F & string> = {
	[J in Exclude<keyof F & string, K>]: ExtractAllAliases<F[J]>;
}[Exclude<keyof F & string, K>];

/**
 * Per-flag collision detection: resolves to the alias literal(s) of flag K
 * that collide with another flag's name or another flag's alias,
 * or `never` when K's aliases are all unique.
 */
type CollidingAliases<F extends Record<string, unknown>, K extends keyof F & string> =
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
type InheritedAliasesExcluding<I extends Record<string, unknown>, OverrideKeys extends string> = {
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
export type ValidateVariadicArgs<A extends readonly object[]> = A extends readonly [
	infer Head,
	...infer Tail extends readonly object[],
]
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
export type MergeFlags<Parent extends FlagsDef, Local extends FlagsDef> = Simplify<
	Omit<Parent, keyof Local> & Local
>;

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
> = string extends keyof Inherited ? Local : MergeFlags<InheritableFlags<Inherited>, Local>;

// ────────────────────────────────────────────────────────────────────────────
// InferArgs / InferFlags — Type inference utilities
// ────────────────────────────────────────────────────────────────────────────

/**
 * Infer the resolved type for a single ArgDef:
 *
 * - **variadic** → `primitive[]` (always an array, never `undefined`,
 *   regardless of `required` or `default`)
 * - **required** or **has default** → `primitive` (non-optional)
 * - otherwise → `primitive | undefined`
 *
 * The variadic branch is checked first and takes precedence. Combining
 * `variadic: true` with `required: true` keeps the inferred type as `T[]`;
 * `required` only gates empty-array validation, not the type.
 */
type InferArgValue<A extends ArgDef> = A extends {
	schema: infer S extends StandardSchema;
}
	? InferOutput<S>
	: A extends {
				type: infer _T extends ValueType;
		  }
		? A extends { variadic: true }
			? ResolveBaseType<A>[]
			: A extends { required: true }
				? ResolveBaseType<A>
				: // Narrow on `default` presence, not its type. When `parse` is
					// present the raw default is a string while `ResolveBaseType<A>`
					// is the parsed return type, so a typed-default check would miss.
					// ArgDef's discriminated interfaces already constrain the default
					// shape at the call site.
					A extends { default: unknown }
					? ResolveBaseType<A>
					: ResolveBaseType<A> | undefined
		: A extends { variadic: true }
			? unknown[]
			: A extends { required: true } | { default: unknown }
				? unknown
				: unknown;

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
	: // oxlint-disable-next-line typescript/no-empty-object-type -- empty base case for recursive intersection
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
export type InferArgs<A> = A extends ArgsDef ? Simplify<InferArgsTuple<A>> : Record<string, never>;

/**
 * Infer the resolved type for a single FlagDef:
 *
 * - **multiple** → wraps the resolved type in an array
 * - **required** or **has default** → `primitive` (non-optional)
 * - otherwise → `primitive | undefined`
 */
type InferFlagValue<F extends FlagDef> = F extends {
	schema: infer S extends StandardSchema;
}
	? InferOutput<S>
	: F extends {
				type: infer _T extends ValueType;
		  }
		? F extends { multiple: true }
			? F extends { required: true }
				? ResolveBaseType<F>[]
				: // See InferArgValue: narrow on default presence. With `parse`,
					// the raw default is `string[]` while ResolveBaseType<F> is the
					// parsed element type.
					F extends { default: readonly unknown[] }
					? ResolveBaseType<F>[]
					: ResolveBaseType<F>[] | undefined
			: F extends { required: true }
				? ResolveBaseType<F>
				: F extends { default: unknown }
					? ResolveBaseType<F>
					: ResolveBaseType<F> | undefined
		: never;

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
	/**
	 * Alternative names that resolve to the same command.
	 *
	 * Each entry is a sibling-level alternative for `name`. For example,
	 * `meta: { name: "issue", aliases: ["issues", "i"] }` makes `cli issue`,
	 * `cli issues`, and `cli i` all route to the same command node.
	 *
	 * **Conflict policy.** Alias strings must not collide with this command's
	 * own canonical `name`, with any sibling's `name`, or with any sibling's
	 * own alias. Collisions throw a `CrustError("DEFINITION", …)` at
	 * registration time (or during `validateCommandTree` for plugin-installed
	 * subcommands). Each alias must also be a non-empty string with no
	 * whitespace and must not start with `-`.
	 *
	 * **Display contract.** Help output renders the canonical name with
	 * aliases inline as `name (a, b, c)`. The canonical `name` is what
	 * appears in `commandPath`, error messages, and suggestions from
	 * `didYouMeanPlugin` — it does not depend on which alias the user typed.
	 *
	 * @example
	 * meta: { name: "issue", aliases: ["issues", "i"] }
	 */
	aliases?: readonly string[];
	/**
	 * When `true`, omit this command from every tooling surface that
	 * enumerates the command tree for users:
	 *
	 * - `helpPlugin` rendered output (subcommand list + USAGE token)
	 * - `@crustjs/man` generated man pages (`SUBCOMMANDS` section)
	 * - `completionPlugin` candidate lists (recursively — hidden
	 *   subcommands and their descendants never appear in generated
	 *   bash/zsh/fish scripts)
	 * - `didYouMeanPlugin` typo suggestions and "Available commands"
	 *   list (so internal names never surface in error UX)
	 * - `skillPlugin` manifests
	 *
	 * The command is **only hidden from listings**: routing in
	 * `@crustjs/core` does not consult `meta.hidden`, so it stays fully
	 * invocable by direct name (or alias). The intended use case is
	 * internal/runtime commands like a `__complete` shell-completion
	 * entrypoint. Marking a user-facing command `hidden` is supported but
	 * unusual.
	 *
	 * **Scope: commands only.** There is no analogous `hidden` field on
	 * `FlagDef` or `ArgDef`; flags and positional arguments always surface
	 * in help, completion, and man output. If you need a flag that does
	 * not advertise itself, the workaround is to register it through a
	 * plugin's `setup()` hook without describing it (omit `description`),
	 * which suppresses its description body but still lists the spelling
	 * — there is intentionally no full hide mechanism at the flag layer.
	 *
	 * Tooling contract: any renderer or generator that walks
	 * `subCommands` to produce a user-facing listing should skip nodes
	 * where `meta.hidden === true`.
	 *
	 * @example
	 * meta: { name: "__complete", hidden: true, description: "Internal" }
	 */
	hidden?: boolean;
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
export interface ParseResult<A extends ArgsDef = ArgsDef, F extends FlagsDef = FlagsDef> {
	/** Resolved positional arguments, keyed by arg name */
	args: InferArgs<A>;
	/** Resolved flags, keyed by flag name */
	flags: InferFlags<F>;
	/** Raw arguments that appeared after the `--` separator */
	rawArgs: string[];
}
