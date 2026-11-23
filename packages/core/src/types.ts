import type { JsonValue } from "@crustjs/utils/json";
import type { BaseValueType } from "@crustjs/utils/primitive";
import type { InferInput, InferOutput, StandardSchema } from "@crustjs/utils/schema";

import type { ExtensionId } from "./identity.ts";
import type { IsClosedName, IsStaticTuple, IsUnion } from "./validation/shared.ts";

export type Awaitable<T> = T | Promise<T>;
export type Simplify<T> = { [K in keyof T]: T[K] };

/**
 * One invocation's standard output or standard error. Call it to write `text` and a newline.
 * `isTTY` and `columns` describe the invocation's stream, not the process's: under `run()` and
 * captured `execute()` output, the stream is no terminal unless the caller says so.
 */
export interface OutputStream {
	/** Write `text` and a newline. */
	(text: string): void;
	/** Write text or bytes as they are, adding no newline. */
	readonly write: (chunk: string | Uint8Array) => void;
	/** Whether the stream is a terminal. */
	readonly isTTY: boolean;
	/** The terminal's width in columns; `undefined` when the stream has none, such as a pipe or a file. */
	readonly columns: number | undefined;
}

/**
 * One invocation's standard input. Each read continues where the last one stopped, and throws
 * the invocation's `signal.reason` once it is cancelled, such as by Ctrl-C while waiting for input.
 * A read throws while another reader consumes the stream, such as an MCP stdio server.
 */
export interface InputStream {
	/** Whether the stream is a terminal. */
	readonly isTTY: boolean;
	/** The rest of the input as UTF-8 text, once it ends. */
	text(): Promise<string>;
	/** The rest of the input, chunk by chunk as it arrives. */
	stream(): AsyncIterable<Uint8Array>;
}

/** One invocation's standard streams, as the Command Action, Context setups, and Extension hooks receive them. */
export interface InvocationIO {
	readonly stdin: InputStream;
	/** What the command produces. */
	readonly stdout: OutputStream;
	/** Messages for people: progress, warnings, and errors. */
	readonly stderr: OutputStream;
}

/** An output stream an `execute()` caller passes instead of the process's. A Node.js writable stream fits. */
export interface OutputSink {
	/**
	 * Receives each write as it was made: `stdout(text)` arrives as one chunk, `text` and a newline.
	 * A sink that keeps a byte chunk must copy it, since the writer may reuse its buffer.
	 */
	readonly write: (chunk: string | Uint8Array) => void;
	/** Read on each `isTTY` access; absent means no terminal. */
	readonly isTTY?: boolean | undefined;
	/** Read on each `columns` access. */
	readonly columns?: number | undefined;
}

/**
 * Caller options for one programmatic `run()` invocation: output callbacks, action events, and cancellation.
 * Typed `run()` sets `Event` to the values the selected command's async generator action yields.
 * Its output streams are no terminal, and its `stdin` is the process's.
 */
export interface InvocationOptions<Event = unknown> {
	/** Receives each stdout write live, as it was made: `stdout(text)` arrives as `text` and a newline. */
	stdout?: (chunk: string | Uint8Array) => void;
	/** Receives each stderr write live, as it was made. */
	stderr?: (chunk: string | Uint8Array) => void;
	/** Aborting it aborts the invocation's `ctx.signal` with the same reason. */
	signal?: AbortSignal;
	/**
	 * Receives each value an async generator Command Action yields, as it is yielded,
	 * after the selected Renderer's `event`. A throw fails the invocation.
	 */
	onEvent?: (event: Event) => void;
}

/**
 * Caller options for the terminal `execute()` boundary. While an invocation
 * runs, the first `SIGINT` (Ctrl-C) or `SIGTERM` aborts its `ctx.signal` with an
 * `AbortError` whose `cause` names the signal (`"SIGINT"` or `"SIGTERM"`). Once the action,
 * `postRun` hooks and Context cleanup finish, whatever the action did, `execute()` resolves
 * to `130` after `SIGINT` or `143` after `SIGTERM`, and the process dies by that signal once
 * its event loop drains, after the caller's code (shells see `130` / `143`). Calling `process.exit()` or changing `process.exitCode`
 * first keeps that exit instead; `process.exitCode` holds `130` / `143` when another
 * listener owns the signal, on Windows, or with injected `io`, which never re-raises. A second signal terminates
 * unless another listener owns it. A signal within 50 ms of the first is treated as the
 * same one, relayed by a parent process such as `npm run` or `npx`, or sent again by a
 * process-group kill.
 *
 * On macOS and Linux, a failed write to the default stdout throws from `stdout()` and
 * `stdout.write()`. Once the reader is gone (`cli | head`), it throws an `AbortError` whose
 * `cause` is `"SIGPIPE"` and aborts `ctx.signal` with it: the run ends silently with `141`
 * (128 + SIGPIPE), whatever the action did, without a re-raise. Any other error (`ENOSPC` from
 * `cli > /dev/full`) is thrown as it is and fails the run like any error. A failed write to the
 * default stderr is ignored.
 */
