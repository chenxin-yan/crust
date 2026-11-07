import type { CommandDefinition, RootCommandMeta } from "../command/crust.ts";
import type { CommandSnapshot } from "../command/snapshot.ts";
import { CrustError, type CaughtError } from "../errors.ts";
import type { ExtensionId } from "../identity.ts";
import { flagRecordEntries, ownDefinition, toFlagsRecord } from "../parsing/spellings.ts";
import type {
	Awaitable,
	CommandMeta,
	RuntimeCommandSectionInput,
	FlagDef,
	InferFlags,
	InvocationIO,
	MergeProviders,
	ParsedArgValue,
	ParsedFlagValue,
	RunInputPayload,
} from "../types.ts";
import type {
	KnownCommandSpellings,
	ValidateCommandDefinitions,
} from "../validation/commands.brands.ts";
import type { DeclaredDepsOf, KnownContextInstances } from "../validation/contexts.brands.ts";
import type {
	FlagRecordErrors,
	FlagsInput,
	DefinedFlags,
	LocalSpellingsOf,
	ProvideChecks,
	ProvidedContextSpellings,
} from "../validation/flags.brands.ts";
import type { IsClosedName, IsStaticTuple, IsUnion } from "../validation/shared.ts";
import {
	definingOf,
	sealHandle,
	type AnyContextFactory,
	type AnyContextInstance,
	type ContextBag,
	type ContextDependencies,
	type ContextMap,
	type ContextValue,
	type ContextsDependencies,
	type ContextsOutput,
	type Defining,
	type DefiningOf,
} from "./context.ts";

// ────────────────────────────────────────────────────────────────────────────
// Extension — the public integration contract
// ────────────────────────────────────────────────────────────────────────────

/**
 * How an invocation settled; `completed` carries the command's result: the awaited
 * `.output()` schema output when declared, otherwise the Command Action's awaited
 * return value (`undefined` without an action). For an async generator action, the
 * result is its `return` value, and `completed` and `failed` carry the values it
 * yielded as `events` (`[]` when it yielded none); `events` is absent otherwise.
 */
export type InvocationOutcome =
	| {
			readonly status: "completed";
			readonly result: unknown;
			readonly events?: readonly unknown[];
	  }
	| { readonly status: "handled"; readonly by: ExtensionId }
	| {
			readonly status: "failed";
			readonly error: unknown;
			readonly by?: ExtensionId;
			readonly events?: readonly unknown[];
	  };

/** Authored root metadata fields an Extension may require. */
export type RootMetaKey = keyof RootCommandMeta;

type RootCommandSnapshot<K extends RootMetaKey> = CommandSnapshot & {
	readonly meta: Readonly<Required<Pick<CommandMeta, K>>>;
};

/** One file a build hook produces; `path` is POSIX-relative to the build output directory. */
export interface BuildFile {
	readonly path: string;
	readonly content: string | Uint8Array;
}

/** Files returned by a build hook; build tooling writes them into the build output directory. */
export type BuildArtifacts = readonly BuildFile[];

/** Files written for each Extension build hook, in hook execution order. */
export interface BuildReport {
	readonly extensions: readonly {
		readonly id: ExtensionId;
		readonly files: readonly string[];
	}[];
}

/**
 * Build-time context passed to an Extension's artifact generator. It deliberately
 * carries no output directory: build tooling owns that tree, so every shipped file
 * is a returned {@link BuildFile} and the {@link BuildReport} is exact.
 */
export interface ExtensionBuildContext<MetaKeys extends RootMetaKey = never> {
	/**
	 * Frozen snapshot prepared before this hook starts. It does not include this hook's own
	 * outputs; later-registered hooks receive refreshed snapshots.
	 */
	readonly snapshot: RootCommandSnapshot<MetaKeys>;
}

/**
 * Readonly invocation view passed to Extension hooks.
 *
 * Commands cross this boundary as readonly, serializable
 * {@link CommandSnapshot}s — never as internal command nodes.
 *
 * Examples below assume the `tool deploy api --trace -- --dry-run` invocation.
 */
export interface ExtensionContext<
	F extends ExtensionFlagsDef = {},
	Deps extends ContextMap = {},
	MetaKeys extends RootMetaKey = never,
