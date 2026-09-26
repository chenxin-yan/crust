import type { CommandDefinition, RootCommandMeta } from "../command/crust.ts";
import type { CommandSnapshot } from "../command/snapshot.ts";
import { CrustError, type CaughtError } from "../errors.ts";
import type { ExtensionId } from "../identity.ts";
import { ownDefinition, toFlagsRecord } from "../parsing/spellings.ts";
import type {
	CommandMeta,
	RuntimeCommandSectionInput,
	FlagDef,
	InferFlags,
	InvocationIO,
	NamedFlagDef,
	NamedFlagsRecord,
	ParsedArgValue,
	ParsedFlagValue,
} from "../types.ts";
import type {
	AttachedCommandSpellings,
	ValidateCommandDefinitions,
} from "../validation/commands.brands.ts";
import type { DeclaredDepsOf, KnownContextInstances } from "../validation/contexts.brands.ts";
import type {
	AttachedSpellings,
	ProvideChecks,
	ProvidedContextSpellings,
	ValidateLocalFlagDefs,
} from "../validation/flags.brands.ts";
import type {
	Awaitable,
	HasClosedNames,
	IsStaticTuple,
	MergeProviders,
} from "../validation/shared.ts";
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

const finishedBrand: unique symbol = Symbol("crust.finished");

/** Opaque token returned by {@link ExtensionContext.finish} to end an invocation successfully. */
export interface Finished {
	readonly [finishedBrand]: true;
}

const FINISHED: Finished = Object.freeze({ [finishedBrand]: true as const });

/** @internal */
export function finishInvocation(): Finished {
	return FINISHED;
}

export type InvocationOutcome =
	| { readonly status: "completed" }
	| { readonly status: "finished"; readonly by: ExtensionId }
	| { readonly status: "failed"; readonly error: unknown; readonly by?: ExtensionId };

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
	Defs extends readonly NamedExtensionFlagDef[] = [],
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
	 * Bound positional values for the resolved command, before validation: parsed from
	 * argv tokens for `execute()`, taken as-is from the structured input for typed `run()`
	 * (URL/JSON values keep their identity).
	 *
	 * @example `{ target: "api" }`
	 */
	readonly args: Readonly<Record<string, ParsedArgValue>>;
	/**
	 * Bound own flags plus unknown flags from the resolved command, before validation;
	 * parsed from argv tokens for `execute()`, taken as-is from the structured input for typed `run()`.
	 *
	 * @example `{ trace: true }`
	 */
	readonly flags: Readonly<InferExtensionFlags<Defs> & Record<string, ParsedFlagValue>>;
	/**
	 * Positional values that appeared after the `--` separator, or the `raw` array passed to typed `run()`.
	 *
	 * @example `["--dry-run"]`
	 */
	readonly rawArgs: readonly string[];
	/**
	 * Aborted when the caller cancels the invocation (`execute({ signal })`,
	 * `run(path, input, { signal })`, or the first `SIGINT` under `execute()`);
	 * see `ExecuteOptions.signal` for how the abort reason maps to the exit code.
	 */
	readonly signal: AbortSignal;
	/** Declared Contexts, constructed lazily on first property access. */
	readonly ctx: ContextBag<Deps>;
	/**
	 * End the invocation successfully before validation, Context construction, and the action.
	 *
	 * @example
	 * ```ts
	 * preRun(ctx) {
	 *   if (ctx.flags.help === true) return ctx.finish();
	 * }
	 * ```
	 */
	readonly finish: () => Finished;
}

export interface ExtensionHooks<
	Defs extends readonly NamedExtensionFlagDef[] = [],
	Deps extends ContextMap = {},
	MetaKeys extends RootMetaKey = never,
> {
	/**
	 * Runs after routing and input binding (argv parsing for `execute()`, structured
	 * binding for typed `run()`), before validation, in `.extend()` order.
	 * Return `ctx.finish()` to end the invocation successfully; later pre-run hooks,
	 * validation, schemas, Contexts, and the Command Action do not run.
	 */
	readonly preRun?: (ctx: ExtensionContext<Defs, Deps, MetaKeys>) => Awaitable<void | Finished>;
	/**
	 * Runs after the invocation settles, in reverse `.extend()` order. This is the
	 * `finally` slot for cleanup and post-run side effects.
	 */
	readonly postRun?: (
		ctx: ExtensionContext<Defs, Deps, MetaKeys>,
		outcome: InvocationOutcome,
	) => Awaitable<void>;
	/**
	 * Renders a failure in `execute()` only. Return true when rendered to stop the
	 * chain; falsy values delegate to the next Extension and then Core's renderer.
	 * A hook that throws ends the chain: remaining hooks are skipped and Core's
	 * default renderer reports the original failure.
	 *
	 * Receives the base context: routing or syntax-parse failures render with a
	 * fallback context whose `flags` are empty, so owned-flag inference would lie here.
	 */
	readonly onError?: (
		error: CaughtError,
		ctx: ExtensionContext<[], Deps, MetaKeys>,
	) => Awaitable<boolean | void>;
}

