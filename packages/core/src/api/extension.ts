import type { CommandDefinition, RootCommandMeta } from "../command/crust.ts";
import type { CommandSnapshot } from "../command/snapshot.ts";
import type { CaughtError } from "../errors.ts";
import type { ExtensionId } from "../identity.ts";
import { toFlagsRecord } from "../parsing/spellings.ts";
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
import type { ValidateCommandDefinitions } from "../validation/commands.brands.ts";
import type { DeclaredDepsOf, KnownContextInstances } from "../validation/contexts.brands.ts";
import type {
	ProvideChecks,
	ProvidedContextSpellings,
	ValidateLocalFlagDefs,
} from "../validation/flags.brands.ts";
import type { Awaitable, MergeProviders } from "../validation/shared.ts";
import {
	contextFactoryData,
	contextInstanceData,
	definingOf,
	seal,
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

/** Build-time context passed to an Extension's artifact generator. */
export interface ExtensionBuildContext<MetaKeys extends RootMetaKey = never> {
	/**
	 * Frozen snapshot prepared before this hook starts. It does not include this hook's own
	 * outputs; later-registered hooks receive refreshed snapshots.
	 */
	readonly snapshot: RootCommandSnapshot<MetaKeys>;
	/** Resolved absolute output directory. */
	readonly outDir: string;
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

type InferPreSchemaExtensionFlag<F extends ExtensionFlagDef> = F extends {
	schema: unknown;
}
	? F extends { multiple: true }
		? F extends { type: "boolean" }
			? boolean[] | undefined
			: string[] | undefined
		: F extends { type: "boolean" }
			? boolean | undefined
			: string | undefined
	: F extends { required: true }
		? F extends { default: unknown }
			? InferFlags<{ value: F }>["value"]
			: // Hooks run before validation enforces `required`, so the value may be absent.
				InferFlags<{ value: F }>["value"] | undefined
		: InferFlags<{ value: F }>["value"];

type InferExtensionFlag<F> = F extends ExtensionFlagDef
	? F extends { recursive: false }
		? InferPreSchemaExtensionFlag<F> | undefined
		: InferPreSchemaExtensionFlag<F>
	: never;

/** Infer the syntax-parsed values visible to an Extension's hooks. */
export type InferExtensionFlags<Defs extends readonly NamedExtensionFlagDef[]> = {
	[K in keyof NamedFlagsRecord<Defs>]: InferExtensionFlag<NamedFlagsRecord<Defs>[K]>;
};

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

export interface ExtensionConfig<
	Defs extends readonly NamedExtensionFlagDef[] = readonly NamedExtensionFlagDef[],
	Uses extends readonly AnyContextFactory[] = readonly AnyContextFactory[],
	Provides extends readonly AnyContextInstance[] = readonly AnyContextInstance[],
	Commands extends readonly CommandDefinition<any, any, any, any>[] = readonly CommandDefinition<
		any,
		any,
		any,
		any
	>[],
	MetaKeys extends RootMetaKey = never,
> {
	readonly flags?: Defs;
	readonly commands?: Commands;
	readonly uses?: Uses;
	readonly provides?: Provides;
	readonly sections?: (
		snapshot: RootCommandSnapshot<MetaKeys>,
	) => readonly ExtensionSectionContribution[];
	readonly build?: (ctx: ExtensionBuildContext<MetaKeys>) => void | Promise<void>;
	readonly hooks?: ExtensionHooks<Defs, ContextDependencies<Uses>, MetaKeys>;
}

type ValidateExtensionConfig<
	Defs extends readonly NamedExtensionFlagDef[],
	Provides extends readonly AnyContextInstance[],
	Commands extends readonly CommandDefinition<any, any, any, any>[],
	Uses extends readonly AnyContextFactory[],
> = {
	readonly uses?: Uses;
	// Pairwise like `.add()`: runtime installation is keyed by canonical name
	// (last write wins) while typed paths union every matching shape, so a
	// duplicate name or shared alias inside one Extension would retype run()
	// against a command that cannot dispatch.
	readonly commands?: ValidateCommandDefinitions<Commands>;
	// Provided Context-owned spellings count as existing: a declared flag
	// colliding with the same Extension's provided flag would silently retype
	// the Context's setup flags at parse time.
	readonly flags?: ValidateLocalFlagDefs<Defs, ProvidedContextSpellings<Provides>>;
	// Pairwise like `.provide()`: two provided Contexts sharing a spelling would
	// let the later parser schema feed the earlier Context's static flag types.
	readonly provides?: KnownContextInstances<Provides> & ProvideChecks<never, Provides>;
};

/** @internal Retain defining data through public structural copies. */
export type ExtensionData<E> = DefiningOf<E>;
export function extensionData<E extends AnyExtension>(extension: E): DefiningOf<E> {
	return definingOf(extension);
}

declare const extensionHookProof: unique symbol;

export interface Extension<
	Deps extends ContextMap = ContextMap,
	Provides extends readonly AnyContextInstance[] = readonly AnyContextInstance[],
	FlagDefs extends readonly NamedExtensionFlagDef[] = readonly NamedExtensionFlagDef[],
	Commands extends readonly CommandDefinition<any, any, any, any>[] = readonly CommandDefinition<
		any,
		any,
		any,
		any
	>[],
	out MetaKeys extends RootMetaKey = never,
	HookDeps extends ContextMap = Deps,
> extends Defining<Extension<Deps, Provides, FlagDefs, Commands, MetaKeys, HookDeps>> {
	/** @internal Hook demands are distinct from command/provider attachment dependencies. */
	readonly _hookDeps?: HookDeps;
	readonly [extensionHookProof]?: (deps: HookDeps) => void;
	readonly id: ExtensionId;
	readonly flags?: Readonly<Record<string, ExtensionFlagDef>>;
	/** @internal — phantom carrying declared flag literals for extend-time collision checks */
	readonly _flagDefs?: FlagDefs;
	readonly commands?: Commands;
	readonly uses: readonly AnyContextFactory[];
	readonly provides?: Provides;
	readonly sections?: (
		snapshot: RootCommandSnapshot<MetaKeys>,
	) => readonly ExtensionSectionContribution[];
	readonly build?: (ctx: ExtensionBuildContext<MetaKeys>) => void | Promise<void>;
	readonly hooks?: ExtensionHooks<any, Deps, MetaKeys>;
	readonly _deps?: Deps;
}

/** @internal Broad Extension constraint; contravariance requires the full metadata key set. */
export type AnyExtension = Extension<any, any, any, any, RootMetaKey>;

export type ExtensionProvidesOutput<E> =
	ExtensionData<E> extends Extension<any, infer Provides, any, any, RootMetaKey>
		? ContextsOutput<Provides>
		: {};
export type ExtensionsProvidesOutput<Es extends readonly AnyExtension[]> = Es extends readonly [
	infer H,
	...infer T extends readonly AnyExtension[],
]
	? MergeProviders<ExtensionProvidesOutput<H>, ExtensionsProvidesOutput<T>>
	: Es extends readonly []
		? {}
		: Es[number] extends Extension<any, infer P, any, any, RootMetaKey>
			? P[number] extends never
				? {}
				: Record<string, ContextValue>
			: {};

/** A callable Extension constructor whose identity is also a section consumer. */
export type ExtensionFactory<
	Args extends readonly unknown[] = [],
	Deps extends ContextMap = ContextMap,
	Provides extends readonly AnyContextInstance[] = readonly AnyContextInstance[],
	Defs extends readonly NamedExtensionFlagDef[] = readonly NamedExtensionFlagDef[],
	Commands extends readonly CommandDefinition<any, any, any, any>[] = readonly CommandDefinition<
		any,
		any,
		any,
		any
	>[],
	MetaKeys extends RootMetaKey = never,
	HookDeps extends ContextMap = Deps,
> = ((...args: Args) => Extension<Deps, Provides, Defs, Commands, MetaKeys, HookDeps>) & {
	readonly id: ExtensionId;
};

/** Curried Extension definer: explicit metadata keys leave all other types inferred. */
export interface DefineExtensionWith<MetaKeys extends RootMetaKey> {
	<
		Args extends readonly unknown[],
		const Defs extends readonly NamedExtensionFlagDef[] = [],
		const Uses extends readonly AnyContextFactory[] = [],
		const Provides extends readonly AnyContextInstance[] = [],
		const Commands extends readonly CommandDefinition<any, any, any, any>[] = [],
	>(
		id: ExtensionId,
		factory: (
			...args: Args
		) => ExtensionConfig<Defs, Uses, Provides, Commands, MetaKeys> &
			ValidateExtensionConfig<Defs, Provides, Commands, Uses>,
	): ExtensionFactory<
		Args,
		ContextDependencies<Uses> &
			ContextsDependencies<Provides> &
			CommandDefinitionsDependencies<Commands>,
		Provides,
		Defs,
		Commands,
		MetaKeys,
		ContextDependencies<Uses>
	>;
	<
		const Defs extends readonly NamedExtensionFlagDef[] = [],
		const Uses extends readonly AnyContextFactory[] = [],
		const Provides extends readonly AnyContextInstance[] = [],
		const Commands extends readonly CommandDefinition<any, any, any, any>[] = [],
	>(
		id: ExtensionId,
		config?: ExtensionConfig<Defs, Uses, Provides, Commands, MetaKeys> &
			ValidateExtensionConfig<Defs, Provides, Commands, Uses>,
	): Extension<
		ContextDependencies<Uses> &
			ContextsDependencies<Provides> &
			CommandDefinitionsDependencies<Commands>,
		Provides,
		Defs,
		Commands,
		MetaKeys,
		ContextDependencies<Uses>
	>;
}
type ErasedExtensionFactory = (...args: any[]) => ExtensionConfig<any, any, any, any>;

function isExtensionFactory(
	value: ExtensionConfig | ErasedExtensionFactory,
): value is ErasedExtensionFactory {
	return typeof value === "function";
}

/**
 * Define an Extension, or a factory that builds one from config on each call.
 *
 * Extensions apply to the whole application and own the flags and commands
 * they contribute. Factories expose the same identity for section audiences.
 * `defineExtension<"version">()(id, configOrFactory)` declares required root
 * metadata keys without preventing inference of flags, Contexts, or commands.
 */
export function defineExtension<
	MetaKeys extends RootMetaKey = never,
>(): DefineExtensionWith<MetaKeys>;
export function defineExtension<
	Args extends readonly unknown[],
	const Defs extends readonly NamedExtensionFlagDef[] = [],
	const Uses extends readonly AnyContextFactory[] = [],
	const Provides extends readonly AnyContextInstance[] = [],
	const Commands extends readonly CommandDefinition<any, any, any, any>[] = [],
>(
	id: ExtensionId,
	factory: (
		...args: Args
	) => ExtensionConfig<Defs, Uses, Provides, Commands> &
		ValidateExtensionConfig<Defs, Provides, Commands, Uses>,
): ExtensionFactory<
	Args,
	ContextDependencies<Uses> &
		ContextsDependencies<Provides> &
		CommandDefinitionsDependencies<Commands>,
	Provides,
	Defs,
	Commands,
	never,
	ContextDependencies<Uses>
>;
export function defineExtension<
	const Defs extends readonly NamedExtensionFlagDef[] = [],
	const Uses extends readonly AnyContextFactory[] = [],
	const Provides extends readonly AnyContextInstance[] = [],
	const Commands extends readonly CommandDefinition<any, any, any, any>[] = [],
>(
	id: ExtensionId,
	config?: ExtensionConfig<Defs, Uses, Provides, Commands> &
		ValidateExtensionConfig<Defs, Provides, Commands, Uses>,
): Extension<
	ContextDependencies<Uses> &
		ContextsDependencies<Provides> &
		CommandDefinitionsDependencies<Commands>,
	Provides,
	Defs,
	Commands,
	never,
	ContextDependencies<Uses>
>;

export function defineExtension(
	id?: ExtensionId,
	config: ExtensionConfig | ErasedExtensionFactory = {},
): Extension<any> | ExtensionFactory<any[], any> | DefineExtensionWith<never> {
	// Metadata requirements are erased, so specialization needs no runtime state.
	if (id === undefined) return defineExtension;
	if (isExtensionFactory(config))
		return Object.assign((...args: any[]) => defineExtension(id, config(...args)), { id });
	const ownedFlags = Object.freeze(toFlagsRecord(config.flags ?? []));

	toFlagsRecord([
		...(config.flags ?? []),
		...(config.provides ?? []).flatMap((instance) =>
			Object.entries(contextInstanceData(instance).ownedFlags).map(([name, def]) => ({
				...def,
				name,
			})),
		),
	]);

	// SAFETY: the runtime registry erases Defs after the overloads contextually typed every hook.
	const extension = {
		...config,
		uses: Object.freeze((config.uses ?? []).map(contextFactoryData)),
		...(config.provides
			? { provides: Object.freeze(config.provides.map(contextInstanceData)) }
			: {}),
		...(config.commands ? { commands: Object.freeze([...config.commands]) } : {}),
		id,
		...(config.flags === undefined ? {} : { flags: ownedFlags }),
	} as Extension;
	return seal(extension);
}
