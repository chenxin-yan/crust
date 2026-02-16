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

	const actions: SetupActions = {
		addFlag(target, name, def) {
			if (!target.flags) {
				throw new CrustError(
					"DEFINITION",
					`Cannot add flag "${name}": command "${target.meta.name}" has no flags object.`,
				);
			}
			target.flags[name] = def;
		},
	};

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
	try {
		await runCommand(command, options);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${message}`);
		process.exitCode = 1;
	}
}
