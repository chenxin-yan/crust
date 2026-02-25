import type { CommandRoute } from "./router.ts";
import type { AnyCommand, FlagDef, ParseResult } from "./types.ts";

export interface PluginState {
	get<T = unknown>(key: string): T | undefined;
	has(key: string): boolean;
	set(key: string, value: unknown): void;
	delete(key: string): boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Setup actions — available only during the setup phase
// ────────────────────────────────────────────────────────────────────────────

export interface SetupActions {
	/**
	 * Inject a flag definition into a command's flags object.
	 *
	 * Use this in plugin `setup()` hooks to register plugin-specific flags
	 * (e.g. `--version`, `--help`) so they are recognized by the parser
	 * and rendered in help text.
	 *
	 * @param command - The command to add the flag to
	 * @param name - The flag name (e.g. "version")
	 * @param def - The flag definition
	 */
	addFlag(command: AnyCommand, name: string, def: FlagDef): void;

	/**
	 * Inject a subcommand into a command's `subCommands` record.
	 *
	 * Use this in plugin `setup()` hooks to register plugin-provided commands
	 * (e.g. a "skill" management command). If the parent already has a
	 * subcommand with the same name (user-defined), the call is silently
	 * skipped — user definitions always take priority over plugin injections.
	 *
	 * @param parent - The parent command to add the subcommand to
	 * @param name - The subcommand name (used for routing)
	 * @param command - The subcommand to register
	 */
	addSubCommand(parent: AnyCommand, name: string, command: AnyCommand): void;
}

// ────────────────────────────────────────────────────────────────────────────
// Context interfaces
// ────────────────────────────────────────────────────────────────────────────

/** Shared context fields available in both setup and middleware phases. */
export interface BaseContext {
	readonly argv: readonly string[];
	readonly rootCommand: AnyCommand;
	readonly state: PluginState;
}

/** Context passed to plugin `setup()` hooks. */
export interface SetupContext extends BaseContext {}

/** Context passed to plugin `middleware()` hooks. */
export interface MiddlewareContext extends BaseContext {
	route: Readonly<CommandRoute> | null;
	input: ParseResult | null;
}

export type Next = () => Promise<void>;
export type PluginMiddleware = (
	context: MiddlewareContext,
	next: Next,
) => void | Promise<void>;

export interface CrustPlugin {
	name?: string;
	setup?: (
		context: SetupContext,
		actions: SetupActions,
	) => void | Promise<void>;
	middleware?: PluginMiddleware;
}