/**
 * A flag owned by an Extension. `recursive` (default `true`) contributes the
 * flag to every command in the application; set `false` for a root-only flag.
 */
export type ExtensionFlagDef = FlagDef & { readonly recursive?: boolean };

/** A named flag definition accepted by {@link defineExtension}. */
export type NamedExtensionFlagDef = NamedFlagDef & {
	readonly recursive?: boolean;
};

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
	: F extends { required: true }
		? F extends { default: unknown }
			? InferFlags<{ value: F }>["value"]
			: // Hooks run before validation enforces `required`, so the value may be absent.
				InferFlags<{ value: F }>["value"] | undefined
		: InferFlags<{ value: F }>["value"];

type InferExtensionFlag<F> = F extends ExtensionFlagDef
	?
			| InferPreSchemaExtensionFlag<F>
			| ("recursive" extends keyof F ? (false extends F["recursive"] ? undefined : never) : never)
	: never;

/** Infer pre-validation hook values; uncertain collections claim no typed ownership. */
export type InferExtensionFlags<Defs extends readonly NamedExtensionFlagDef[]> =
	IsStaticTuple<Defs> extends true
		? HasClosedNames<Defs> extends true
			? { [K in keyof NamedFlagsRecord<Defs>]: InferExtensionFlag<NamedFlagsRecord<Defs>[K]> }
			: Record<string, ParsedFlagValue>
		: Record<string, ParsedFlagValue>;

/** A documentation section an Extension contributes to one command path. */
export type ExtensionSectionContribution = RuntimeCommandSectionInput & {
	readonly command: readonly string[];
};

type CommandDefinitionsDependencies<
	Commands extends readonly CommandDefinition<any, any, any, any>[],
> = Commands extends readonly [
	infer H extends CommandDefinition<any, any, any, any>,
	...infer T extends readonly CommandDefinition<any, any, any, any>[],
]
	? // A `never` element (e.g. a `{} as never` cast) would distribute DeclaredDepsOf
		// to `never` and poison the whole dependency intersection.
		([H] extends [never] ? {} : DeclaredDepsOf<H>) & CommandDefinitionsDependencies<T>
	: Commands extends readonly []
		? {}
		: Record<string, ContextValue>;

type ExtensionDeps<
	Use extends readonly AnyContextFactory[],
	Provide extends readonly AnyContextInstance[],
	Commands extends readonly CommandDefinition<any, any, any, any>[],
> = ContextDependencies<Use> &
	ContextsDependencies<Provide> &
	CommandDefinitionsDependencies<Commands>;

/** Flag spellings an Extension already owns: declared flags plus provided Context-owned flags. */
type DeclaredSpellings<
	Defs extends readonly NamedExtensionFlagDef[],
	Provide extends readonly AnyContextInstance[],
> = AttachedSpellings<Defs> | ProvidedContextSpellings<Provide>;

declare const extensionHookProof: unique symbol;

/**
 * @internal Sealed runtime record behind an {@link Extension} handle. Runtime
 * consumers read it through `definingOf`, so structural copies of a handle keep
 * the declaration proofs `.extend()` checks.
 */
export interface ExtensionData<
	Deps extends ContextMap = ContextMap,
	Provide extends readonly AnyContextInstance[] = readonly AnyContextInstance[],
	FlagDefs extends readonly NamedExtensionFlagDef[] = readonly NamedExtensionFlagDef[],
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
	/** @internal — phantom carrying declared flag literals for extend-time collision checks */
	readonly _flagDefs?: FlagDefs;
	readonly commands: Commands;
	readonly use: readonly AnyContextFactory[];
	readonly provide: Provide;
	readonly sections?: (
		snapshot: RootCommandSnapshot<MetaKeys>,
	) => readonly ExtensionSectionContribution[];
	readonly build?: (ctx: ExtensionBuildContext<MetaKeys>) => Awaitable<BuildArtifacts>;
	readonly hooks: ExtensionHooks<any, Deps, MetaKeys>;
	readonly _deps?: Deps;
}

