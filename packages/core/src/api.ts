import { Crust, type CrustCommandContext } from "./crust.ts";
import type { CommandNode } from "./node.ts";
import type { CrustPlugin, MiddlewareContext } from "./plugins.ts";
import type {
	ArgDef,
	ArgsDef,
	CommandMeta,
	EffectiveFlags,
	FlagDef,
	FlagsDef,
	ValidateFlagAliases,
	ValidateNoPrefixedFlags,
	ValidateVariadicArgs,
} from "./types.ts";

type Simplify<T> = { [K in keyof T]: T[K] };
type ContextMap = Record<string, unknown>;
type Awaitable<T> = T | Promise<T>;

type AppendArg<A extends ArgsDef, Def extends ArgDef> = readonly [...A, Def];
type AddFlag<F extends FlagsDef, Name extends string, Def extends FlagDef> = Simplify<
	Omit<F, Name> & { [K in Name]: Def }
>;
type MergeContext<A, B> = Simplify<A & B>;
type ContextOutput<S> =
	S extends ContextInstance<infer Name, infer Value, infer _Deps>
		? { [K in Name]: Awaited<Value> }
		: never;
type InternalCommandBuilder = {
	readonly _node: CommandNode;
	readonly _inheritedFlags: FlagsDef;
};

export interface ContextSetup<Ctx extends ContextMap = ContextMap> {
	readonly ctx: Readonly<Ctx>;
}

export interface ContextInstance<
	Name extends string = string,
	Value = unknown,
	Deps extends ContextMap = ContextMap,
> {
	readonly kind: "context";
	readonly name: Name;
	setup(context: Readonly<Deps>): Awaitable<Value>;
}

export interface ContextFactory<
	Name extends string,
	Options,
	Value,
	Deps extends ContextMap = ContextMap,
> {
	(options: Options): ContextInstance<Name, Value, Deps>;
}

export interface ExtensionOutput {
	write(text: string): void;
}