> extends Readonly<InvocationIO> {
	/**
	 * Complete argv passed to the application, including routed command names.
	 * For typed `run()` this is the command path only; structured values are never rendered as argv.
	 *
	 * @example `["deploy", "api", "--trace", "--", "--dry-run"]`
	 */
	readonly argv: readonly string[];
	/**
	 * Snapshot of the application root, including Extension-contributed flags/commands.
	 *
	 * @example
	 * ```ts
	 * ctx.rootCommand.meta.name; // "tool"
	 * Object.keys(ctx.rootCommand.subCommands); // ["deploy"]
	 * ```
	 */
	readonly rootCommand: RootCommandSnapshot<MetaKeys>;
	/**
	 * Snapshot of the resolved command (the root when routing failed).
	 *
	 * @example
	 * ```ts
	 * ctx.command.meta.name; // "deploy"
	 * ctx.command.args; // [{ name: "target", type: "string", required: true }]
	 * ```
	 */
	readonly command: CommandSnapshot;
	/**
	 * Canonical names from the application root through the resolved command.
	 *
	 * @example `["tool", "deploy"]`
	 */
	readonly commandPath: readonly string[];
	/**
	 * Canonical names from the application root through the command added from `definition`,
	 * in the form of {@link ExtensionContext.commandPath}; `undefined` when the application
	 * has no command added from it. Definitions match by identity, so a `.as()` copy is a
	 * different definition. A definition added more than once resolves to its shallowest
	 * path, then the first added. Searching builds the commands it passes, running their recipes.
	 *
	 * @example `ctx.commandPathOf(migrate)` → `["tool", "db", "migrate"]`
	 */
	readonly commandPathOf: (
		definition: CommandDefinition<any, any, any, any>,
	) => readonly string[] | undefined;
	/**
	 * Bound positional values for the resolved command, before validation: parsed from
	 * argv tokens for `execute()`, taken as-is from the structured input for typed `run()`
	 * (URL/JSON values keep their identity). An argument whose argv value is invalid is
	 * `undefined`, as for {@link ExtensionContext.flags}.
	 *
	 * @example `{ target: "api" }`
	 */
	readonly args: Readonly<Record<string, ParsedArgValue>>;
	/**
	 * Bound own flags plus unknown flags from the resolved command, before validation;
	 * parsed from argv tokens for `execute()`, taken as-is from the structured input for typed `run()`.
	 * A flag whose argv or environment value failed conversion, `choices`, or `parse` is
	 * `undefined` (not its default); the error surfaces at validation.
	 *
	 * @example `{ trace: true }`
	 */
	readonly flags: Readonly<InferExtensionFlags<F> & Record<string, ParsedFlagValue>>;
	/**
	 * Tokens after the `--` separator that no declared argument consumed, or the `raw` array passed to typed `run()`.
	 *
	 * @example `["--dry-run"]`
	 */
	readonly rawArgs: readonly string[];
	/**
	 * What argv gave explicitly: declared argument names, canonical flag names (aliases and
	 * `--no-<name>` included, environment values not), and whether passthrough tokens were
	 * left after `--`. It reflects argv only, never values bound later by
	 * {@link ExtensionContext.bindInput}; empty under typed `run()` and in `onError` after a
	 * routing or argv-syntax failure.
	 *
	 * @example `{ args: ["target"], flags: ["trace"], raw: true }`
	 */
	readonly argvProvided: {
		readonly args: readonly string[];
		readonly flags: readonly string[];
		readonly raw: boolean;
	};
	/**
	 * Aborted when the caller cancels the invocation (`execute({ signal })`,
	 * `run(path, input, { signal })`, or the first `SIGINT` under `execute()`);
	 * see `ExecuteOptions.signal` for how the abort reason maps to the exit code.
	 */
	readonly signal: AbortSignal;
	/** Declared Contexts, constructed lazily on first property access. */
	readonly ctx: ContextBag<Deps>;
	/**
	 * Bind structured input (arguments, flags, and `raw` passthrough tokens) into this
	 * invocation, for example a JSON object read from a flag. Call it from `setup`, so every
	 * later hook, including each `preRun` whatever the `.extend()` order, sees the bound
	 * values, or from `preRun`, so it happens only when the Command Action will run. Values
	 * given explicitly on argv win, even when equal to the default; every other supplied key
	 * replaces the environment value or default, converted exactly as typed `run()` input is.
	 * Under typed `run()` nothing came from argv, so supplied keys replace the typed input.
	 * Each call re-binds against the original input, so the last call wins. Afterwards
	 * `args`, `flags`, and `rawArgs` report the bound values, and validation and the Command
	 * Action use them. Flag handlers are chosen from the original input, so a bound flag never
	 * selects one, even when bound in `setup`. A no-op in `onError` after a routing or argv-syntax failure.
	 *
	 * @throws {CrustError} `PARSE` on an unknown key, a positional argument supplied after an
	 *   omitted earlier one, or a value that fails conversion (including a non-array value for
	 *   a variadic argument or `multiple` flag); it fails the invocation like any error thrown
	 *   from the hook that called it
	 *
	 * @example
	 * ```ts
	 * setup(ctx) {
	 *   if (typeof ctx.flags.input === "string") ctx.bindInput({ flags: JSON.parse(ctx.flags.input) });
	 * }
	 * ```
	 */
	readonly bindInput: (input: RunInputPayload) => void;
}

