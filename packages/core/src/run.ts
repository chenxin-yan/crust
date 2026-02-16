import { parseRunArgs, stripGlobalFlags } from "./parser.ts";
import { resolveCommand } from "./router.ts";
import type { AnyCommand, CommandContext, FlagsDef } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// RunOptions — Configuration for runCommand / runMain
// ────────────────────────────────────────────────────────────────────────────

/**
 * Options for `runCommand` and `runMain`.
 *
 * @example
 * ```ts
 * runMain(cmd, {
 *   argv: process.argv.slice(2),
 * });
 * ```
 */
export interface RunOptions {
	/** argv array to parse. Defaults to `process.argv.slice(2)` */
	argv?: string[];
	/**
	 * Global flags available to all commands.
	 *
	 * Global flags are stripped from argv before subcommand routing, then
	 * merged with the resolved command's local flags for a single parse pass.
	 * Name or alias collisions between global and local flags are rejected
	 * as definition errors.
	 */
	globalFlags?: FlagsDef;
}

// ────────────────────────────────────────────────────────────────────────────
// runCommand — Core execution pipeline
// ────────────────────────────────────────────────────────────────────────────

/**
 * Execute a command with the given options.
 *
 * The execution pipeline:
 * 1. Strip known global flags from argv (so their values aren't mistaken for subcommands)
 * 2. Resolve subcommand via router
 * 3. Parse args/flags for the resolved command in a single pass
 *    (global + local flags merged; collisions detected as definition errors)
 * 4. Build CommandContext
 * 5. Call setup() if defined
 * 6. Call run() if defined
 * 7. Call cleanup() if defined (always runs, even if run() throws)
 *
 * @param command - The root command to execute
 * @param options - Run configuration (argv)
 * @throws {Error} On parsing errors, missing required args/flags, unknown subcommands
 *
 * @example
 * ```ts
 * import { defineCommand, runCommand } from "@crust/core";
 *
 * const cmd = defineCommand({
 *   meta: { name: "serve" },
 *   args: [{ name: "port", type: Number, default: 3000 }],
 *   run({ args }) {
 *     console.log(`Serving on port ${args.port}`);
 *   },
 * });
 *
 * await runCommand(cmd, { argv: ["8080"] });
 * ```
 */
export async function runCommand(
	command: AnyCommand,
	options?: RunOptions,
): Promise<void> {
	const effectiveArgv = options?.argv ?? process.argv.slice(2);
	const globalFlagsDef = options?.globalFlags;

	// Step 1: Strip global flags for clean routing
	const { argv: argvForRouting, globalTokens } = stripGlobalFlags(
		globalFlagsDef,
		effectiveArgv,
	);

	// Step 2: Resolve subcommand via router
	const { resolved, argv: remainingArgv } = resolveCommand(
		command,
		argvForRouting,
	);

	// If the resolved command has no run(), silently noop.
	if (!resolved.run) {
		return;
	}

	// Step 3: parse args + local flags + global flags.
	// Re-add global flag tokens so the merged parser can resolve them.
	// Global and local flag defs are merged; collisions (name or alias
	// overlap) are caught here as DEFINITION errors.
	const mergedArgv = [...globalTokens, ...remainingArgv];
	const parsed = parseRunArgs(resolved, mergedArgv, globalFlagsDef);

	// Step 4: Build CommandContext
	const context: CommandContext = {
		args: parsed.args as CommandContext["args"],
		flags: parsed.flags as CommandContext["flags"],
		globalFlags: parsed.globalFlags as CommandContext["globalFlags"],
		rawArgs: parsed.rawArgs,
		cmd: resolved,
	};

	// Step 5-7: Execute lifecycle hooks with try/finally for cleanup
	try {
		// Step 5: Call setup() if defined
		if (resolved.setup) {
			await resolved.setup(context);
		}

		// Step 6: Call run()
		await resolved.run(context);
	} finally {
		// Step 7: Call cleanup() if defined — always runs, even if run() throws
		if (resolved.cleanup) {
			await resolved.cleanup(context);
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// runMain — Top-level entry point with error handling
// ────────────────────────────────────────────────────────────────────────────

/**
 * Execute a command as the main entry point of a CLI application.
 *
 * Wraps `runCommand` with top-level error handling: catches all errors,
 * prints a formatted error message to stderr, and sets `process.exitCode = 1`.
 *
 * This is the recommended way to run a CLI command in production:
 * ```ts
 * const cmd = defineCommand({
 *   meta: { name: "my-cli" },
 *   run() {
 *     console.log("Hello from my CLI!");
 *   },
 * });
 *
 * runMain(cmd);
 * ```
 *
 * @param command - The root command to execute
 * @param options - Run configuration (argv)
 */
export async function runMain(
	command: AnyCommand,
	options?: RunOptions,
): Promise<void> {
	try {
		await runCommand(command, options);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${message}`);
		process.exitCode = 1;
	}
}
