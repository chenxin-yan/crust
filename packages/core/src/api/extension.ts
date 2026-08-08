import type { CommandDefinition } from "../command/crust.ts";
import type { CommandSnapshot } from "../command/snapshot.ts";
import { CrustError } from "../errors.ts";
import type { FlagDef, InvocationIO } from "../types.ts";
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
 */
export interface ExtensionContext extends Readonly<InvocationIO> {
	readonly argv: readonly string[];
	/** Snapshot of the application root, including Extension-contributed flags/commands */
	readonly rootCommand: CommandSnapshot;
	/** Snapshot of the resolved command (the root when routing failed) */
	readonly command: CommandSnapshot;
	readonly commandPath: readonly string[];
	/** Syntax-parsed positional values for the resolved command */
	readonly args: Readonly<Record<string, unknown>>;
	/** Syntax-parsed flag values for the resolved command */
	readonly flags: Readonly<Record<string, unknown>>;
	readonly rawArgs: readonly string[];
	/** End the invocation successfully before validation, Context construction, and the action. */
	readonly finish: () => Finished;
}

export interface ExtensionHooks {
	/**
	 * Runs after routing and syntax parsing, before validation, in `.extend()` order.
	 * Return `ctx.finish()` to end the invocation successfully; later pre-run hooks,
	 * validation, schemas, Contexts, and the Command Action do not run.
	 */
	readonly preRun?: (ctx: ExtensionContext) => Awaitable<void | Finished>;
	/**
	 * Runs after the invocation settles, in reverse `.extend()` order. This is the
	 * `finally` slot for cleanup and post-run side effects.
	 */
	readonly postRun?: (ctx: ExtensionContext, outcome: InvocationOutcome) => Awaitable<void>;
	/**
	 * Renders a failure in `execute()` only. Return true when rendered to stop the
	 * chain; falsy values delegate to the next Extension and then Core's renderer.
	 */
	readonly onError?: (error: unknown, ctx: ExtensionContext) => Awaitable<boolean | void>;
}

/**
 * A flag owned by an Extension. `recursive` (default `true`) contributes the
 * flag to every command in the application; set `false` for a root-only flag.
 */
export type ExtensionFlagDef = FlagDef & { readonly recursive?: boolean };

export interface ExtensionConfig {
	/** Flags this Extension owns and contributes to the application */
	readonly flags?: Readonly<Record<string, ExtensionFlagDef>>;
	/** Root command definitions this Extension owns and contributes to the application */
	readonly commands?: readonly CommandDefinition<any>[];
	readonly hooks?: ExtensionHooks;
}

/**
 * An application-wide reusable capability. A plain frozen structural value —
 * see {@link defineExtension}.
 */
export interface Extension extends ExtensionConfig {
	readonly name: string;
}

/**
 * Define an Extension.
 *
 * Extensions apply to the whole application and own the flags and commands
 * they contribute; contributed names must not collide with application or
 * other Extension definitions (collisions are definition errors, surfaced
 * when the application runs).
 */
export function defineExtension(name: string, config: ExtensionConfig = {}): Extension {
	if (!name.trim()) {
		throw new CrustError("DEFINITION", "Extension name must be a non-empty string", {
			subject: "extension",
			reason: "empty-name",
		});
	}
	return Object.freeze({ ...config, name });
}