/** The context {@link ExtensionHooks.setup} receives. */
export interface ExtensionSetupContext<
	F extends ExtensionFlagsDef = {},
	Deps extends ContextMap = {},
	MetaKeys extends RootMetaKey = never,
> extends ExtensionContext<F, Deps, MetaKeys> {
	/**
	 * Registers cleanup on the invocation's disposal stack, as a Context's setup does:
	 * callbacks run after `postRun` hooks, in reverse registration order together with
	 * Context disposal, including after a failure. Throws once setups have finished.
	 */
	readonly defer: (cleanup: () => void | PromiseLike<void>) => void;
}

/**
 * How one invocation's output is presented. Core decides when each kind of output happens;
 * the renderer an Extension selects with {@link ExtensionBuilder.renderer} decides how.
 * An omitted optional member keeps Core's default for it.
 */
export interface Renderer {
	/** A line the Command Action or a Context wrote with `stdout()`. Default: the invocation's stdout. */
	text(line: string): void;
	/** A line the Command Action or a Context wrote with `stderr()`. Default: the invocation's stderr. */
	diag(line: string): void;
	/**
	 * The Command Action's awaited return value, after any `.output()` schema validated it, only
	 * when the invocation ran an action that completed; called before `postRun`. A throw becomes
	 * the invocation's failure. Default: ignored.
	 */
	result?(value: unknown): void;
	/**
	 * Called once when the Command Action turns out to be an async generator, before its first
	 * event, so `event`, `result`, and `error` know the invocation streams. A throw fails the
	 * invocation and closes the generator. Default: ignored.
	 */
	stream?(): void;
	/**
	 * Each value an async generator Command Action yields, as it is yielded and before the
	 * caller's `onEvent`. A throw fails the invocation and closes the generator. Default: ignored,
	 * so events are never printed.
	 */
	event?(value: unknown): void;
	/**
	 * A failure, in `execute()` only, at most once per invocation, after every `onError` hook
	 * declined it; never for a cancellation, which Core does not render. If it throws, Core
	 * renders the original failure. Default: Core's `Error: <message>` lines on stderr.
	 */
	error?(error: unknown): void;
}

/** Options for {@link ExtensionBuilder.handle}. */
export interface ExtensionHandleOptions {
	/**
	 * Rank before every non-eager handler, like Click's `is_eager` and argparse's help and
	 * version actions: `deploy --preview --help` shows help. Among eager handlers, the flag
	 * given first wins, so `--help --version` shows help and `--version --help` the version.
	 *
	 * @default false
	 */
	readonly eager?: boolean;
}

/** @internal A flag handler as stored on the Extension record. */
export interface ExtensionHandler<
	F extends ExtensionFlagsDef = {},
	Deps extends ContextMap = {},
	MetaKeys extends RootMetaKey = never,
> {
	readonly eager: boolean;
	readonly run: (ctx: ExtensionContext<F, Deps, MetaKeys>) => Awaitable<void>;
}

export interface ExtensionHooks<
	F extends ExtensionFlagsDef = {},
	Deps extends ContextMap = {},
	MetaKeys extends RootMetaKey = never,
