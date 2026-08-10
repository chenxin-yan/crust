import type { BaseValueType } from "@crustjs/utils/primitive";
import type { InferOutput, StandardSchema } from "@crustjs/utils/schema";

import type { Simplify } from "./api/context.ts";

/** Injectable output callbacks threaded through one invocation. */
export interface InvocationIO {
	/** Write a line of standard output (injectable text callback) */
	stdout: (text: string) => void;
	/** Write a line of diagnostic output (injectable text callback) */
	stderr: (text: string) => void;
}

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

/** Resolve a {@link ValueType} literal to its runtime TypeScript type. */
type Resolve<T extends ValueType> = {
	string: string;
	number: number;
	boolean: boolean;
	url: URL;
	path: string;
	json: unknown;
}[T];

/**
 * Resolve the inferred runtime type for a flag/arg definition.
 *
 * When the def declares a `parse` escape hatch (only allowed on `"string"`
 * variants), the inferred type is `ReturnType<typeof parse>`. String defs
 * with a literal `choices` tuple narrow to the union of those literals.
 * Otherwise it delegates to {@link Resolve} on the declared `type`.
 */
type ResolveBaseType<F> = F extends {
	parse: (raw: string) => infer R;
}
	? R
	: F extends { type: "string"; choices: readonly (infer C extends string)[] }
		? C
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
	 * is applied. Also consumed by shell-completion extensions
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
 * output type reaches the Command Action. Core value options (`type`,
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
	 * is applied. Also consumed by shell-completion extensions
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
	 * that flows to the `run` action. The return type is inferred and
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
	/** When `true`, reject `--no-{name}` (and negated aliases) at parse time and hide the generated help label */
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
	 * extensions (e.g. `@crustjs/extensions/completion`) to emit value candidates.
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
	/** When `true`, reject `--no-{name}` (and negated aliases) at parse time and hide the generated help label */
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

/** Shared fields for schema-backed flags (exclusive mode) */
interface SchemaFlagBase extends Omit<FlagDefBase, "schema" | "required"> {
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
	/** When `true`, reject `--no-{name}` (and negated aliases) at parse time and hide the generated help label */
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
// Named definitions — the public authoring shape for flags
// ────────────────────────────────────────────────────────────────────────────

/**
 * A flag definition that carries its own name — the authoring shape
 * produced by `defineFlag(name, def)` or written inline as an object
 * literal (`{ name: "dry-run", type: "boolean" }`) and attached with the
 * variadic `.flags(...defs)`.
 */
export type NamedFlagDef = FlagDef & { readonly name: string };

/**
 * Derive the internal `FlagsDef` record from a tuple of named flag
 * definitions: each definition's `name` literal becomes a key, its value
 * the definition without `name`.
 *
 * The `extends infer R extends FlagsDef` step defers evaluation so the
 * result satisfies `FlagsDef` in generic positions.
 */
export type NamedFlagsRecord<Defs extends readonly NamedFlagDef[]> = {
	[D in Defs[number] as D["name"]]: Omit<D, "name">;
} extends infer R extends FlagsDef
	? R
	: never;

// ────────────────────────────────────────────────────────────────────────────
// Effective flag utility types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Merges two flag sets as a flat intersection.
 *
 * Override-wins semantics are unnecessary: a shared key across the two sets
 * is branded at compile time (`DuplicateNameBrand`,
 * `ExistingFlagCollisionBrand`, `ProvideChecks`) and throws at runtime, so
 * valid programs never merge overlapping records. A plain intersection stays
 * flat in the checker — chained `.flags()`/`.provide()` calls cost constant
 * instantiation depth, where per-call merge layers (mapped type or
 * `Simplify<Omit & …>`) nested and hit TS2589 at ~47 / ~31 chained calls.
 */
export type MergeFlags<Base extends FlagsDef, Override extends FlagsDef> = Base & Override;

/** Computes a command's action-visible flags from local and Context-owned definitions. */
export type EffectiveFlags<Local extends FlagsDef, Owned extends FlagsDef = {}> = Local & Owned;

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
	: A extends { type: ValueType }
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
		: // Raw args (no `type`, no `schema`) still enforce `choices` at parse
			// time, so a literal tuple narrows the raw string token the same way.
			A extends { choices: readonly (infer C extends string)[] }
			? A extends { variadic: true }
				? C[]
				: A extends { required: true }
					? C
					: A extends { default: unknown }
						? C
						: C | undefined
			: A extends { variadic: true }
				? unknown[]
				: unknown;

/**
 * Recursively converts an ArgsDef tuple into a named object type.
 *
 * Each element's `name` literal becomes a key, and its value is resolved
 * via {@link InferArgValue}. Uses intersection + `Simplify` to flatten.
 *
 * Deliberately recursive rather than key-remapped over `A[number]`:
 * intersection turns duplicate arg names with conflicting types into
 * `never`; builder registration also rejects duplicate positional names at
 * runtime. A widened non-tuple `ArgsDef` resolves to `{}` instead of a
 * string-indexed record.
 */
type InferArgsTuple<A extends readonly ArgDef[]> = A extends readonly [
	infer Head extends ArgDef,
	...infer Tail extends readonly ArgDef[],
]
	? { [K in Head["name"]]: InferArgValue<Head> } & InferArgsTuple<Tail>
	: {};

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
	: F extends { multiple: true }
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
				: ResolveBaseType<F> | undefined;

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
	 * `defineCommand("issue", { aliases: ["issues", "i"] }, recipe)` makes
	 * `cli issue`, `cli issues`, and `cli i` all route to the same command node.
	 *
	 * **Conflict policy.** Alias strings must not collide with this command's
	 * own canonical `name`, with any sibling's `name`, or with any sibling's
	 * own alias. Collisions throw a `CrustError("DEFINITION", …)` during
	 * normalization, including for Extension-installed subcommands. Each alias
	 * must also be a non-empty string with no
	 * whitespace and must not start with `-`.
	 *
	 * **Display contract.** Help output renders the canonical name with
	 * aliases inline as `name (a, b, c)`. The canonical `name` is what
	 * appears in `commandPath`, error messages, and suggestions from
	 * `didYouMean` — it does not depend on which alias the user typed.
	 *
	 * @example
	 * defineCommand("issue", { aliases: ["issues", "i"] }, recipe)
	 */
	aliases?: readonly string[];
	/**
	 * When `true`, omit this command from every tooling surface that
	 * enumerates the command tree for users:
	 *
	 * - `help` rendered output (subcommand list + USAGE token)
	 * - `@crustjs/man` generated man pages (`SUBCOMMANDS` section)
	 * - `completion` candidate lists (recursively — hidden
	 *   subcommands and their descendants never appear in generated
	 *   bash/zsh/fish scripts)
	 * - `didYouMean` typo suggestions and "Available commands"
	 *   list (so internal names never surface in error UX)
	 * - `skill` manifests
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
	 * extension's `setup()` hook without describing it (omit `description`),
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
