import { CrustError } from "./errors.ts";
import { parseArgs } from "./parser.ts";
import type {
	CrustPlugin,
	MiddlewareContext,
	PluginState,
	SetupActions,
	SetupContext,
} from "./plugins.ts";
import { resolveCommand } from "./router.ts";
import type { AnyCommand, CommandContext, ParseResult } from "./types.ts";

/**
 * Build-time validation protocol.
 *
 * `crust build` spawns the user's entrypoint as a subprocess with
 * `CRUST_INTERNAL_VALIDATE_ONLY=1`. When `runMain` detects this env flag it
 * runs validation, surfaces errors via stderr/exitCode, then force-exits.
 *
 * `VALIDATION_RESULT_GLOBAL_KEY` stores the result on `globalThis` for
 * in-process consumers (tests that call `runMain` directly).
 */
export const VALIDATION_MODE_ENV = "CRUST_INTERNAL_VALIDATE_ONLY";
export const VALIDATION_RESULT_GLOBAL_KEY = "__CRUST_VALIDATE_RESULT__";

export interface RunOptions {
	argv?: string[];
	plugins?: CrustPlugin[];
}

function createPluginState(): PluginState {
	const map = new Map<string, unknown>();
	return {
		get<T = unknown>(key: string): T | undefined {
			return map.get(key) as T | undefined;
		},
		has(key: string): boolean {
			return map.has(key);
		},
		set(key: string, value: unknown): void {
			map.set(key, value);
		},
		delete(key: string): boolean {
			return map.delete(key);
		},
	};
}

async function runSetupHooks(
	plugins: readonly CrustPlugin[],
	context: SetupContext,
	actions: SetupActions,
): Promise<void> {
	for (const plugin of plugins) {
		if (!plugin.setup) continue;
		await plugin.setup(context, actions);
	}
}

function createSetupActions(warnings?: string[]): SetupActions {
	return {
		addFlag(target, name, def) {
			if (!target.flags) {
				throw new CrustError(
					"DEFINITION",
					`Cannot add flag "${name}": "${target.meta.name}" has no flags object`,
				);
			}
			if (name in target.flags) {
				warnings?.push(
					`Plugin flag "--${name}" on "${target.meta.name}" overrides existing flag`,
				);
			}
			target.flags[name] = def;
		},
		addSubCommand(parent, name, subCommand) {
			if (!name.trim()) {
				throw new CrustError(
					"DEFINITION",
					"addSubCommand: name must be a non-empty string",
				);
			}
			// User-defined subcommands take priority — skip
			if (parent.subCommands[name]) {
				warnings?.push(
					`Plugin subcommand "${name}" on "${parent.meta.name}" skipped (already exists)`,
				);
				return;
			}
			parent.subCommands[name] = subCommand;
		},
	};
}

async function runValidation(
	command: AnyCommand,
	options?: RunOptions,
): Promise<void> {
	const argv = options?.argv ?? process.argv.slice(2);
	const plugins = options?.plugins ?? [];
	const warnings: string[] = [];

	const setupContext: SetupContext = {
		argv: [...argv] as readonly string[],
		rootCommand: command,
		state: createPluginState(),
	};

	await runSetupHooks(plugins, setupContext, createSetupActions(warnings));
	// Dynamic import so validation code is not loaded during normal CLI execution
	const { validateCommandTree } = await import("./validation.ts");
	validateCommandTree(command);

	for (const warning of warnings) {
		console.warn(`Warning: ${warning}`);
	}
}

async function executeCommand(
	command: AnyCommand,
	parsed: ReturnType<typeof parseArgs>,
): Promise<void> {
	if (!command.run) return;

	const context: CommandContext = {
		args: parsed.args,
		flags: parsed.flags,
		rawArgs: parsed.rawArgs,
		command,
	};

	try {
		if (command.preRun) {
			await command.preRun(context);
		}

		await command.run(context);
	} finally {
		if (command.postRun) {
			await command.postRun(context);
		}
	}
}

async function runMiddlewareChain(
	plugins: readonly CrustPlugin[],
	context: MiddlewareContext,
	terminal: () => Promise<void>,
): Promise<void> {
	const stack = plugins
		.map((plugin) => plugin.middleware)
		.filter((middleware): middleware is NonNullable<typeof middleware> =>
			Boolean(middleware),
		);
	let index = -1;

	const dispatch = async (i: number): Promise<void> => {
		if (i <= index) {
			throw new CrustError(
				"DEFINITION",
				"Plugin middleware called next() multiple times",
			);
		}
		index = i;

		if (i === stack.length) {
			await terminal();
			return;
		}

		const middleware = stack[i];
		if (!middleware) {
			throw new CrustError("DEFINITION", "Plugin middleware stack is invalid");
		}

		await middleware(context, () => dispatch(i + 1));
	};

	await dispatch(0);
}

export async function runCommand(
	command: AnyCommand,
	options?: RunOptions,
): Promise<void> {
	const argv = options?.argv ?? process.argv.slice(2);
	const plugins = options?.plugins ?? [];
	const actions = createSetupActions();

	const middlewareContext: MiddlewareContext = {
		argv: [...argv] as readonly string[],
		rootCommand: command,
		state: createPluginState(),
		route: null,
		input: null,
	};

	try {
		await runSetupHooks(plugins, middlewareContext, actions);

		let parsed: ParseResult;
		let resolvedCommand: AnyCommand;

		try {
			const resolved = resolveCommand(command, [...argv]);
			middlewareContext.route = resolved;

			parsed = parseArgs(resolved.command, resolved.argv);

			middlewareContext.input = {
				args: parsed.args,
				flags: parsed.flags,
				rawArgs: parsed.rawArgs,
			};
			resolvedCommand = resolved.command;
		} catch (error) {
			await runMiddlewareChain(plugins, middlewareContext, async () => {
				throw error;
			});
			return;
		}

		await runMiddlewareChain(plugins, middlewareContext, async () => {
			await executeCommand(resolvedCommand, parsed);
		});
	} catch (error) {
		if (error instanceof CrustError) {
			throw error;
		}
		if (error instanceof Error) {
			throw new CrustError("EXECUTION", error.message).withCause(error);
		}
		throw new CrustError("EXECUTION", String(error)).withCause(error);
	}
}

export async function runMain(
	command: AnyCommand,
	options?: RunOptions,
): Promise<void> {
	if (process.env[VALIDATION_MODE_ENV] === "1") {
		const result = (async () => {
			try {
				await runValidation(command, options);
				return { ok: true } as const;
			} catch (error) {
				// Surface for subprocess consumers (crust build spawns bun <entry>)
				const message = error instanceof Error ? error.message : String(error);
				console.error(message);
				process.exitCode = 1;
				return { ok: false, error } as const;
			}
		})();

		// Store for in-process consumers (tests)
		(globalThis as Record<string, unknown>)[VALIDATION_RESULT_GLOBAL_KEY] =
			result;
		await result;

		// Force-exit the subprocess. Without this, lingering event-loop handles
		// (timers, listeners created at import time) keep the process alive
		// indefinitely, causing `crust build` validation to hang.
		// Uses `return` so tests that mock process.exit don't fall through.
		return process.exit(process.exitCode ?? 0);
	}

	try {
		await runCommand(command, options);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${message}`);
		process.exitCode = 1;
	}
}
