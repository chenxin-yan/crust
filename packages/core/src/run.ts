import { CrustError } from "./errors.ts";
import {
	parseArgs,
	parseGlobalFlags,
	validateRequiredFlags,
} from "./parser.ts";
import { resolveCommand } from "./router.ts";
import type { AnyCommand, CommandContext, FlagDef, FlagsDef } from "./types.ts";

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
	 * Global flags parsed before subcommand routing.
	 *
	 * Required global flags are validated only on the command execution path.
	 */
	globalFlags?: FlagsDef;
}

function normalizeAliases(def: FlagDef) {
	if (!def.alias) return [];
	return Array.isArray(def.alias) ? [...def.alias] : [def.alias];
}

function validateGlobalFlagCollisions(
	globalFlags: FlagsDef | undefined,
	localFlags: FlagsDef | undefined,
	commandName: string,
): void {
	if (!globalFlags || !localFlags) return;

	const localAliasToName = new Map<string, string>();
	for (const [localName, localDef] of Object.entries(localFlags)) {
		for (const alias of normalizeAliases(localDef)) {
			localAliasToName.set(alias, localName);
		}
	}

	for (const [globalName, globalDef] of Object.entries(globalFlags)) {
		if (globalName in localFlags) {
			throw new CrustError(
				"DEFINITION",
				`Global/local flag collision on command "${commandName}": "--${globalName}" is defined in both globalFlags and command.flags`,
			);
		}

		const localAliasOwner = localAliasToName.get(globalName);
		if (localAliasOwner) {
			throw new CrustError(
				"DEFINITION",
				`Global/local flag collision on command "${commandName}": global flag "--${globalName}" conflicts with alias of local flag "--${localAliasOwner}"`,
			);
		}

		for (const globalAlias of normalizeAliases(globalDef)) {
			if (globalAlias in localFlags) {
				throw new CrustError(
					"DEFINITION",
					`Global/local flag collision on command "${commandName}": alias "--${globalAlias}" of global flag "--${globalName}" conflicts with local flag name`,
				);
			}

			const owner = localAliasToName.get(globalAlias);
			if (owner) {
				throw new CrustError(
					"DEFINITION",
					`Global/local flag collision on command "${commandName}": alias "--${globalAlias}" of global flag "--${globalName}" conflicts with alias of local flag "--${owner}"`,
				);
			}
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// runCommand — Core execution pipeline
// ────────────────────────────────────────────────────────────────────────────

/**
 * Execute a command with the given options.
 *
 * The execution pipeline:
 * 1. Parse known global flags (without required validation) and strip them from argv
 * 2. Resolve subcommand via router
 * 3. Validate global/local flag collisions for the resolved command
 * 4. Validate required global flags (execution path only)
 * 5. Parse command-local args/flags
 * 6. Build CommandContext
 * 7. Call setup() if defined
 * 8. Call run() if defined
 * 9. Call cleanup() if defined (always runs, even if run() throws)
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
	const { flags: resolvedGlobalFlags, argv: argvWithoutGlobals } =
		parseGlobalFlags(globalFlagsDef, effectiveArgv);

	// Step 1: Resolve subcommand via router
	const { resolved, argv: remainingArgv } = resolveCommand(
		command,
		argvWithoutGlobals,
	);

	validateGlobalFlagCollisions(
		globalFlagsDef,
		resolved.flags,
		resolved.meta.name,
	);

	// If the resolved command has no run(), silently noop.
	if (!resolved.run) {
		return;
	}

	validateRequiredFlags(
		globalFlagsDef,
		resolvedGlobalFlags as Record<string, unknown>,
	);

	// Step 4: Parse args/flags for the resolved command
	const parsed = parseArgs(resolved, remainingArgv);

	// Step 5: Build CommandContext
	const context: CommandContext = {
		args: parsed.args as CommandContext["args"],
		flags: parsed.flags as CommandContext["flags"],
		globalFlags: resolvedGlobalFlags as CommandContext["globalFlags"],
		rawArgs: parsed.rawArgs,
		cmd: resolved,
	};

	// Step 6-8: Execute lifecycle hooks with try/finally for cleanup
	try {
		// Step 6: Call setup() if defined
		if (resolved.setup) {
			await resolved.setup(context);
		}

		// Step 7: Call run()
		await resolved.run(context);
	} finally {
		// Step 8: Call cleanup() if defined — always runs, even if run() throws
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