> {
	/**
	 * Configures the invocation's environment after routing and input binding, before any
	 * flag handler, so it applies to all output, including `--help`. Every setup runs, in
	 * `.extend()` order, so setups must not depend on each other; one cannot end the
	 * invocation except by throwing. Undo it with `ctx.defer(cleanup)`.
	 */
	readonly setup?: (ctx: ExtensionSetupContext<F, Deps, MetaKeys>) => Awaitable<void>;
	/**
	 * Selects the invocation's {@link Renderer}, once, after every setup and before any flag
	 * handler, so it sees what setups bound. Return (or resolve to) `undefined` to keep Core's
	 * default; Core awaits the selector, so it can lazy-load a formatter. A throw or rejection
	 * fails the invocation, rendered by default. Action and Context output written before then
	 * waits and goes through the selected renderer; without a selector in the application, it is
	 * written immediately. When a setup throws, Core still calls the selector (flags are bound)
	 * and renders the failure through the selected renderer; if the selector then fails too, the
	 * setup failure renders by default. A selector or renderer that throws there never replaces
	 * the setup failure. Routing and argv syntax
	 * failures, before any setup, always render by default.
	 * At most one Extension in an application may set it.
	 */
	readonly renderer?: (ctx: ExtensionContext<F, Deps, MetaKeys>) => Awaitable<Renderer | undefined>;
	/**
	 * Runs in place of a missing Command Action, when no flag handler took the invocation,
	 * and ends it as `handled`. At most one Extension in an application may set it.
	 */
	readonly noAction?: (ctx: ExtensionContext<F, Deps, MetaKeys>) => Awaitable<void>;
	/**
	 * Runs only when the Command Action will: after setups, when no flag handler took the
	 * invocation, before validation, in `.extend()` order. For checks and preparation that
	 * must precede every action but never `--help` or `--version`, such as a login check or
	 * a deprecation warning. Throw to fail the invocation; it cannot end it successfully.
	 */
	readonly preRun?: (ctx: ExtensionContext<F, Deps, MetaKeys>) => Awaitable<void>;
	/**
	 * Runs after the invocation settles, in reverse `.extend()` order. This is the
	 * `finally` slot for cleanup and post-run side effects. A `completed` outcome
	 * carries the command's result as `result`: the awaited `.output()` schema output
	 * when declared, otherwise the Command Action's awaited return value. After an async
	 * generator action, `completed` and `failed` also carry its yielded values as `events`.
	 */
	readonly postRun?: (
		ctx: ExtensionContext<F, Deps, MetaKeys>,
		outcome: InvocationOutcome,
	) => Awaitable<void>;
	/**
	 * Renders a failure in `execute()` only. Return true when rendered to stop the
	 * chain; falsy values delegate to the next Extension and then the selected
	 * {@link Renderer}'s `error`, or Core's default rendering without one. A hook that
	 * throws ends the chain: remaining hooks are skipped and the original failure
	 * reaches that same `error` or default rendering.
	 *
	 * Receives the base context: routing or syntax-parse failures render with a
	 * fallback context whose `flags` are empty, so owned-flag inference would lie here.
	 */
	readonly onError?: (
		error: CaughtError,
		ctx: ExtensionContext<{}, Deps, MetaKeys>,
	) => Awaitable<boolean | void>;
}

/**
 * A flag owned by an Extension. `recursive` (default `true`) contributes the
 * flag to every command in the application; set `false` for a root-only flag.
 */
export type ExtensionFlagDef = FlagDef & { readonly recursive?: boolean };

/** Record mapping an Extension's flag names to their definitions. */
export type ExtensionFlagsDef = Record<string, ExtensionFlagDef>;

type SchemaToken<F> = F extends { type: "boolean" } ? boolean : string;

type InferPreSchemaExtensionFlag<F extends ExtensionFlagDef> = F extends {
	schema: unknown;
}
	?
			| (F extends { multiple: true } ? never : SchemaToken<F>)
			| ("multiple" extends keyof F
					? true extends F["multiple"]
						? SchemaToken<F>[]
						: never
					: never)
			| undefined
	: F extends { required: true } | { default: unknown }
		? // Hooks run before validation enforces `required` and reports invalid values, which
			// stay unset (not defaulted), so a required or defaulted value may still be absent.
			| InferFlags<{ value: F }>["value"]
			| (F extends { default: unknown }
					? MayHoldInvalidValue<F> extends true
						? undefined
						: never
					: undefined)
		: InferFlags<{ value: F }>["value"];

/** Value flags can fail coercion; a boolean only through an env `false` under `noNegate`. */
type MayHoldInvalidValue<F extends ExtensionFlagDef> = F extends { type: "boolean" }
	? "noNegate" extends keyof F
		? "env" extends keyof F
			? true
			: false
		: false
	: true;

type InferExtensionFlag<F> = F extends ExtensionFlagDef
	?
			| InferPreSchemaExtensionFlag<F>
			| ("recursive" extends keyof F ? (false extends F["recursive"] ? undefined : never) : never)
	: never;

/** Infer pre-validation hook values; dynamic or conditional records claim no typed ownership. */
export type InferExtensionFlags<F extends ExtensionFlagsDef> =
	IsClosedName<keyof F & string> extends true
		? IsUnion<F> extends true
			? Record<string, ParsedFlagValue>
			: {
					-readonly [K in keyof F]: {} extends Pick<F, K>
						? ParsedFlagValue
						: InferExtensionFlag<F[K]>;
				}
		: Record<string, ParsedFlagValue>;

/** A documentation section an Extension contributes to one command path. */
export type ExtensionSectionContribution = RuntimeCommandSectionInput & {
	readonly command: readonly string[];
};

// Accumulates in tail position so one Extension can `.add()` 45+ commands without TS2589.
type CommandDefinitionsDependencies<
	Commands extends readonly CommandDefinition<any, any, any, any>[],
	Acc = {},
> = Commands extends readonly [
	infer H extends CommandDefinition<any, any, any, any>,
	...infer T extends readonly CommandDefinition<any, any, any, any>[],
]
	? // A `never` element (e.g. a `{} as never` cast) would distribute DeclaredDepsOf
		// to `never` and poison the whole dependency intersection.
		CommandDefinitionsDependencies<T, Acc & ([H] extends [never] ? {} : DeclaredDepsOf<H>)>
	: Commands extends readonly []
		? Acc
		: Acc & Record<string, ContextValue>;

