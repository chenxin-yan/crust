import { Crust } from "../command/crust.ts";
import type { CommandNode } from "../command/node.ts";
import { type CommandSnapshot, snapshotCommand } from "../command/snapshot.ts";
import type { CrustPlugin, MiddlewareContext } from "../plugins.ts";
import type { FlagDef } from "../types.ts";
import type { Awaitable } from "./context.ts";

export interface ExtensionOutput {
	write(text: string): void;
}

export interface ExtensionRunContext {
	readonly argv: readonly string[];
	readonly rootCommand: CommandSnapshot;
	readonly command: CommandSnapshot;
	readonly commandPath: readonly string[];
	readonly args: Record<string, unknown>;
	readonly flags: Record<string, unknown>;
	readonly rawArgs: readonly string[];
	readonly output: ExtensionOutput;
}

export type ExtensionRun = (context: ExtensionRunContext) => Awaitable<void>;

export interface ExtensionFlagOptions {
	/**
	 * When true (default), add this flag to every existing command in the tree.
	 * Inherited flags still flow to future extension-contributed subcommands.
	 */
	recursive?: boolean;
}

function buildExtensionRunContext(context: MiddlewareContext): ExtensionRunContext {
	const rootSnapshot = snapshotCommand(context.rootCommand);
	return {
		argv: context.argv,
		rootCommand: rootSnapshot,
		command: context.route?.command ? snapshotCommand(context.route.command) : rootSnapshot,
		commandPath: context.route?.commandPath ?? [context.rootCommand.meta.name],
		args: (context.input?.args ?? {}) as Record<string, unknown>,
		flags: (context.input?.flags ?? {}) as Record<string, unknown>,
		rawArgs: context.input?.rawArgs ?? [],
		output: {
			write(text) {
				console.log(text);
			},
		},
	};
}

function addFlagRecursive(command: CommandNode, name: string, def: FlagDef): void {
	command.effectiveFlags[name] = def;
	for (const child of Object.values(command.subCommands)) {
		addFlagRecursive(child, name, def);
	}
}

const extensionPlugins = new WeakMap<ExtensionBuilder, readonly CrustPlugin[]>();

function makeExtensionPlugin(plugin: CrustPlugin): ExtensionBuilder {
	const builder = new ExtensionBuilder(plugin.name ?? "extension");
	extensionPlugins.set(builder, [plugin]);
	return builder;
}

export class ExtensionBuilder {
	readonly kind = "extension";
	readonly name: string;

	constructor(name: string, plugins: readonly CrustPlugin[] = []) {
		this.name = name;
		extensionPlugins.set(this, plugins);
	}

	private append(plugin: CrustPlugin): ExtensionBuilder {
		return new ExtensionBuilder(this.name, [...getExtensionPlugins(this), plugin]);
	}

	flag(name: string, def: FlagDef, options: ExtensionFlagOptions = {}): ExtensionBuilder {
		const recursive = options.recursive ?? true;
		return this.append({
			name: this.name,
			setup(ctx, actions) {
				if (recursive) {
					addFlagRecursive(ctx.rootCommand, name, def);
					return;
				}
				actions.addFlag(ctx.rootCommand, name, def);
			},
		});
	}

	command(
		name: string,
		configure: (cmd: Crust<{}, {}, [], {}, {}>) => Crust<any, any, any, any, any>,
	): ExtensionBuilder {
		return this.append({
			name: this.name,
			setup(ctx, actions) {
				const command = configure(new Crust(name) as Crust<{}, {}, [], {}, {}>);
				actions.addSubCommand(ctx.rootCommand, name, command._node);
			},
		});
	}

	wrapRun(wrap: (run: ExtensionRun) => ExtensionRun): ExtensionBuilder {
		return this.append({
			name: this.name,
			async middleware(context, next) {
				const run = wrap(async () => {
					await next();
				});
				await run(buildExtensionRunContext(context));
			},
		});
	}

	beforeRun(handler: (context: ExtensionRunContext) => Awaitable<void>): ExtensionBuilder {
		return this.wrapRun((run) => async (context) => {
			await handler(context);
			await run(context);
		});
	}

	afterRun(handler: (context: ExtensionRunContext) => Awaitable<void>): ExtensionBuilder {
		return this.wrapRun((run) => async (context) => {
			await run(context);
			await handler(context);
		});
	}

	onError(
		handler: (error: unknown, context: ExtensionRunContext) => Awaitable<void>,
	): ExtensionBuilder {
		return this.append({
			name: this.name,
			async middleware(context, next) {
				try {
					await next();
				} catch (error) {
					await handler(error, buildExtensionRunContext(context));
				}
			},
		});
	}
}

export type Extension = ExtensionBuilder;

export function extension(name: string): ExtensionBuilder {
	return new ExtensionBuilder(name);
}

export function extensionFromPlugin(plugin: CrustPlugin): ExtensionBuilder {
	return makeExtensionPlugin(plugin);
}

export function getExtensionPlugins(extension: Extension): readonly CrustPlugin[] {
	return extensionPlugins.get(extension) ?? [];
}
