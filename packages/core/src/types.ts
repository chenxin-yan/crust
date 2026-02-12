// ────────────────────────────────────────────────────────────────────────────
// Constructor-to-primitive mapping
// ────────────────────────────────────────────────────────────────────────────

/** Maps a constructor function (String, Number, Boolean) to its primitive type */
export type TypeConstructor =
	| StringConstructor
	| NumberConstructor
	| BooleanConstructor;

/**
 * Resolves a constructor function to its corresponding TypeScript primitive type.
 *
 * - `StringConstructor` → `string`
 * - `NumberConstructor` → `number`
 * - `BooleanConstructor` → `boolean`
 */
type ResolvePrimitive<T extends TypeConstructor> = T extends StringConstructor
	? string
	: T extends NumberConstructor
		? number
		: T extends BooleanConstructor
			? boolean
			: never;

// ────────────────────────────────────────────────────────────────────────────
// ArgDef — Positional argument definition
// ────────────────────────────────────────────────────────────────────────────

/**
 * Defines a single positional argument for a CLI command.
 *
 * @example
 * ```ts
 * const args = {
 *   port: { type: Number, description: "Port number", default: 3000 },
 *   name: { type: String, required: true },
 *   files: { type: String, variadic: true },
 * } satisfies ArgsDef;
 * ```
 */
export interface ArgDef<
	T extends TypeConstructor = TypeConstructor,
	D extends ResolvePrimitive<T> | undefined = ResolvePrimitive<T> | undefined,
	R extends boolean = boolean,
	V extends boolean = boolean,
> {
	/** Constructor function indicating the argument's type: `String`, `Number`, or `Boolean` */
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

/** Record mapping argument names to their definitions */
export type ArgsDef = Record<string, ArgDef>;

// ────────────────────────────────────────────────────────────────────────────
// FlagDef — Named flag definition
// ────────────────────────────────────────────────────────────────────────────

/**
 * Defines a single named flag for a CLI command.
 *
 * @example
 * ```ts
 * const flags = {
 *   verbose: { type: Boolean, description: "Enable verbose logging", alias: "v" },
 *   port: { type: Number, description: "Port number", default: 3000 },
 * } satisfies FlagsDef;
 * ```
 */
export interface FlagDef<
	T extends TypeConstructor = TypeConstructor,
	D extends ResolvePrimitive<T> | undefined = ResolvePrimitive<T> | undefined,
	R extends boolean = boolean,
> {
	/** Constructor function indicating the flag's type: `String`, `Number`, or `Boolean` */
	type: T;
	/** Human-readable description for help text */
	description?: string;
	/** Default value when the flag is not provided */
	default?: D;
	/** Whether this flag must be provided (errors if missing) */
	required?: R;
	/** Short alias or array of aliases (e.g. `"v"` or `["v", "V"]`) */
	alias?: string | string[];
}

/** Record mapping flag names to their definitions */
export type FlagsDef = Record<string, FlagDef>;

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
 * Maps a full ArgsDef record to resolved arg types.
 *
 * @example
 * ```ts
 * type Result = InferArgs<{
 *   port: { type: NumberConstructor, default: 3000 };
 *   name: { type: StringConstructor, required: true };
 *   files: { type: StringConstructor, variadic: true };
 * }>;
 * // Result = { port: number; name: string; files: string[] }
 * ```
 */
export type InferArgs<A> = A extends ArgsDef
	? { [K in keyof A]: InferArgValue<A[K]> }
	: Record<string, never>;

/**
 * Infer the resolved type for a single FlagDef:
 *
 * - **required** or **has default** → `primitive` (non-optional)
 * - otherwise → `primitive | undefined`
 */
type InferFlagValue<F extends FlagDef> = F extends { required: true }
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
 *   verbose: { type: BooleanConstructor };
 *   port: { type: NumberConstructor, default: 3000 };
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
// CommandContext — Runtime context passed to lifecycle hooks
// ────────────────────────────────────────────────────────────────────────────

/**
 * The runtime context object passed to `setup()`, `run()`, and `cleanup()` hooks.
 *
 * Contains the parsed args/flags, the raw argv, and a reference to the resolved command.
 */
export interface CommandContext<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
> {
	/** Parsed positional arguments, typed according to the command's arg definitions */
	args: InferArgs<A>;
	/** Parsed flags, typed according to the command's flag definitions */
	flags: InferFlags<F>;
	/** The original argv array (unparsed) */
	rawArgs: string[];
	/** The resolved command that is being executed */
	cmd: AnyCommand;
}

// ────────────────────────────────────────────────────────────────────────────
// CommandDef — Command definition (input to defineCommand)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The configuration object accepted by `defineCommand()`.
 *
 * This is the user-facing API for defining CLI commands. Generic type parameters
 * are automatically inferred from the config — no manual type annotations needed.
 */
export interface CommandDef<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
> {
	/** Command metadata (name, version, description) */
	meta: CommandMeta;
	/** Positional argument definitions */
	args?: A;
	/** Flag definitions */
	flags?: F;
	/** Named subcommands */
	subCommands?: Record<string, AnyCommand>;
	/** Called before `run()` — useful for initialization */
	setup?: (context: CommandContext<A, F>) => void | Promise<void>;
	/** The main command handler */
	run?: (context: CommandContext<A, F>) => void | Promise<void>;
	/** Called after `run()` (even if it throws) — useful for cleanup */
	cleanup?: (context: CommandContext<A, F>) => void | Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────────
// Command — Resolved command (output of defineCommand)
// ────────────────────────────────────────────────────────────────────────────

/**
 * A fully resolved, frozen command object.
 *
 * This is the output of `defineCommand()`. It has the same shape as `CommandDef`
 * but is deeply readonly to prevent mutation.
 */
export type Command<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
> = Readonly<CommandDef<A, F>>;

/**
 * A type-erased command reference used in places where the exact arg/flag
 * generics don't matter (e.g. `cmd` back-reference, `subCommands` map).
 *
 * Includes only the non-callback properties to avoid generic variance issues
 * that arise from lifecycle hooks being contravariant on their context parameter.
 */
export interface AnyCommand {
	readonly meta: CommandMeta;
	readonly args?: ArgsDef;
	readonly flags?: FlagsDef;
	readonly subCommands?: Record<string, AnyCommand>;
	readonly setup?: (context: never) => void | Promise<void>;
	readonly run?: (context: never) => void | Promise<void>;
	readonly cleanup?: (context: never) => void | Promise<void>;
}