type ExtensionDeps<
	Use extends readonly AnyContextFactory[],
	Provide extends readonly AnyContextInstance[],
	Commands extends readonly CommandDefinition<any, any, any, any>[],
> = ContextDependencies<Use> &
	ContextsDependencies<Provide> &
	CommandDefinitionsDependencies<Commands>;

/** Flag spellings an Extension already owns: declared flags plus provided Context-owned flags. */
type DeclaredSpellings<
	F extends ExtensionFlagsDef,
	Provide extends readonly AnyContextInstance[],
> = LocalSpellingsOf<F> | ProvidedContextSpellings<Provide>;

// Only a definitely empty state takes the first-call fast path; unions retain their uncertainty.
type AppendedFlags<OF extends ExtensionFlagsDef, F extends ExtensionFlagsDef> =
	IsUnion<OF> extends true ? OF & F : keyof OF extends never ? F : OF & F;

declare const extensionHookProof: unique symbol;

/**
 * @internal Sealed runtime record behind an {@link Extension} handle. Runtime
 * consumers read it through `definingOf`, so structural copies of a handle keep
 * the declaration proofs `.extend()` checks.
 */
export interface ExtensionData<
	Deps extends ContextMap = ContextMap,
	Provide extends readonly AnyContextInstance[] = readonly AnyContextInstance[],
	FlagDefs extends ExtensionFlagsDef = ExtensionFlagsDef,
	Commands extends readonly CommandDefinition<any, any, any, any>[] = readonly CommandDefinition<
		any,
		any,
		any,
		any
	>[],
	out MetaKeys extends RootMetaKey = never,
	HookDeps extends ContextMap = Deps,
> {
	/** @internal Hook demands are distinct from command/provider attachment dependencies. */
	readonly _hookDeps?: HookDeps;
	readonly [extensionHookProof]?: (deps: HookDeps) => void;
	readonly id: ExtensionId;
	readonly flags: Readonly<Record<string, ExtensionFlagDef>>;
	/** @internal — phantom carrying the declared flag record for extend-time collision checks */
	readonly _flagDefs?: FlagDefs;
	readonly commands: Commands;
	readonly use: readonly AnyContextFactory[];
	readonly provide: Provide;
	readonly sections?: (
		snapshot: RootCommandSnapshot<MetaKeys>,
	) => readonly ExtensionSectionContribution[];
	readonly build?: (ctx: ExtensionBuildContext<MetaKeys>) => Awaitable<BuildArtifacts>;
	readonly hooks: ExtensionHooks<any, Deps, MetaKeys>;
	/** Flag handlers keyed by the owned flag they bind to. */
	readonly handlers: Readonly<Record<string, ExtensionHandler<any, Deps, MetaKeys>>>;
	readonly _deps?: Deps;
}

/**
 * An Extension handle accepted by `.extend()`. Contribution parameters default to
 * open sets; holders keep the private dependency and hook-demand proofs.
 */
export interface Extension<
	Deps extends ContextMap = ContextMap,
	Provide extends readonly AnyContextInstance[] = readonly AnyContextInstance[],
	FlagDefs extends ExtensionFlagsDef = ExtensionFlagsDef,
	Commands extends readonly CommandDefinition<any, any, any, any>[] = readonly CommandDefinition<
		any,
		any,
		any,
		any
	>[],
	out MetaKeys extends RootMetaKey = never,
	HookDeps extends ContextMap = Deps,
> extends Defining<ExtensionData<Deps, Provide, FlagDefs, Commands, MetaKeys, HookDeps>> {
	readonly id: ExtensionId;
}

/** @internal Broad Extension constraint; contravariance requires the full metadata key set. */
export type AnyExtension = Extension<any, any, any, any, RootMetaKey>;

/** @internal Broad Extension factory constraint. */
export type AnyExtensionFactory = ((...args: any[]) => AnyExtension) & { readonly id: ExtensionId };

/**
 * What a command's `.use()` accepts: a Context factory, or an Extension or Extension factory,
 * which stands for the Contexts that Extension provides.
 */
export type UseSource = AnyContextFactory | AnyExtension | AnyExtensionFactory;

type ExtensionContexts<E> =
	DefiningOf<E> extends ExtensionData<any, infer Provide, any, any, RootMetaKey>
		? ContextsOutput<Provide> & ContextsDependencies<Provide>
		: {};

type UseSourceContexts<S> = S extends AnyContextFactory
	? ContextDependencies<[S]>
	: S extends AnyExtensionFactory
		? ExtensionContexts<ReturnType<S>>
		: ExtensionContexts<S>;

