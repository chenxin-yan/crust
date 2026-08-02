import type { CommandNode } from "../command/node.ts";
import type { CommandSnapshot } from "../command/snapshot.ts";
import { CrustError } from "../errors.ts";
import type { FlagDef } from "../types.ts";
import type { Awaitable } from "./context.ts";

// ────────────────────────────────────────────────────────────────────────────
// Extension — the public integration contract (ADR-0001)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Readonly invocation view passed to Extension hooks.
 *
 * Commands cross this boundary as readonly, serializable
 * {@link CommandSnapshot}s — never as internal command nodes.
 */
export interface ExtensionContext {
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
	/** Write a line of standard output (honors io injected via `run()`) */
	readonly stdout: (text: string) => void;
	/** Write a line of diagnostic output (honors io injected via `run()`) */
	readonly stderr: (text: string) => void;
}

export type ExtensionNext = () => Promise<void>;

/**
 * The one interception primitive. Executes after routing and syntax parsing
 * but before application value validation and Context construction, so an
 * Extension can short-circuit (by not calling `next()`) without exposing
 * nullable parser state. Extension-owned inputs are validated before the
 * hook; routing and syntax failures flow directly to error handling.
 */
export type ExtensionIntercept = (
	context: ExtensionContext,
	next: ExtensionNext,
) => Awaitable<void>;

/**
 * Presentation-only error hook. Hooks form a chain ending in Core's default
 * renderer: render the failure yourself, or call `next()` to delegate to the
 * next handler. Core always preserves a nonzero failure outcome regardless
 * of what a handler does.
 */
export type ExtensionErrorHandler = (
	error: unknown,
	context: ExtensionContext,
	next: ExtensionNext,
) => Awaitable<void>;

/**
 * A flag owned by an Extension. `recursive` (default `true`) contributes the
 * flag to every command in the application; set `false` for a root-only flag.
 */
export type ExtensionFlagDef = FlagDef & { readonly recursive?: boolean };

/**
 * A configured command builder contributed by an Extension. Structural on
 * purpose (any `Crust` builder satisfies it) so Extension values stay
 * assignable across separately-bundled type declarations.
 */
export interface ExtensionCommand {
	readonly _node: CommandNode;
}

export interface ExtensionConfig {
	/** Flags this Extension owns and contributes to the application */
	readonly flags?: Readonly<Record<string, ExtensionFlagDef>>;
	/** Root commands this Extension owns and contributes to the application */
	readonly commands?: readonly ExtensionCommand[];
	readonly intercept?: ExtensionIntercept;
	readonly handleError?: ExtensionErrorHandler;
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