/**
 * An Extension handle accepted by `.extend()`. Contribution parameters default to
 * open sets; holders keep the private dependency and hook-demand proofs.
 */
export interface Extension<
	Deps extends ContextMap = ContextMap,
	Provide extends readonly AnyContextInstance[] = readonly AnyContextInstance[],
	FlagDefs extends readonly NamedExtensionFlagDef[] = readonly NamedExtensionFlagDef[],
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

export type ExtensionProvidesOutput<E> =
	DefiningOf<E> extends ExtensionData<any, infer Provide, any, any, RootMetaKey>
		? ContextsOutput<Provide>
		: {};
export type ExtensionsProvidesOutput<Es extends readonly AnyExtension[]> = Es extends readonly [
	infer H,
	...infer T extends readonly AnyExtension[],
]
	? MergeProviders<ExtensionProvidesOutput<H>, ExtensionsProvidesOutput<T>>
	: Es extends readonly []
		? {}
		: DefiningOf<Es[number]> extends ExtensionData<any, infer P, any, any, RootMetaKey>
			? P[number] extends never
				? {}
				: Record<string, ContextValue>
			: {};

/**
 * A callable Extension constructor whose identity is also a section consumer.
 * Contribution parameters default to closed sets. Use `ContextMap`,
 * `readonly AnyContextInstance[]`, `readonly NamedExtensionFlagDef[]`, or
 * `readonly CommandDefinition<any, any, any, any>[]` to keep a namespace open.
 */
export type ExtensionFactory<
	Args extends readonly unknown[] = [],
	Deps extends ContextMap = {},
	Provide extends readonly AnyContextInstance[] = [],
	Defs extends readonly NamedExtensionFlagDef[] = [],
	Commands extends readonly CommandDefinition<any, any, any, any>[] = [],
	MetaKeys extends RootMetaKey = never,
	HookDeps extends ContextMap = Deps,
> = ((...args: Args) => Extension<Deps, Provide, Defs, Commands, MetaKeys, HookDeps>) & {
	readonly id: ExtensionId;
};

type ExtensionFactoryOf<Args extends readonly unknown[], E> =
	E extends Defining<
		ExtensionData<
			infer Deps,
			infer Provide,
			infer Defs,
			infer Commands,
			infer MetaKeys,
			infer HookDeps
		>
	>
		? ExtensionFactory<Args, Deps, Provide, Defs, Commands, MetaKeys, HookDeps>
		: never;

type ExtensionHook<
	Name extends keyof ExtensionHooks,
	Use extends readonly AnyContextFactory[],
	Defs extends readonly NamedExtensionFlagDef[],
	MetaKeys extends RootMetaKey,
> = NonNullable<ExtensionHooks<Defs, ContextDependencies<Use>, MetaKeys>[Name]>;

/**
 * Immutable fluent Extension authoring handle returned by {@link defineExtension}.
 * Every method returns a new handle. Collection methods (`use`, `provide`,
 * `flags`, `add`) append; lifecycle setters (`preRun`, `postRun`, `onError`,
 * `sections`, `build`) replace the previous callback. Callbacks are typed by the
 * declarations made before them.
 */
export interface ExtensionBuilder<
	Use extends readonly AnyContextFactory[] = [],
	Provide extends readonly AnyContextInstance[] = [],
	Defs extends readonly NamedExtensionFlagDef[] = [],
	Commands extends readonly CommandDefinition<any, any, any, any>[] = [],
	MetaKeys extends RootMetaKey = never,