// Tail-recursive so one `.use()` takes 46+ sources without TS2589.
type UseSourcesContexts<Us extends readonly unknown[], Acc = {}> = Us extends readonly [
	infer H,
	...infer T,
]
	? UseSourcesContexts<T, Acc & UseSourceContexts<H>>
	: Acc;

/** The Contexts (and their dependencies) a `.use()` call demands. */
export type UsedContexts<Us extends readonly UseSource[]> = Us extends readonly AnyContextFactory[]
	? ContextDependencies<Us>
	: IsStaticTuple<Us> extends true
		? UseSourcesContexts<Us>
		: Record<string, ContextValue>;

type ExtensionProvidesOutput<E> =
	DefiningOf<E> extends ExtensionData<any, infer Provide, any, any, RootMetaKey>
		? ContextsOutput<Provide>
		: {};
type ExtensionsRestProvidesOutput<Es extends readonly AnyExtension[]> = Es extends readonly []
	? {}
	: DefiningOf<Es[number]> extends ExtensionData<any, infer P, any, any, RootMetaKey>
		? P[number] extends never
			? {}
			: Record<string, ContextValue>
		: {};

// Folds from the last leading Extension onto the rest's output, so the tail-recursive walk keeps
// last-write-wins nesting while one `.extend()` takes 45+ Extensions without TS2589.
type FoldExtensionsProvidesOutput<Es extends readonly unknown[], Acc> = Es extends readonly [
	...infer Init,
	infer Last,
]
	? FoldExtensionsProvidesOutput<Init, MergeProviders<ExtensionProvidesOutput<Last>, Acc>>
	: Acc;

type LeadingExtensionsProvidesOutput<
	Es extends readonly AnyExtension[],
	Leading extends readonly unknown[],
> = Es extends readonly [infer H, ...infer T extends readonly AnyExtension[]]
	? LeadingExtensionsProvidesOutput<T, [...Leading, H]>
	: FoldExtensionsProvidesOutput<Leading, ExtensionsRestProvidesOutput<Es>>;

export type ExtensionsProvidesOutput<Es extends readonly AnyExtension[]> =
	LeadingExtensionsProvidesOutput<Es, []>;

/**
 * A callable Extension constructor whose identity is also a section consumer.
 * Contribution parameters default to closed sets. Use `ContextMap`,
 * `readonly AnyContextInstance[]`, `ExtensionFlagsDef`, or
 * `readonly CommandDefinition<any, any, any, any>[]` to keep a namespace open.
 */
export type ExtensionFactory<
	Args extends readonly unknown[] = [],
	Deps extends ContextMap = {},
	Provide extends readonly AnyContextInstance[] = [],
	Flags extends ExtensionFlagsDef = {},
	Commands extends readonly CommandDefinition<any, any, any, any>[] = [],
	MetaKeys extends RootMetaKey = never,
	HookDeps extends ContextMap = Deps,
> = ((...args: Args) => Extension<Deps, Provide, Flags, Commands, MetaKeys, HookDeps>) & {
	readonly id: ExtensionId;
};

type ExtensionFactoryOf<Args extends readonly unknown[], E> =
	E extends Defining<
		ExtensionData<
			infer Deps,
			infer Provide,
			infer Flags,
			infer Commands,
			infer MetaKeys,
			infer HookDeps
		>
	>
		? ExtensionFactory<Args, Deps, Provide, Flags, Commands, MetaKeys, HookDeps>
		: never;

type ExtensionHook<
	Name extends keyof ExtensionHooks,
	Use extends readonly AnyContextFactory[],
	F extends ExtensionFlagsDef,
	MetaKeys extends RootMetaKey,
> = NonNullable<ExtensionHooks<F, ContextDependencies<Use>, MetaKeys>[Name]>;

/**
 * Immutable fluent Extension authoring handle returned by {@link defineExtension}.
 * Every method returns a new handle. Collection methods (`use`, `provide`,
 * `flags`, `add`) append; lifecycle setters (`setup`, `renderer`, `preRun`, `noAction`,
 * `postRun`, `onError`, `sections`, `build`, and `handle` per flag) replace the previous callback.
 * Callbacks are typed by the declarations made before them.
 */
export interface ExtensionBuilder<
	Use extends readonly AnyContextFactory[] = [],
	Provide extends readonly AnyContextInstance[] = [],
	OF extends ExtensionFlagsDef = {},
	Commands extends readonly CommandDefinition<any, any, any, any>[] = [],
	MetaKeys extends RootMetaKey = never,
> extends Extension<
	ExtensionDeps<Use, Provide, Commands>,
	Provide,
	OF,
	Commands,
	MetaKeys,
	ContextDependencies<Use>
