import type { CommandDefinition } from "../command/crust.ts";
import type { CommandSnapshot } from "../command/snapshot.ts";
import { CrustError } from "../errors.ts";
import type {
	FlagDef,
	FlagsDef,
	InferFlags,
	InvocationIO,
	NamedFlagDef,
	NamedFlagsRecord,
} from "../types.ts";
import type { ValidateNamedFlagDefs } from "../validation/flags.brands.ts";
import { normalizeFlag } from "../validation/normalize.ts";
import type { Awaitable } from "./context.ts";

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
	| { readonly status: "finished"; readonly by: string }
	| { readonly status: "failed"; readonly error: unknown };

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
> extends Readonly<InvocationIO> {
	/**
	 * Complete argv passed to the application, including routed command names.
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
	readonly rootCommand: CommandSnapshot;
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
	 * Syntax-parsed positional values for the resolved command, before validation.
	 *
	 * @example `{ target: "api" }`
	 */
	readonly args: Readonly<Record<string, unknown>>;
	/**
	 * Syntax-parsed own flags plus unknown flags from the resolved command, before validation.
	 *
	 * @example `{ trace: true }`
	 */
	readonly flags: Readonly<InferExtensionFlags<Defs> & Record<string, unknown>>;
	/**
	 * Positional values that appeared after the `--` separator.
	 *
	 * @example `["--dry-run"]`
	 */
	readonly rawArgs: readonly string[];
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

export interface ExtensionHooks<Defs extends readonly NamedExtensionFlagDef[] = []> {
	/**
	 * Runs after routing and syntax parsing, before validation, in `.extend()` order.
	 * Return `ctx.finish()` to end the invocation successfully; later pre-run hooks,
	 * validation, schemas, Contexts, and the Command Action do not run.
	 */
	readonly preRun?: (ctx: ExtensionContext<Defs>) => Awaitable<void | Finished>;
	/**
	 * Runs after the invocation settles, in reverse `.extend()` order. This is the
	 * `finally` slot for cleanup and post-run side effects.
	 */
	readonly postRun?: (ctx: ExtensionContext<Defs>, outcome: InvocationOutcome) => Awaitable<void>;
	/**
	 * Renders a failure in `execute()` only. Return true when rendered to stop the
	 * chain; falsy values delegate to the next Extension and then Core's renderer.
	 *
	 * Receives the base context: routing or syntax-parse failures render with a
	 * fallback context whose `flags` are empty, so owned-flag inference would lie here.
	 */
	readonly onError?: (error: unknown, ctx: ExtensionContext) => Awaitable<boolean | void>;
}

/**
 * A flag owned by an Extension. `recursive` (default `true`) contributes the
 * flag to every command in the application; set `false` for a root-only flag.
 */
export type ExtensionFlagDef = FlagDef & { readonly recursive?: boolean };

/** A named flag definition accepted by {@link defineExtension}. */
export type NamedExtensionFlagDef = NamedFlagDef & { readonly recursive?: boolean };

type InferPreSchemaExtensionFlag<F extends ExtensionFlagDef> = F extends { schema: unknown }
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

export interface ExtensionConfig<
	Defs extends readonly NamedExtensionFlagDef[] = readonly NamedExtensionFlagDef[],
> {
	/** Flags this Extension owns and contributes to the application */
	readonly flags?: Defs;
	/** Root command definitions this Extension owns and contributes to the application */
	readonly commands?: readonly CommandDefinition<any>[];
	/** Plain-text sections contributed to commands when the application is prepared. */
	readonly sections?: (
		snapshot: CommandSnapshot,
	) => readonly { command: readonly string[]; title: string; body: string }[];
	readonly hooks?: ExtensionHooks<Defs>;
}

// Branding lives on the defineExtension signature, not on ExtensionConfig
// itself, so docs render the readable array type while duplicate/alias
// collisions still fail at the call site — mirrors defineContext.
type ValidateExtensionConfig<Defs extends readonly NamedExtensionFlagDef[]> = {
	readonly flags?: ValidateNamedFlagDefs<Defs>;
};

/**
 * An application-wide reusable capability. A plain frozen structural value —
 * see {@link defineExtension}.
 */
export interface Extension {
	readonly name: string;
	readonly flags?: Readonly<Record<string, ExtensionFlagDef>>;
	readonly commands?: readonly CommandDefinition<any>[];
	readonly sections?: (
		snapshot: CommandSnapshot,
	) => readonly { command: readonly string[]; title: string; body: string }[];
	readonly hooks?: ExtensionHooks;
}

/**
 * Define an Extension.
 *
 * Extensions apply to the whole application and own the flags and commands
 * they contribute; contributed names must not collide with application or
 * other Extension definitions. Collisions within one Extension throw here at
 * define time; collisions with application or other Extension definitions
 * surface when the application prepares.
 */
export function defineExtension<const Defs extends readonly NamedExtensionFlagDef[] = []>(
	name: string,
	config: ExtensionConfig<Defs> & ValidateExtensionConfig<Defs> = {},
): Extension {
	if (!name.trim()) {
		throw new CrustError("DEFINITION", "Extension name must be a non-empty string", {
			subject: "extension",
			reason: "empty-name",
		});
	}

	const ownedFlags: FlagsDef = {};
	const spellings = new Map();
	for (const def of config.flags ?? []) {
		const { name: flagName, ...rest } = def;
		normalizeFlag(
			{ name: flagName, def: rest as FlagDef },
			ownedFlags,
			spellings,
			`Extension "${name}"`,
		);
		ownedFlags[flagName] = rest as ExtensionFlagDef;
	}

	// The runtime registry erases Defs after defineExtension contextually types its own hooks.
	return Object.freeze({
		...config,
		...(config.flags === undefined ? {} : { flags: ownedFlags }),
		name,
	}) as Extension;
}
