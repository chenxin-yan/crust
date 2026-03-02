import type { CommandNode } from "./node.ts";
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

/** A command target accepted by SetupActions — either old Command or new CommandNode */
type CommandTarget = AnyCommand | CommandNode;

export interface SetupActions {
	/**
	 * Inject a flag definition into a command's flags object.
	 *
	 * Use this in plugin `setup()` hooks to register plugin-specific flags
	 * (e.g. `--version`, `--help`) so they are recognized by the parser
	 * and rendered in help text.
	 *
	 * For `CommandNode` targets (new builder API), the flag is added to both
	 * `localFlags` and `effectiveFlags`. For `AnyCommand` targets (old API),
	 * the flag is added to `flags`.
	 *
	 * @param command - The command to add the flag to (Command or CommandNode)
	 * @param name - The flag name (e.g. "version")
	 * @param def - The flag definition
	 */
	addFlag(command: CommandTarget, name: string, def: FlagDef): void;

	/**
	 * Inject a subcommand into a command's `subCommands` record.
	 *
	 * Use this in plugin `setup()` hooks to register plugin-provided commands
	 * (e.g. a "skill" management command). If the parent already has a
	 * subcommand with the same name (user-defined), the call is silently
	 * skipped — user definitions always take priority over plugin injections.
	 *
	 * @param parent - The parent command to add the subcommand to (Command or CommandNode)
	 * @param name - The subcommand name (used for routing)
	 * @param command - The subcommand to register (Command or CommandNode)
	 */
	addSubCommand(
		parent: CommandTarget,
		name: string,
		command: CommandTarget,
	): void;
}

// ────────────────────────────────────────────────────────────────────────────
// Context interfaces
// ────────────────────────────────────────────────────────────────────────────

/** Shared context fields available in both setup and middleware phases. */
export interface BaseContext {
	readonly argv: readonly string[];
	readonly rootCommand: AnyCommand | CommandNode;
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