> {
	/**
	 * Declare Contexts the hooks read from `ctx`. This consumes only: the
	 * application (or `.provide()`) must supply each Context.
	 */
	use<const Fs extends readonly [AnyContextFactory, ...AnyContextFactory[]]>(
		...factories: Fs
	): ExtensionBuilder<readonly [...Use, ...Fs], Provide, OF, Commands, MetaKeys>;
	/**
	 * Provide Contexts application-wide, regardless of chain position. Provided
	 * Contexts are not exposed to this Extension's hooks unless also declared with `.use()`.
	 */
	provide<const Cs extends readonly AnyContextInstance[]>(
		...instances: KnownContextInstances<Cs> & ProvideChecks<DeclaredSpellings<OF, Provide>, Cs>
	): ExtensionBuilder<Use, readonly [...Provide, ...Cs], OF, Commands, MetaKeys>;
	/**
	 * Own flags, one record keyed by flag name; repeated calls accumulate. `recursive`
	 * (default `true`) contributes a flag to every command.
	 */
	flags<const F extends FlagsInput<ExtensionFlagDef>>(
		flags: F & FlagRecordErrors<F, DeclaredSpellings<OF, Provide>>,
	): ExtensionBuilder<
		Use,
		Provide,
		AppendedFlags<OF, DefinedFlags<F, ExtensionFlagsDef>>,
		Commands,
		MetaKeys
	>;
	/** Contribute root commands; names and aliases must not collide with any other root command. */
	add<const Ds extends readonly CommandDefinition<any, any, any, any>[]>(
		...definitions: Ds & ValidateCommandDefinitions<Ds, KnownCommandSpellings<Commands>>
	): ExtensionBuilder<Use, Provide, OF, readonly [...Commands, ...Ds], MetaKeys>;
	/** See {@link ExtensionHooks.setup}. */
	setup(
		hook: ExtensionHook<"setup", Use, OF, MetaKeys>,
	): ExtensionBuilder<Use, Provide, OF, Commands, MetaKeys>;
	/**
	 * Take over the invocation when the user supplies `flag` (argv, environment, or typed
	 * `run()` input), unless it is a negated boolean: `run` replaces `preRun`, validation,
	 * and the Command Action, and the invocation ends as `handled`. Handlers run after every
	 * setup; eager handlers rank first, then the flag given first on the command line wins,
	 * whatever the `.extend()` order.
	 */
	handle(
		flag: keyof OF & string,
		run: ExtensionHook<"noAction", Use, OF, MetaKeys>,
		options?: ExtensionHandleOptions,
	): ExtensionBuilder<Use, Provide, OF, Commands, MetaKeys>;
	/** See {@link ExtensionHooks.renderer}. */
	renderer(
		select: ExtensionHook<"renderer", Use, OF, MetaKeys>,
	): ExtensionBuilder<Use, Provide, OF, Commands, MetaKeys>;
	/** See {@link ExtensionHooks.preRun}. */
	preRun(
		hook: ExtensionHook<"preRun", Use, OF, MetaKeys>,
	): ExtensionBuilder<Use, Provide, OF, Commands, MetaKeys>;
	/** See {@link ExtensionHooks.noAction}. */
	noAction(
		hook: ExtensionHook<"noAction", Use, OF, MetaKeys>,
	): ExtensionBuilder<Use, Provide, OF, Commands, MetaKeys>;
	/** See {@link ExtensionHooks.postRun}. */
	postRun(
		hook: ExtensionHook<"postRun", Use, OF, MetaKeys>,
	): ExtensionBuilder<Use, Provide, OF, Commands, MetaKeys>;
	/** See {@link ExtensionHooks.onError}. */
	onError(
		hook: ExtensionHook<"onError", Use, OF, MetaKeys>,
	): ExtensionBuilder<Use, Provide, OF, Commands, MetaKeys>;

	/** Contribute documentation sections computed from the prepared root snapshot. */
	sections(
		contribute: (
			snapshot: RootCommandSnapshot<MetaKeys>,
		) => readonly ExtensionSectionContribution[],
	): ExtensionBuilder<Use, Provide, OF, Commands, MetaKeys>;
	/** Generate build artifacts; build tooling writes the returned files. */
	build(
		generate: (ctx: ExtensionBuildContext<MetaKeys>) => Awaitable<BuildArtifacts>,
	): ExtensionBuilder<Use, Provide, OF, Commands, MetaKeys>;
	/**
	 * Make a configurable Extension: each call passes this handle and the call
	 * arguments to `define`, which must return an Extension with this handle's id.
	 */
	factory<Args extends readonly unknown[], E extends AnyExtension>(
		define: (extension: ExtensionBuilder<Use, Provide, OF, Commands, MetaKeys>, ...args: Args) => E,
	): ExtensionFactoryOf<Args, E>;
}

interface ExtensionState extends Omit<ExtensionData, "flags"> {
	readonly flags: readonly (readonly [name: string, def: ExtensionFlagDef])[];
}