> extends Extension<
	ExtensionDeps<Use, Provide, Commands>,
	Provide,
	Defs,
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
	): ExtensionBuilder<readonly [...Use, ...Fs], Provide, Defs, Commands, MetaKeys>;
	/**
	 * Provide Contexts application-wide, regardless of chain position. Provided
	 * Contexts are not exposed to this Extension's hooks unless also declared with `.use()`.
	 */
	provide<const Cs extends readonly AnyContextInstance[]>(
		...instances: KnownContextInstances<Cs> & ProvideChecks<DeclaredSpellings<Defs, Provide>, Cs>
	): ExtensionBuilder<Use, readonly [...Provide, ...Cs], Defs, Commands, MetaKeys>;
	/** Own flags; `recursive` (default `true`) contributes a flag to every command. */
	flags<const Fs extends readonly NamedExtensionFlagDef[]>(
		...defs: ValidateLocalFlagDefs<Fs, DeclaredSpellings<Defs, Provide>>
	): ExtensionBuilder<Use, Provide, readonly [...Defs, ...Fs], Commands, MetaKeys>;
	/** Contribute root commands; they replace same-named application commands. */
	add<const Ds extends readonly CommandDefinition<any, any, any, any>[]>(
		...definitions: Ds & ValidateCommandDefinitions<Ds, AttachedCommandSpellings<Commands>>
	): ExtensionBuilder<Use, Provide, Defs, readonly [...Commands, ...Ds], MetaKeys>;
	/** See {@link ExtensionHooks.preRun}. */
	preRun(
		hook: ExtensionHook<"preRun", Use, Defs, MetaKeys>,
	): ExtensionBuilder<Use, Provide, Defs, Commands, MetaKeys>;
	/** See {@link ExtensionHooks.postRun}. */
	postRun(
		hook: ExtensionHook<"postRun", Use, Defs, MetaKeys>,
	): ExtensionBuilder<Use, Provide, Defs, Commands, MetaKeys>;
	/** See {@link ExtensionHooks.onError}. */
	onError(
		hook: ExtensionHook<"onError", Use, Defs, MetaKeys>,
	): ExtensionBuilder<Use, Provide, Defs, Commands, MetaKeys>;
	/** Contribute documentation sections computed from the prepared root snapshot. */
	sections(
		contribute: (
			snapshot: RootCommandSnapshot<MetaKeys>,
		) => readonly ExtensionSectionContribution[],
	): ExtensionBuilder<Use, Provide, Defs, Commands, MetaKeys>;
	/** Generate build artifacts; build tooling writes the returned files. */
	build(
		generate: (ctx: ExtensionBuildContext<MetaKeys>) => Awaitable<BuildArtifacts>,
	): ExtensionBuilder<Use, Provide, Defs, Commands, MetaKeys>;
	/**
	 * Make a configurable Extension: each call passes this handle and the call
	 * arguments to `define`, which must return an Extension with this handle's id.
	 */
	factory<Args extends readonly unknown[], E extends AnyExtension>(
		define: (
			extension: ExtensionBuilder<Use, Provide, Defs, Commands, MetaKeys>,
			...args: Args
		) => E,
	): ExtensionFactoryOf<Args, E>;
}

interface ExtensionState {
	readonly id: ExtensionId;
	readonly use: readonly AnyContextFactory[];
	readonly provide: readonly AnyContextInstance[];
	readonly flags: readonly NamedExtensionFlagDef[];
	readonly commands: readonly CommandDefinition<any, any, any, any>[];
	readonly hooks: ExtensionData["hooks"];
	readonly sections?: ExtensionData["sections"];
	readonly build?: ExtensionData["build"];
}

type ErasedExtensionBuilder = ExtensionBuilder<any, any, any, any, any>;

function createExtension(state: ExtensionState): ErasedExtensionBuilder {
	const flags = Object.freeze(toFlagsRecord(state.flags));
	// Provided Context-owned spellings collide with owned flags but stay Context-owned.
	toFlagsRecord(
		state.provide.flatMap((instance) =>
			Object.entries(instance.ownedFlags).map(([name, def]) => ({ ...def, name })),
		),
		flags,
	);
	const data: ExtensionData = Object.freeze({
		id: state.id,
		flags,
		commands: Object.freeze([...state.commands]),
		use: Object.freeze([...state.use]),
		provide: Object.freeze([...state.provide]),
		hooks: Object.freeze({ ...state.hooks }),
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
		flags: (...defs: readonly NamedExtensionFlagDef[]) =>
			next({ flags: [...state.flags, ...defs.map(ownDefinition)] }),
		add: (...definitions: readonly CommandDefinition<any, any, any, any>[]) =>
			next({ commands: [...state.commands, ...definitions] }),
		preRun: (preRun: ExtensionHooks["preRun"]) => next({ hooks: { ...state.hooks, preRun } }),
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
): ExtensionBuilder<[], [], [], [], MetaKeys> {
	// SAFETY: metadata requirements are type-only; the runtime handle is identical for every MetaKeys.
	return createExtension({
		id,
		use: [],
		provide: [],
		flags: [],
		commands: [],
		hooks: {},
	}) as ExtensionBuilder<[], [], [], [], MetaKeys>;
}