export interface ExecuteOptions {
	/** Arguments to parse; defaults to `process.argv.slice(2)`. */
	argv?: readonly string[];
	/**
	 * Streams that replace the process's, such as in in-process tests; each one omitted stays the
	 * process's. `stdin` takes any async iterable of text or bytes, such as a Node.js readable
	 * stream; its `isTTY` answers `stdin.isTTY`. An iterable the action did not read to its end is
	 * closed when the invocation ends (its `return()` is called); a Node.js readable is left open
	 * and paused. Setting any of them, `stdin` alone included, runs the invocation in process: a
	 * cancelling signal only sets the exit code and never re-raises.
	 * On macOS and Linux, the process's stdout and stderr are written synchronously to file
	 * descriptor 1 or 2, so patching `process.stdout.write` does not capture them. Windows writes
	 * through `process.stdout` / `process.stderr`.
	 */
	io?: {
		stdin?: AsyncIterable<string | Uint8Array> & { readonly isTTY?: boolean | undefined };
		stdout?: OutputSink;
		stderr?: OutputSink;
	};
	/**
	 * Caller-owned cancellation; aborting it aborts the invocation's `ctx.signal`
	 * with the same reason. If work throws that reason, an `AbortError` exits `130`
	 * and other errors exit as any failure does. Effect signal interruption instead becomes an
	 * `AbortError`, regardless of the caller's reason.
	 */
	signal?: AbortSignal;
	/**
	 * Receives each value an async generator Command Action yields, as it is yielded,
	 * after the selected Renderer's `event`. Core never prints events. A throw fails the invocation.
	 */
	onEvent?: (event: unknown) => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Primitive type vocabulary
// ────────────────────────────────────────────────────────────────────────────

/**
 * Supported type literals for args and flags.
 *
 * Extends `BaseValueType` (`"string" | "number" | "boolean"`) with four
 * formatted built-ins:
 *
 * - `"integer"` — digits with an optional leading minus, into a `number`
 * - `"url"`  — the raw value is parsed via `new URL()` into a {@link URL}
 * - `"path"` — the raw value is expanded (`~`) and resolved against
 *              `process.cwd()` into an absolute `string`
 * - `"json"` — the raw value is parsed via `JSON.parse()` into `unknown`
 *
 * A `"number"` is a finite decimal (`-1.5`, `2e3`): no hex, no `Infinity`, no
 * surrounding spaces. A `"boolean"` given as text (a positional argument or an
 * environment variable) is `true`, `1`, `yes` or `on`, or `false`, `0`, `no` or
 * `off`, in any letter case. Flags also have `"count"`; see {@link FlagDef}.
 */
export type ValueType = BaseValueType | "integer" | "url" | "path" | "json";

/** Resolve a {@link ValueType} literal to its runtime TypeScript type. */
type Resolve<T extends ValueType> = {
	string: string;
	number: number;
	integer: number;
	boolean: boolean;
	url: URL;
	path: string;
	json: unknown;
}[T];

/** Inclusive bounds of a `number` or `integer` value, checked wherever a value is supplied; not on `default`. */
interface NumberRange {
	/** The smallest value accepted. */
	min?: number;
	/** The largest value accepted. */
	max?: number;
}

/** `min` and `max` are only for `number` and `integer`. */
interface NoRange {
	min?: never;
	max?: never;
}

/**
 * Resolve the inferred runtime type for a flag/arg definition.
 *
 * When the def declares a `parse` escape hatch (only allowed on `"string"`
 * variants), the inferred type is `ReturnType<typeof parse>`. Optional parsers
 * also retain the unparsed output branch. String defs
 * with a literal `choices` tuple narrow to the union of those literals.
 * Otherwise it delegates to {@link Resolve} on the declared `type`.
 */
type ResolveBaseType<F> = "parse" extends keyof F
	? F["parse"] extends infer Parse
		? Parse extends (raw: string) => infer R
			? R
			: ResolveUnparsedType<F>
		: never
	: ResolveUnparsedType<F>;

type ResolveUnparsedType<F> = F extends {
	type: "string";
	choices: readonly (infer C extends string)[];
}
	? C
	: F extends { type: infer T extends ValueType }
		? Resolve<T>
		: never;

// ────────────────────────────────────────────────────────────────────────────
// ArgDef — Positional argument definition (discriminated by `type`)
// ────────────────────────────────────────────────────────────────────────────

/**
 * How a list argument collects its values; see {@link ArgDefBase.variadic}.
 *
 * - `true` — the remaining positional values
 * - `"afterDoubleDash"` — only the words after `--` (`npm run`, `cargo run`)
 * - `"passthrough"` — every word from the command's first positional on, kept as typed
 *   (`docker run`, `pnpm run`)
 */
export type VariadicMode = true | "afterDoubleDash" | "passthrough";

/** Shared fields present on every positional argument definition */
interface ArgDefBase {
	/** The argument name (used as the key in the parsed result and in help text) */
	name: string;
	/** Human-readable description for help text */
	description?: string;
	/**
	 * When `true`, the parser throws if the argument is not provided.
	 *
	 * For variadic args without a default, the validated output is a nonempty tuple.
	 */
	required?: true;
	/** Not supported with core value options — see {@link SchemaArgDef} */
	schema?: never;
	/**
	 * Collects values into an array, in one of three modes:
	 *
	 * - `true`: the remaining positional values. Words after `--` are never read
	 *   as flags but fill arguments like any others. Last, or directly before a
	 *   final `"afterDoubleDash"` argument.
	 * - `"afterDoubleDash"`: only the words after `--` (like clap's `Arg::last`):
	 *   `run <task> [pkgs...] -- <extra...>`. Earlier arguments then fill only from
	 *   words before `--`. Last.
	 * - `"passthrough"`: the command reads flags only before its first positional;
	 *   from there on every word is kept as typed, a later `--` included, and the
	 *   words this argument's predecessors do not take are its values:
	 *   `run [options] <image> [command...]`. A `--` before the first positional
	 *   still ends flags. Last.
	 *
	 * Typed `run()` and command input supply every mode by name, as an array.
	 * The validated output is always an array, never `undefined`.
	 * Required core variadics without defaults infer `[T, ...T[]]` after
	 * required validation; other core variadics infer `T[]`.
	 */
	variadic?: VariadicMode;
}

/** A positional argument whose value is a string */
interface StringArgDef<ParseOutput = unknown> extends ArgDefBase, NoRange {
	type: "string";
	/** Default string value when the argument is not provided */
	default?: string;
	/**
	 * Static enum of valid values for this argument.
	 *
	 * Checked for argv and structured invocation input before `parse` runs.
	 * Typed input also proves membership statically. Passing a value outside
	 * `choices` throws `CrustError("PARSE", …)` before any `parse` transform
	 * is applied. Also consumed by shell-completion extensions
	 * (e.g. `@crustjs/extensions`) to emit value candidates.
	 *
	 * Only available on string-typed args; not supported on number/boolean.
	 *
	 * @example
	 * { name: "target", type: "string", choices: ["browser", "bun", "node"] }
	 */
	choices?: readonly string[];
	/**
	 * Custom synchronous parser for the raw argv string. Runs after `choices`
	 * validation and per element for variadic args. Its return type becomes the
	 * argument's inferred runtime type; declared defaults are parsed too.
	 *
	 * @example
	 * { name: "port", type: "string", parse: (s) => Number(s) }
	 */
	parse?: (raw: string) => ParseOutput;
}

/** A positional argument whose value is a number */
interface NumberArgDef extends ArgDefBase, NumberRange {
	type: "number";
	choices?: never;
	/** Default number value when the argument is not provided */
	default?: number;
	/** Not supported on number args — use `type: "string"` with `parse`. */
	parse?: never;
}

/** A positional argument whose value is an integer */
interface IntegerArgDef extends ArgDefBase, NumberRange {
	type: "integer";
	choices?: never;
	/** Default integer value when the argument is not provided */
	default?: number;
	/** Not supported on integer args — use `type: "string"` with `parse`. */
	parse?: never;
}

/** A positional argument whose value is a boolean */
interface BooleanArgDef extends ArgDefBase, NoRange {
	type: "boolean";
	choices?: never;
	/** Default boolean value when the argument is not provided */
	default?: boolean;
	/** Not supported on boolean args — use `type: "string"` with `parse`. */
	parse?: never;
}

/** A positional argument whose value is a {@link URL} */
interface UrlArgDef extends ArgDefBase, NoRange {
	type: "url";
	choices?: never;
	/** Default URL value when the argument is not provided */
	default?: URL;
	/** Not supported on url args — use `type: "string"` with `parse`. */
	parse?: never;
}

/** A positional argument whose value is an absolute filesystem path */
interface PathArgDef extends ArgDefBase, NoRange {
	type: "path";
	choices?: never;
	/** Default path string when the argument is not provided */
	default?: string;
	/** Not supported on path args — use `type: "string"` with `parse`. */
	parse?: never;
}

/** A positional argument whose value is JSON parsed to `unknown` */
interface JsonArgDef extends ArgDefBase, NoRange {
	type: "json";
	choices?: never;
	/** Default parsed JSON value when the argument is not provided */
	default?: unknown;
	/** Not supported on json args — use `type: "string"` with `parse`. */
	parse?: never;
}

/**
 * A positional argument validated by a Standard Schema (exclusive mode).
 *
 * The schema receives the raw string token (`string | undefined` when the
 * argument is absent; `string[]` for variadic args) and exclusively owns
 * coercion, defaults, requiredness, choices, and validation. TypeScript rejects
 * a schema whose input type cannot accept a present token. Its inferred
 * output type reaches the Command Action. Core value options (`type`,
 * `default`, `required`, `choices`, `parse`) cannot be mixed in.
 */
interface SchemaArgDef extends NoRange {
	/** The argument name (used as the key in the parsed result and in help text) */
	name: string;
	/** Human-readable description for help text */
	description?: string;
	/** Collects tokens into a `string[]` for the schema; see `ArgDef`'s `variadic` */
	variadic?: VariadicMode;
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
 * Discriminated by `type` for type-safe `default` values. `required` only
 * accepts `true`; `variadic` takes a {@link VariadicMode}.
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
	| IntegerArgDef
	| BooleanArgDef
	| UrlArgDef
	| PathArgDef
	| JsonArgDef
	| SchemaArgDef;

/** Ordered tuple of positional argument definitions */
export type ArgsDef = readonly ArgDef[];

// ────────────────────────────────────────────────────────────────────────────
// FlagDef — Named flag definition (discriminated by `type` × `multiple`)
// ────────────────────────────────────────────────────────────────────────────

/** Shared fields present on every flag definition */
interface FlagDefBase {
	/** Human-readable description for help text */
	description?: string;
	/** Single-character (one code point) short alias (e.g. `"v"` → `-v`) */
	short?: string;
	/** Additional aliases (e.g. `["out"]` → `--out`); one-character aliases also accept one dash. */
	aliases?: readonly string[];
	/** When `true`, the parser throws if the flag is not provided */
	required?: true;
	/** Not supported with core value options — see {@link SchemaStringFlagDef} */
	schema?: never;
	/**
	 * Parsed as usual, but left out of every listing: help, man pages, completion, skills, and
	 * command input schemas, as for a hidden command.
	 */
	hidden?: boolean;
	/**
	 * Why the flag is deprecated, and what to use instead. Giving the flag on the command line
	 * prints one warning with it on stderr; help marks the flag. Independent of `hidden`.
	 */
	deprecated?: string;
	/**
	 * Flags of the same `.flags()` record this one needs: given without them, from the command
	 * line, the environment, or typed input, the invocation is a usage error. A default does
	 * not count as given, nor does a boolean's `false`.
	 *
	 * @example
	 * { jq: { type: "string", requires: ["json"] }, json: { type: "boolean" } }
	 */
	requires?: readonly string[];
	/** Only an exclusive group has members — see {@link ExclusiveFlagDef} */
	flags?: never;
}

/**
 * Environment fallback for a flag that argv or structured `run()` input omits: a variable
 * name, or a list of names where the first one that is set wins. Help shows the names, never
 * the values.
 */
export type FlagEnv = string | readonly [string, ...string[]];

/** Occurrence fields of a single-value flag — `multiple` and `delimiter` must be omitted. */
interface SingleOccurrenceFields {
	/** Environment fallback; argv wins over env, which wins over the default. */
	env?: FlagEnv;
	/** Must be omitted for single-value flags — set to `true` for multi-value */
	multiple?: never;
	/** Only repeatable flags split values — see {@link RepeatableOccurrenceFields} */
	delimiter?: never;
}

/** Occurrence fields of a repeatable flag — `multiple` is required as `true`. */
interface RepeatableOccurrenceFields {
	/** Environment fallback; its text is one occurrence unless `delimiter` is set. */
	env?: FlagEnv;
	/** Collect repeated values into an array */
	multiple: true;
	/**
	 * Split each string argv value, and the environment variable's text, into separate
	 * occurrences (`--tags a,b` with `","` is two occurrences). Empty segments are dropped.
	 * Boolean argv switches stay booleans. Opt-in with no default; structured `run()`
	 * arrays are never split.
	 */
	delimiter?: string;
}

// ── Core-value flags ─────────────────────────────────────────────────────

/** Base for single-value flags — `multiple` must be omitted */
interface SingleFlagBase extends FlagDefBase, SingleOccurrenceFields {}

/** Base for multi-value flags — `multiple` is required as `true` */
interface MultiFlagBase extends FlagDefBase, RepeatableOccurrenceFields {}

type StringFlagFields<Default, ParseOutput> = {
	/** Default string value, or string array for a multi-value flag. */
	default?: Default;
	/**
	 * Static enum of valid values for this flag.
	 *
	 * Checked for argv and structured invocation input before `parse` runs.
	 * Typed input also proves membership statically. Passing a value outside
	 * `choices` throws `CrustError("PARSE", …)` before any `parse` transform
	 * is applied. Also consumed by shell-completion extensions.
	 */
	choices?: readonly string[];
	/**
	 * Custom synchronous parser for the raw argv string. For multi-value
	 * flags it runs once per occurrence. The return type becomes the flag's
	 * inferred runtime value type.
	 */
	parse?: (raw: string) => ParseOutput;
	negatable?: never;
} & NoRange;

type TypedFlagFields<T extends Exclude<ValueType, "string">, Default> = {
	/** Default value, or value array for a multi-value flag. */
	default?: Default;
	choices?: never;
	/**
	 * Boolean flags only: also accept `--no-<name>` (and `--no-<alias>`) for `false`, such as
	 * to override an environment variable. A flag with `default: true` accepts it without
	 * this, and only such a flag lists it in help.
	 */
	negatable?: T extends "boolean" ? true : never;
	/** Use `type: "string"` with `parse` for custom parsing. */
	parse?: never;
} & (T extends "number" | "integer" ? NumberRange : NoRange);

type CoreFlagFields<T extends ValueType, Default, ParseOutput> = T extends "string"
	? StringFlagFields<Default, ParseOutput>
	: T extends Exclude<ValueType, "string">
		? TypedFlagFields<T, Default>
		: never;

/** A single-value core flag for the declared value type. */
type TypedFlagDef<T extends ValueType, ParseOutput = unknown> = SingleFlagBase & {
	type: T;
} & CoreFlagFields<T, Resolve<T>, ParseOutput>;

/** A repeatable core flag for the declared value type. */
type TypedMultiFlagDef<T extends ValueType, ParseOutput = unknown> = MultiFlagBase & {
	type: T;
} & CoreFlagFields<T, readonly Resolve<T>[], ParseOutput>;

/** Shared fields for schema-backed flags (exclusive mode) */
interface SchemaFlagBase extends Omit<FlagDefBase, "schema" | "required">, NoRange {
	/** Standard Schema that owns coercion, defaults, requiredness, and validation */
	schema: StandardSchema;
	required?: never;
	default?: never;
	choices?: never;
	parse?: never;
}

/**
 * A schema-backed flag that consumes a value token (`--flag value`).
 * The schema receives the raw string (`string | undefined`, or
 * `string[] | undefined` with `multiple: true`) and exclusively owns coercion,
 * defaults, requiredness, and validation; its input type must accept a present
 * token. `type` declares token consumption only.
 */
type SchemaStringFlagDef = SchemaFlagBase & {
	type: "string";
	negatable?: never;
} & (SingleOccurrenceFields | RepeatableOccurrenceFields);

/**
 * A schema-backed toggle flag (no value token). The schema receives the raw
 * `boolean | undefined` (or `boolean[] | undefined` with `multiple: true`).
 */
type SchemaBooleanFlagDef = SchemaFlagBase & {
	type: "boolean";
	/** Also accept `--no-<name>` (and `--no-<alias>`) for `false`; help does not list it. */
	negatable?: true;
} & (SingleOccurrenceFields | RepeatableOccurrenceFields);

/**
 * A schema-backed flag whose value token is JSON text. The schema receives the
 * parsed JSON value (`JsonValue | undefined`); structured input (`run()`,
 * `--input`, MCP) passes the JSON value itself. Its input type must accept JSON
 * data, and its input JSON Schema becomes the flag's command input property.
 */
type SchemaJsonFlagDef = SchemaFlagBase & {
	type: "json";
	negatable?: never;
} & SingleOccurrenceFields;

/**
 * A flag that counts its occurrences: `-vvv` gives `3`, and an omitted flag `0`. It takes
 * no value and has no negation.
 */
interface CountFlagDef extends Omit<FlagDefBase, "required">, NoRange {
	type: "count";
	required?: never;
	default?: never;
	env?: never;
	multiple?: never;
	delimiter?: never;
	choices?: never;
	parse?: never;
	negatable?: never;
}

/**
 * A member of an {@link ExclusiveFlagDef}: a single-value core flag with its own spellings,
 * and no `default`, `required`, `negatable`, or `requires`, which belong to the group.
 */
export type ExclusiveMemberDef = {
	[T in ValueType]: TypedFlagDef<T> & {
		default?: never;
		required?: never;
		negatable?: never;
		requires?: never;
	};
}[ValueType];

/**
 * Mutually exclusive flags, declared as one flags entry: at most one member is given, or
 * exactly one with `required: true`. The members keep their own spellings; the entry's
 * value is `{ flag, value }` for the member given (`{ flag }` for a boolean member), or
 * `undefined`. Typed `run()` and `--input` take the same shape. Sources are compared level
 * by level: the first of the command line and the environment where any member has a value
 * decides, and two members there is a usage error naming both. Member names share the
 * command's flag namespace.
 *
 * @example
 * ```ts
 * scope: {
 *   type: "exclusive",
 *   required: true,
 *   flags: { "org-id": { type: "string" }, all: { type: "boolean" } },
 * }
 * // flags.scope: { flag: "org-id"; value: string } | { flag: "all" }
 * ```
 */
export interface ExclusiveFlagDef extends NoRange {
	type: "exclusive";
	/** When `true`, one member must be given */
	required?: true;
	/** The members, keyed by their canonical names */
	flags: Readonly<Record<string, ExclusiveMemberDef>>;
	description?: never;
	short?: never;
	aliases?: never;
	schema?: never;
	hidden?: never;
	deprecated?: never;
	requires?: never;
	env?: never;
	multiple?: never;
	delimiter?: never;
	default?: never;
	choices?: never;
	parse?: never;
	negatable?: never;
}

/**
 * Defines a single named flag for a CLI command.
 *
 * Discriminated by `type` and `multiple` for type-safe `default` values.
 * Boolean toggle fields (`required`, `multiple`) only accept `true`.
 * Besides the {@link ValueType}s, `type: "count"` counts occurrences (`-vvv` is `3`), and
 * `type: "exclusive"` declares a group of mutually exclusive flags ({@link ExclusiveFlagDef}).
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
	| { [T in ValueType]: TypedFlagDef<T> | TypedMultiFlagDef<T> }[ValueType]
	| CountFlagDef
	| SchemaStringFlagDef
	| SchemaBooleanFlagDef
	| SchemaJsonFlagDef
	| ExclusiveFlagDef;

/** Record mapping flag names to their definitions */
export type FlagsDef = Record<string, FlagDef>;

/** Distribute `Omit<_, "name">` over a definition union. */
export type OmitName<D> = D extends unknown ? Omit<D, "name"> : never;

// ────────────────────────────────────────────────────────────────────────────
// Merge utility types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Merges two flag sets as a flat intersection.
 *
 * Shared keys collide; the definition checks reject that at runtime. Per-call merge layers (mapped type or `Simplify<Omit & …>`)
 * nested and hit TS2589 at ~47 / ~31 chained calls. Chaining builder methods
 * (`.flags()`, `.provide()`, `.extend()`) also write `&` inline instead of this
 * alias: re-instantiating an alias revisits its type arguments, so each chained
 * call would nest one more `MergeFlags<…>` level until TS2589.
 */
export type MergeFlags<Base extends FlagsDef, Override extends FlagsDef> = Base & Override;

/** Merges two Context maps as a flat intersection, for the same depth reason as {@link MergeFlags}. */
export type MergeContext<A, B> = A & B;

/** Provider replacement is last-write-wins; an open name may leave any earlier value in place. */
export type MergeProviders<A, B> = keyof A extends never
	? B
	: keyof B extends never
		? A
		: string extends keyof B
			? Record<string, A[keyof A] | B[string]>
			: [keyof A & keyof B] extends [never]
				? A & B
				: Omit<A, keyof B> & B;

// ────────────────────────────────────────────────────────────────────────────
// InferArgs / InferFlags — Type inference utilities
// ────────────────────────────────────────────────────────────────────────────

/**
 * Infer the resolved type for a single ArgDef:
 *
 * - **variadic** → `[primitive, ...primitive[]]` when required without a default,
 *   otherwise `primitive[]` (always an array, never `undefined`)
 * - **required** or **has default** → `primitive` (non-optional)
 * - otherwise → `primitive | undefined`
 *
 * Required core variadics without defaults resolve to nonempty tuples.
 * Schema-backed and default-backed arguments retain their own output contracts.
 */
export type InferArgValue<A extends ArgDef> = A extends {
	schema: infer S extends StandardSchema;
}
	? InferOutput<S>
	: A extends { variadic: VariadicMode }
		? A extends { required: true; default?: never }
			? [ResolveBaseType<A>, ...ResolveBaseType<A>[]]
			: ResolveBaseType<A>[]
		: | ("variadic" extends keyof A
					? [Extract<A["variadic"], VariadicMode>] extends [never]
						? never
						: ResolveBaseType<A>[]
					: never)
			| (A extends { required: true }
					? ResolveBaseType<A>
					: // Defaults are raw inputs; only a definitely present default
						// guarantees presence after its parser runs.
						A extends { default: infer Default }
						? undefined extends Default
							? ResolveBaseType<A> | undefined
							: ResolveBaseType<A>
						: ResolveBaseType<A> | undefined);

// Accumulate duplicates so long positional actions do not exhaust instantiation depth.
type DuplicateArgNames<
	A extends readonly ArgDef[],
	Seen extends string = never,
	Duplicates extends string = never,
> = A extends readonly [infer Head extends ArgDef, ...infer Tail extends readonly ArgDef[]]
	? DuplicateArgNames<Tail, Seen | Head["name"], Duplicates | (Head["name"] & Seen)>
	: Duplicates;

type InferDuplicateArgs<A extends readonly ArgDef[]> = A extends readonly [
	infer Head extends ArgDef,
	...infer Tail extends readonly ArgDef[],
]
	? { [K in Head["name"]]: InferArgValue<Head> } & InferDuplicateArgs<Tail>
	: {};

/**
 * Convert a literal ArgsDef tuple into resolved values keyed by argument name.
 *
 * Tuples with rest elements (`number extends A["length"]`) opt out to `{}`;
 * the builder only produces fixed tuples. Unions of tuples distribute through
 * `InferArgs`'s naked conditional, so each member is inferred separately.
 */
type InferArgsTuple<A extends readonly ArgDef[]> = number extends A["length"]
	? {}
	: [DuplicateArgNames<A>] extends [never]
		? { [D in A[number] as D["name"]]: InferArgValue<D> }
		: InferDuplicateArgs<A>;

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

/** An exclusive group's value: the member given, with its value unless it is a boolean. */
type ExclusiveValue<M, Values extends { [K in keyof M]: unknown }> = {
	[K in keyof M & string]: M[K] extends { type: "boolean" }
		? { flag: K }
		: { flag: K; value: Values[K] };
}[keyof M & string];

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
	: F extends { type: "exclusive"; flags: infer M }
		? | ExclusiveValue<M, { [K in keyof M]: ResolveBaseType<M[K]> }>
			| (F extends { required: true } ? never : undefined)
		: F extends { type: "count" }
			? number
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
					: F extends { default: infer Default }
						? undefined extends Default
							? ResolveBaseType<F> | undefined
							: ResolveBaseType<F>
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
// `-readonly`: record literals inferred through `const` type parameters are readonly.
export type InferFlags<F> = F extends FlagsDef
	? { -readonly [K in keyof F]: InferFlagValue<F[K]> }
	: Record<string, never>;

// ────────────────────────────────────────────────────────────────────────────
// Programmatic invocation input types
// ────────────────────────────────────────────────────────────────────────────

/**
 * One structured `run()` value: native URL/JSON, an occurrence array for repeatable inputs,
 * or an exclusive group's `{ flag, value }`.
 */
export type RunInputValue =
	| URL
	| JsonValue
	| readonly RunInputValue[]
	| { readonly flag: string; readonly value?: RunInputValue };

/** Runtime-erased structured `run()` input bound by `parseStructured`. */
export interface RunInputPayload {
	readonly args?: Readonly<Record<string, RunInputValue | undefined>> | undefined;
	readonly flags?: Readonly<Record<string, RunInputValue | undefined>> | undefined;
}

// Conditional definitions cannot certify supplied values; inspect before distribution.
type InputBaseValue<D> = true extends IsUnion<D> | IsUnion<D[keyof D & "type"]>
	? never
	: D extends { type: "exclusive"; flags: infer M }
		? ExclusiveValue<M, { [K in keyof M]: InputBaseValue<M[K]> }>
		: D extends { type: "boolean" }
			? boolean
			: D extends { type: "count" }
				? number
				: D extends { schema: infer S extends StandardSchema }
					? D extends { type: "json" }
						? InferInput<S>
						: string
					: D extends { type: "json" }
						? JsonValue
						: "choices" extends keyof D
							? Exclude<D["choices"], undefined> extends infer Choices extends readonly string[]
								? [Choices] extends [never]
									? D extends { type: infer T extends ValueType }
										? Resolve<T>
										: never
									: IsStaticTuple<Choices> extends true
										? IsClosedName<Choices[number]> extends true
											? Choices[number]
											: never
										: never
								: never
							: D extends { parse: (raw: string) => infer _ParseOutput }
								? string
								: D extends { type: infer T extends ValueType }
									? Resolve<T>
									: never;

// Resolve the shared input kind before occurrence handling distributes definition unions.
type InputArgValue<D extends ArgDef, Value = InputBaseValue<D>> = [Value] extends [never]
	? never
	: D extends { variadic: VariadicMode }
		? RequiredArgNames<[D]> extends never
			? Value[]
			: [Value, ...Value[]]
		: "variadic" extends keyof D
			? [Extract<D["variadic"], VariadicMode>] extends [never]
				? Value
				: never
			: Value;
type InputFlagValue<D, Value = InputBaseValue<D>> = [Value] extends [never]
	? never
	: D extends { multiple: true }
		? Value[]
		: "multiple" extends keyof D
			? true extends D["multiple"]
				? never
				: Value
			: Value;

/** Names of the arguments marked `required` without a definite default. */
export type RequiredArgNames<A extends readonly object[]> = A[number] extends infer D
	? D extends { name: infer N extends string }
		? "required" extends keyof D
			? true extends D["required"]
				? D extends { default: infer Default }
					? undefined extends Default
						? N
						: never
					: N
				: never
			: never
		: never
	: never;

type InputArgsPrefixes<
	Remaining extends ArgsDef,
	Supplied = {},
	Prefixes = never,
> = Remaining extends readonly [infer Head extends ArgDef, ...infer Tail extends ArgsDef]
	? InputArgsPrefixes<
			Tail,
			Supplied & { [K in Head["name"]]: InputArgValue<Head> },
			| Prefixes
			| (RequiredArgNames<Remaining> extends never
					? Simplify<Supplied & { [D in Remaining[number] as D["name"]]?: undefined }>
					: never)
		>
	: Prefixes | Simplify<Supplied>;

// An `"afterDoubleDash"` argument is given after `--` on argv, so it never follows the others' prefix.
type InputArgsSplit<A extends ArgsDef> = A extends readonly [
	...infer Init extends ArgsDef,
	infer Last extends ArgDef & { variadic: "afterDoubleDash" },
]
	? InputArgsPrefixes<Init> extends infer Prefix
		? Prefix extends unknown
			? Simplify<
					Prefix &
						(RequiredArgNames<[Last]> extends never
							? { [K in Last["name"]]?: InputArgValue<Last> | undefined }
							: { [K in Last["name"]]: InputArgValue<Last> })
				>
			: never
		: never
	: InputArgsPrefixes<A>;

/**
 * Supplied positional values form a prefix; defaults do not fill input gaps. A final
 * `variadic: "afterDoubleDash"` argument is independent of that prefix.
 */
export type InputArgs<A extends ArgsDef> = number extends A["length"]
	? never
	: IsUnion<A> extends true
		? never
		: IsClosedName<A[number]["name"]> extends true
			? InputArgsSplit<A>
			: never;

// Distribute before inspecting keys: each alternative must permit omission.
// An `env` binding may supply the value, so typed input can omit it like argv can; a
// member's binding may supply a group.
type RequiredFlagName<D, K> = D extends unknown
	? D extends { readonly env: FlagEnv }
		? never
		: true extends MemberHasEnv<D>
			? never
			: "required" extends keyof D
				? true extends D["required"]
					? D extends { default: infer Default }
						? undefined extends Default
							? K
							: never
						: K
					: never
				: never
	: never;

type MemberHasEnv<D> = D extends { readonly flags: infer M }
	? { [K in keyof M]: M[K] extends { readonly env: FlagEnv } ? true : false }[keyof M]
	: false;

type RequiredFlagNames<F extends FlagsDef> = {
	[K in keyof F]-?: RequiredFlagName<F[K], K>;
}[keyof F];

// Drop index-signature keys; open records are accepted through `RunInputPayload` instead.
type KnownFlags<F extends FlagsDef> = { [K in keyof F as string extends K ? never : K]: F[K] };

/** Flag values accepted by typed programmatic invocation before parsing/validation. */
export type InputFlags<F extends FlagsDef> =
	IsUnion<F> extends true
		? never
		: Simplify<
				{
					[K in RequiredFlagNames<KnownFlags<F>>]-?: InputFlagValue<KnownFlags<F>[K]>;
				} & {
					[K in Exclude<keyof KnownFlags<F>, RequiredFlagNames<KnownFlags<F>>>]?:
						| InputFlagValue<KnownFlags<F>[K]>
						| undefined;
				}
			> &
				(string extends keyof F ? NonNullable<RunInputPayload["flags"]> : {});

// ────────────────────────────────────────────────────────────────────────────
// CommandMeta — Command metadata
// ────────────────────────────────────────────────────────────────────────────

export type SectionConsumer = ExtensionId | { readonly id: ExtensionId };

type Audience<C> =
	| { readonly only: C; readonly except?: never }
	| { readonly except: C; readonly only?: never }
	| { readonly only?: never; readonly except?: never };

export type SectionAudience = Audience<readonly [SectionConsumer, ...SectionConsumer[]]>;

type SectionContent = {
	readonly title: string;
	readonly body: string;
};

/** A plain-text documentation section accepted from command and Extension authors. */
export type CommandSectionInput = SectionContent & SectionAudience;

/** A validated documentation section rendered after built-in command documentation. */
export type CommandSection = SectionContent & Audience<readonly [ExtensionId, ...ExtensionId[]]>;

/** Metadata describing a CLI command */
export interface CommandMeta {
	/** The command name (used in help text and routing) */
	name: string;
	/** Human-readable description for help text */
	description?: string;
	/** Application version exposed to Extensions and tooling on the root command. */
	version?: string;
	/** Custom usage string (overrides auto-generated usage) */
	usage?: string;
	/** Plain-text sections rendered after built-in command documentation. */
	sections?: readonly CommandSection[];
	/**
	 * Alternative names that resolve to the same command.
	 *
	 * Each entry is a sibling-level alternative for `name`. For example,
	 * `defineCommand("issue", { aliases: ["issues", "i"] }, recipe)` makes
	 * `cli issue`, `cli issues`, and `cli i` all route to the same command node.
	 *
	 * **Conflict policy.** Alias strings must not collide with this command's
	 * own canonical `name`, with any sibling's `name`, or with any sibling's
	 * own alias. TypeScript reports statically known collisions. Each alias
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
	 * A flag can be hidden the same way (`FlagDef`'s `hidden`); positional
	 * arguments cannot.
	 *
	 * Tooling contract: any renderer or generator that walks
	 * `subCommands` to produce a user-facing listing should skip nodes
	 * where `meta.hidden === true`.
	 *
	 * @example
	 * meta: { name: "__complete", hidden: true, description: "Internal" }
	 */
	hidden?: boolean;
	/**
	 * Why the command is deprecated, and what to use instead. Running it from the command line
	 * prints one warning with it on stderr; help marks the command. Independent of `hidden`.
	 *
	 * @example
	 * defineCommand("scan", { deprecated: "Use `scout`." }, recipe)
	 */
	deprecated?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// ParseResult — Output of parseArgs
// ────────────────────────────────────────────────────────────────────────────

/** Raw token shapes a Standard Schema receives before it runs. */
type RawSchemaFlagInput = string | boolean | readonly (string | boolean)[] | undefined;

/** One flag value after syntax parsing and before required/schema validation. */
type RawFlagValue<D extends FlagDef> = D extends { schema: StandardSchema }
	? D extends { type: "json" }
		? JsonValue | undefined
		: RawSchemaFlagInput
	: InferFlagValue<D> | undefined;

/** Positional counterpart of {@link RawFlagValue}. */
export type RawArgValue<D extends ArgDef> = D extends { schema: StandardSchema }
	? D extends { variadic: VariadicMode }
		? string[]
		: string | undefined
	: D extends { variadic: VariadicMode }
		? ResolveBaseType<D>[] | undefined
		: InferArgValue<D> | undefined;

/** Runtime-erased syntax-parsed flag value. */
export type ParsedFlagValue = RawFlagValue<FlagDef>;
/** Runtime-erased syntax-parsed positional value. */
export type ParsedArgValue = RawArgValue<ArgDef>;

export type RawParsedFlags<F extends FlagsDef> = { -readonly [K in keyof F]: RawFlagValue<F[K]> };
export type RawParsedArgs<A extends ArgsDef> = number extends A["length"]
	? Record<string, ParsedArgValue>
	: { [D in A[number] as D["name"]]: RawArgValue<D> };

/**
 * Where an argument's or flag's current value came from: given on `argv`, typed `run()`
 * input, the flag's `env` variable, `ExtensionContext.bindInput`, or the definition's `default`.
 */
export type ValueSource = "argv" | "run" | "env" | "bound" | "default";

/** A declared default on any argument or flag definition. */
export type DeclaredDefault = (ArgDef | FlagDef)["default"];
/** Syntax-parsed input, before required and Standard Schema validation. */
export interface ParseResult<A extends ArgsDef = ArgsDef, F extends FlagsDef = FlagsDef> {
	args: RawParsedArgs<A>;
	flags: RawParsedFlags<F>;
	/** Positional words no declared argument took, before or after `--`; validation rejects them. */
	excessArgs: string[];
}

/** Fully validated input returned by the schema boundary. */
export interface ValidatedInput<A extends ArgsDef = ArgsDef, F extends FlagsDef = FlagsDef> {
	args: InferArgs<A>;
	flags: InferFlags<F>;
}