type ErasedExtensionBuilder = ExtensionBuilder<any, any, any, any, any>;

function createExtension(state: ExtensionState): ErasedExtensionBuilder {
	const flags = Object.freeze(toFlagsRecord(state.flags));
	// Provided Context-owned spellings collide with owned flags but stay Context-owned.
	toFlagsRecord(
		state.provide.flatMap((instance) => Object.entries(instance.ownedFlags)),
		flags,
	);
	const data: ExtensionData = Object.freeze({
		id: state.id,
		flags,
		commands: Object.freeze([...state.commands]),
		use: Object.freeze([...state.use]),
		provide: Object.freeze([...state.provide]),
		hooks: Object.freeze({ ...state.hooks }),
		handlers: Object.freeze({ ...state.handlers }),
		...(state.sections ? { sections: state.sections } : {}),
		...(state.build ? { build: state.build } : {}),
	});
	const next = (change: Partial<ExtensionState>) => createExtension({ ...state, ...change });
	const handle = {
		id: state.id,
		use: (...factories: readonly AnyContextFactory[]) =>
			next({ use: [...state.use, ...factories.map(definingOf)] }),
		provide: (...instances: readonly AnyContextInstance[]) =>
			next({ provide: [...state.provide, ...instances.map(definingOf)] }),
		flags: (record: unknown) =>
			next({
				flags: [
					...state.flags,
					...flagRecordEntries(record).map(
						([name, def]) => [name, ownDefinition(def, "flag", name)] as const,
					),
				],
			}),
		add: (...definitions: readonly CommandDefinition<any, any, any, any>[]) =>
			next({ commands: [...state.commands, ...definitions] }),
		setup: (setup: ExtensionHooks["setup"]) => next({ hooks: { ...state.hooks, setup } }),
		renderer: (renderer: ExtensionHooks["renderer"]) =>
			next({ hooks: { ...state.hooks, renderer } }),
		preRun: (preRun: ExtensionHooks["preRun"]) => next({ hooks: { ...state.hooks, preRun } }),
		handle: (flag: string, run: ExtensionHandler["run"], options: ExtensionHandleOptions = {}) => {
			// A dynamic flag record hides its names from the types.
			if (!Object.hasOwn(flags, flag)) {
				throw new CrustError(
					"DEFINITION",
					`Extension "${state.id}" handles flag "--${flag}", which it does not own`,
					{ subject: "extension", name: state.id, reason: "unknown-handle-flag" },
				);
			}
			return next({
				handlers: { ...state.handlers, [flag]: { eager: options.eager ?? false, run } },
			});
		},
		noAction: (noAction: ExtensionHooks["noAction"]) =>
			next({ hooks: { ...state.hooks, noAction } }),
		postRun: (postRun: ExtensionHooks["postRun"]) => next({ hooks: { ...state.hooks, postRun } }),
		onError: (onError: ExtensionHooks["onError"]) => next({ hooks: { ...state.hooks, onError } }),
		sections: (sections: ExtensionData["sections"]) => next({ sections }),
		build: (build: ExtensionData["build"]) => next({ build }),
		factory: (define: (extension: ErasedExtensionBuilder, ...args: unknown[]) => AnyExtension) =>
			Object.assign(
				(...args: unknown[]) => {
					const extension = define(sealed, ...args);
					// Identity is a runtime value: types cannot tell one ExtensionId from another.
					const returned = definingOf(extension).id;
					if (returned !== state.id) {
						throw new CrustError(
							"DEFINITION",
							`Extension factory "${state.id}" returned Extension "${returned}"; return an Extension built from the handle it receives`,
							{ subject: "extension", name: state.id, reason: "factory-id-mismatch" },
						);
					}
					return extension;
				},
				{ id: state.id },
			),
	};
	// SAFETY: the public builder signatures checked every input; the runtime record erases their phantoms.
	const sealed = sealHandle(handle, data) as ErasedExtensionBuilder;
	return sealed;
}

/**
 * Start an immutable fluent Extension definition.
 *
 * Extensions apply to the whole application and own the flags and commands
 * they contribute. `defineExtension<"version">(id)` requires root metadata keys
 * without preventing inference of flags, Contexts, or commands; chain
 * `.factory()` for a configurable Extension whose identity is a section consumer.
 */
export function defineExtension<MetaKeys extends RootMetaKey = never>(
	id: ExtensionId,
): ExtensionBuilder<[], [], {}, [], MetaKeys> {
	// SAFETY: metadata requirements are type-only; the runtime handle is identical for every MetaKeys.
	return createExtension({
		id,
		use: [],
		provide: [],
		flags: [],
		commands: [],
		hooks: {},
		handlers: {},
	}) as ExtensionBuilder<[], [], {}, [], MetaKeys>;
}