export interface ExtensionRunContext {
	readonly argv: readonly string[];
	readonly rootCommand: CommandNode;
	readonly command: CommandNode;
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

export function context<Name extends string, Value>(
	name: Name,
	setup: () => Awaitable<Value>,
): ContextInstance<Name, Value, {}>;
export function context<Name extends string, Options, Value, Deps extends ContextMap = ContextMap>(
	name: Name,
	setup: (options: Options, context: Readonly<Deps>) => Awaitable<Value>,
): ContextFactory<Name, Options, Value, Deps>;
export function context<Name extends string, Options, Value, Deps extends ContextMap = ContextMap>(
	name: Name,
	setup:
		| (() => Awaitable<Value>)
		| ((options: Options, context: Readonly<Deps>) => Awaitable<Value>),
): any {
	if (setup.length === 0) {
		return {
			kind: "context" as const,
			name,
			setup: () => (setup as () => Awaitable<Value>)(),
		} satisfies ContextInstance<Name, Value, {}>;
	}

	return (options: Options) =>
		({
			kind: "context" as const,
			name,
			setup: (context: Readonly<Deps>) =>
				(setup as (options: Options, context: Readonly<Deps>) => Awaitable<Value>)(
					options,
					context,
				),
		}) satisfies ContextInstance<Name, Value, Deps>;
}

function buildExtensionRunContext(context: MiddlewareContext): ExtensionRunContext {
	return {
		argv: context.argv,
		rootCommand: context.rootCommand,
		command: context.route?.command ?? context.rootCommand,
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
		configure: (cmd: CommandBuilder<{}, {}, [], {}, {}>) => CommandBuilder<any, any, any, any, any>,
	): ExtensionBuilder {
		return this.append({
			name: this.name,
			setup(ctx, actions) {
				const command = configure(cli(name));
				actions.addSubCommand(ctx.rootCommand, name, command._crust._node);
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

async function buildContexts(contexts: readonly ContextInstance[]): Promise<ContextMap> {
	const context: ContextMap = {};
	for (const item of contexts) {
		context[item.name] = await item.setup(context);
	}
	return context;
}

export interface CliCommandContext<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
	Ctx extends ContextMap = ContextMap,
> extends CrustCommandContext<A, F> {
	readonly ctx: Readonly<Ctx>;
}

export class CommandBuilder<
	Inherited extends FlagsDef = FlagsDef,
	Local extends FlagsDef = FlagsDef,
	A extends ArgsDef = ArgsDef,
	Eff extends FlagsDef = EffectiveFlags<Inherited, Local>,
	Ctx extends ContextMap = {},
> {
	/** @internal */
	readonly _crust: Crust<Inherited, Local, A, Eff>;
	private readonly contexts: readonly ContextInstance[];

	constructor(crust: Crust<Inherited, Local, A, Eff>, contexts: readonly ContextInstance[] = []) {
		this._crust = crust;
		this.contexts = contexts;
	}

	private clone<
		NextInherited extends FlagsDef,
		NextLocal extends FlagsDef,
		NextA extends ArgsDef,
		NextEff extends FlagsDef,
		NextCtx extends ContextMap,
	>(
		crust: Crust<NextInherited, NextLocal, NextA, NextEff>,
		contexts: readonly ContextInstance[] = this.contexts,
	): CommandBuilder<NextInherited, NextLocal, NextA, NextEff, NextCtx> {
		return new CommandBuilder(crust, contexts);
	}

	meta(meta: Omit<CommandMeta, "name">): CommandBuilder<Inherited, Local, A, Eff, Ctx> {
		return this.clone(this._crust.meta(meta));
	}

	alias(...aliases: string[]): CommandBuilder<Inherited, Local, A, Eff, Ctx> {
		return this.meta({ aliases });
	}

	flags<const F extends FlagsDef>(
		defs: F & ValidateNoPrefixedFlags<ValidateFlagAliases<F>>,
	): CommandBuilder<Inherited, F, A, EffectiveFlags<Inherited, F>, Ctx> {
		const next = (this._crust as any).flags(defs) as Crust<
			Inherited,
			F,
			A,
			EffectiveFlags<Inherited, F>
		>;
		return this.clone(next);
	}

	flag<const Name extends string, const Def extends FlagDef>(
		name: Name,
		def: Def,
	): CommandBuilder<
		Inherited,
		AddFlag<Local, Name, Def>,
		A,
		EffectiveFlags<Inherited, AddFlag<Local, Name, Def>>,
		Ctx
	> {
		const nextFlags = {
			...this._crust._node.localFlags,
			[name]: def,
		} as AddFlag<Local, Name, Def> &
			ValidateNoPrefixedFlags<ValidateFlagAliases<AddFlag<Local, Name, Def>>>;

		const next = (this._crust as any).flags(nextFlags) as Crust<
			Inherited,
			AddFlag<Local, Name, Def>,
			A,
			EffectiveFlags<Inherited, AddFlag<Local, Name, Def>>
		>;
		return this.clone(next);
	}

	args<const NewA extends ArgsDef>(
		defs: NewA & ValidateVariadicArgs<NewA>,
	): CommandBuilder<Inherited, Local, NewA, Eff, Ctx> {
		const next = (this._crust as any).args(defs) as Crust<Inherited, Local, NewA, Eff>;
		return this.clone(next);
	}

	arg<const Def extends ArgDef>(
		def: Def,
	): CommandBuilder<Inherited, Local, AppendArg<A, Def>, Eff, Ctx> {
		const nextArgs = [...(this._crust._node.args ?? []), def] as unknown as AppendArg<A, Def>;
		const next = (this._crust as any).args(nextArgs) as Crust<
			Inherited,
			Local,
			AppendArg<A, Def>,
			Eff
		>;
		return this.clone(next);
	}

	use<const C extends ContextInstance>(
		context: C,
	): CommandBuilder<Inherited, Local, A, Eff, MergeContext<Ctx, ContextOutput<C>>> {
		return this.clone(this._crust, [...this.contexts, context]);
	}

	extend(...extensions: readonly Extension[]): CommandBuilder<Inherited, Local, A, Eff, Ctx> {
		let next = this._crust;
		for (const item of extensions) {
			for (const plugin of getExtensionPlugins(item)) {
				next = next.use(plugin);
			}
		}
		return this.clone(next);
	}

	run(
		handler: (ctx: NoInfer<CliCommandContext<A, Eff, Ctx>>) => void | Promise<void>,
	): CommandBuilder<Inherited, Local, A, Eff, Ctx> {
		const contexts = this.contexts;
		return this.clone(
			this._crust.run(async (ctx) => {
				const commandContext = (await buildContexts(contexts)) as Ctx;
				await handler({ ...ctx, ctx: commandContext } as CliCommandContext<A, Eff, Ctx>);
			}),
		);
	}

	preRun(
		handler: (ctx: NoInfer<CliCommandContext<A, Eff, Ctx>>) => void | Promise<void>,
	): CommandBuilder<Inherited, Local, A, Eff, Ctx> {
		const contexts = this.contexts;
		return this.clone(
			this._crust.preRun(async (ctx) => {
				const commandContext = (await buildContexts(contexts)) as Ctx;
				await handler({ ...ctx, ctx: commandContext } as CliCommandContext<A, Eff, Ctx>);
			}),
		);
	}

	postRun(
		handler: (ctx: NoInfer<CliCommandContext<A, Eff, Ctx>>) => void | Promise<void>,
	): CommandBuilder<Inherited, Local, A, Eff, Ctx> {
		const contexts = this.contexts;
		return this.clone(
			this._crust.postRun(async (ctx) => {
				const commandContext = (await buildContexts(contexts)) as Ctx;
				await handler({ ...ctx, ctx: commandContext } as CliCommandContext<A, Eff, Ctx>);
			}),
		);
	}

	command<N extends string>(
		name: N,
		configure: (
			cmd: CommandBuilder<Eff, {}, [], EffectiveFlags<Eff, {}>, Ctx>,
		) => CommandBuilder<any, any, any, any, any>,
	): CommandBuilder<Inherited, Local, A, Eff, Ctx>;
	command(
		builder: CommandBuilder<any, any, any, any, any>,
	): CommandBuilder<Inherited, Local, A, Eff, Ctx>;
	command(builder: InternalCommandBuilder): CommandBuilder<Inherited, Local, A, Eff, Ctx>;
	command(
		nameOrBuilder: string | CommandBuilder<any, any, any, any, any> | InternalCommandBuilder,
		configure?: (
			cmd: CommandBuilder<any, any, any, any, any>,
		) => CommandBuilder<any, any, any, any, any>,
	): CommandBuilder<Inherited, Local, A, Eff, Ctx> {
		if (typeof nameOrBuilder === "string") {
			const next = this._crust.command(nameOrBuilder, (child) => {
				const wrapped = new CommandBuilder(child, this.contexts);
				const configured = configure?.(wrapped);
				if (!configured) {
					throw new Error(
						"command(name, configure) requires configure to return a command builder",
					);
				}
				return configured._crust;
			});
			return this.clone(next);
		}

		if (nameOrBuilder instanceof CommandBuilder) {
			return this.clone(this._crust.command(nameOrBuilder._crust));
		}

		return this.clone((this._crust as any).command(nameOrBuilder));
	}

	sub<N extends string>(name: N): CommandBuilder<Eff, {}, [], EffectiveFlags<Eff, {}>, Ctx> {
		return new CommandBuilder(this._crust.sub(name), this.contexts);
	}

	async prepareCommandTree(options?: {
		argv?: readonly string[];
	}): Promise<{ root: CommandNode; warnings: readonly string[] }> {
		return this._crust.prepareCommandTree(options);
	}

	async execute(options?: { argv?: string[] }): Promise<void> {
		await this._crust.execute(options);
	}
}

export type CliApp<Ctx extends ContextMap = {}> = CommandBuilder<{}, {}, [], {}, Ctx>;

export function cli<Name extends string>(name: Name): CommandBuilder<{}, {}, [], {}, {}> {
	return new CommandBuilder(new Crust(name) as unknown as Crust<{}, {}, [], {}>);
}
