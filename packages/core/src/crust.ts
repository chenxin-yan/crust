import { CrustError } from "./errors.ts";
import {
	type CommandNode,
	computeEffectiveFlags,
	createCommandNode,
} from "./node.ts";
import { parseArgs, validateParsed } from "./parser.ts";
import type {
	CrustPlugin,
	MiddlewareContext,
	PluginState,
	SetupActions,
	SetupContext,
} from "./plugins.ts";
import { resolveCommand } from "./router.ts";
import type {
	ArgsDef,
	CommandMeta,
	EffectiveFlags,
	FlagsDef,
	InferArgs,
	InferFlags,
	ValidateFlagAliases,
	ValidateNoPrefixedFlags,
	ValidateVariadicArgs,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// CrustCommandContext — Runtime context for lifecycle hooks
// ────────────────────────────────────────────────────────────────────────────

/**
 * The runtime context object passed to `preRun()`, `run()`, and `postRun()`
 * lifecycle hooks on the `Crust` builder.
 *
 * Generic parameters:
 * - `A` — positional argument definitions tuple
 * - `F` — the effective (inherited + local merged) flag definitions
 */
export interface CrustCommandContext<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
> {
	/** Resolved positional arguments, keyed by arg name */
	args: InferArgs<A>;
	/** Resolved flags, keyed by flag name */
	flags: InferFlags<F>;
	/** Raw arguments that appeared after the `--` separator */
	rawArgs: string[];
	/** The resolved command node that is being executed */
	command: CommandNode;
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers — runtime flag validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Runtime guard: reject flag names starting with "no-".
 * Mirrors the compile-time `ValidateNoPrefixedFlags` type.
 */
function validateNoPrefixFlags(flags: FlagsDef): void {
	for (const [name, def] of Object.entries(flags)) {
		if (name.startsWith("no-")) {
			const base = name.slice(3);
			throw new CrustError(
				"DEFINITION",
				`Flag "--${name}" must not use "no-" prefix; define "${base}" and negate with "--no-${base}"`,
			);
		}
		if (def.short?.startsWith("no-")) {
			throw new CrustError(
				"DEFINITION",
				`Short alias "-${def.short}" on "--${name}" must not use "no-" prefix (reserved for negation)`,
			);
		}
		if (def.aliases) {
			for (const alias of def.aliases) {
				if (alias.startsWith("no-")) {
					throw new CrustError(
						"DEFINITION",
						`Alias "--${alias}" on "--${name}" must not use "no-" prefix (reserved for negation)`,
					);
				}
			}
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers — execution pipeline
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build-time validation protocol.
 *
 * `crust build` spawns the user's entrypoint as a subprocess with
 * `CRUST_INTERNAL_VALIDATE_ONLY=1`. When `.execute()` detects this env flag
 * it runs validation, surfaces errors via stderr/exitCode, then force-exits.
 */
export const VALIDATION_MODE_ENV = "CRUST_INTERNAL_VALIDATE_ONLY";
const EXIT_CODE_CANCELLED = 130;

/** Key for storing validation result on globalThis (for in-process tests) */
const VALIDATION_RESULT_GLOBAL_KEY = "__CRUST_VALIDATE_RESULT__";

/** Create a fresh PluginState (key-value store per execution). */
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

function isPromptCancelledError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	return error.name === "CancelledError";
}

/** Create SetupActions that work with CommandNode targets. */
function createSetupActions(warnings?: string[]): SetupActions {
	return {
		addFlag(target, name, def) {
			if (name in target.effectiveFlags) {
				warnings?.push(
					`Plugin flag "--${name}" on "${target.meta.name}" overrides existing flag`,
				);
			}
			target.effectiveFlags[name] = def;
		},
		addSubCommand(parent, name, subCommand) {
			if (!name.trim()) {
				throw new CrustError(
					"DEFINITION",
					"addSubCommand: name must be a non-empty string",
				);
			}
			if (parent.subCommands[name]) {
				warnings?.push(
					`Plugin subcommand "${name}" on "${parent.meta.name}" skipped (already exists)`,
				);
				return;
			}
			(parent.subCommands as Record<string, unknown>)[name] = subCommand;
		},
	};
}

/** Run plugin setup() hooks sequentially. */
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

/** Run plugin middleware chain, terminating with `terminal`. */
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

/**
 * Collect all plugins from a CommandNode tree.
 * Root plugins come first, then depth-first through subcommands.
 */
function collectPlugins(node: CommandNode): CrustPlugin[] {
	const plugins: CrustPlugin[] = [...node.plugins];
	for (const sub of Object.values(node.subCommands)) {
		plugins.push(...collectPlugins(sub));
	}
	return plugins;
}

/**
 * Recursively freeze a CommandNode tree (shallow freeze per node).
 */
function freezeTree(node: CommandNode): void {
	Object.freeze(node);
	Object.freeze(node.localFlags);
	Object.freeze(node.effectiveFlags);
	Object.freeze(node.meta);
	Object.freeze(node.plugins);
	if (node.args) Object.freeze(node.args);
	for (const sub of Object.values(node.subCommands)) {
		freezeTree(sub);
	}
	Object.freeze(node.subCommands);
}

// ────────────────────────────────────────────────────────────────────────────
// Crust — Chainable builder class
// ────────────────────────────────────────────────────────────────────────────

/**
 * Chainable builder for defining CLI commands with full type inference.
 *
 * Generic parameters:
 * - `Inherited` — flags inherited from a parent command (populated by `.command()`)
 * - `Local` — flags defined on this command via `.flags()`
 * - `A` — positional argument definitions
 * - `Eff` — effective flags (merged inherited + local flags, computed internally)
 *
 * @example
 * ```ts
 * const app = new Crust("my-cli")
 *   .flags({
 *     verbose: { type: "boolean", short: "v", inherit: true },
 *   })
 *   .args([{ name: "file", type: "string", required: true }])
 *   .run(({ args, flags }) => {
 *     console.log(args.file, flags.verbose);
 *   });
 * ```
 */
export class Crust<
	Inherited extends FlagsDef = FlagsDef,
	Local extends FlagsDef = FlagsDef,
	A extends ArgsDef = ArgsDef,
	Eff extends FlagsDef = EffectiveFlags<Inherited, Local>,
> {
	/** @internal — Phantom property exposing generic parameters for type-level testing */
	declare readonly _types: {
		inherited: Inherited;
		local: Local;
		args: A;
		effective: Eff;
	};

	/** @internal */
	readonly _node: CommandNode;

	/** @internal — The inherited flags record (runtime counterpart of Inherited generic) */
	readonly _inheritedFlags: FlagsDef;

	/**
	 * Create a new root or standalone command builder.
	 *
	 * @param name - The command name.
	 * @throws {CrustError} `DEFINITION` if name is empty or whitespace-only
	 */
	constructor(name: string) {
		if (!name.trim()) {
			throw new CrustError(
				"DEFINITION",
				"meta.name must be a non-empty string",
			);
		}
		this._node = createCommandNode(name);
		this._inheritedFlags = {};
	}

	/**
	 * @internal — Create a child builder with pre-populated inherited flags.
	 * Used by `.command()` to propagate parent flags to the child.
	 */
	static _createChild<I extends FlagsDef>(
		name: string,
		inheritedFlags: FlagsDef,
		// biome-ignore lint/complexity/noBannedTypes: empty initial state for child builder's Local generic
	): Crust<I, {}, [], EffectiveFlags<I, {}>> {
		// biome-ignore lint/complexity/noBannedTypes: empty initial state for child builder's Local generic
		const instance = new Crust<I, {}, [], EffectiveFlags<I, {}>>(name);
		// Override the inherited flags set by constructor (which defaults to {})
		(instance as { _inheritedFlags: FlagsDef })._inheritedFlags =
			inheritedFlags;
		return instance;
	}

	/**
	 * @internal — Clone this builder with a new node, preserving generics.
	 */
	private _clone(nodeOverrides: Partial<CommandNode>): this {
		const cloned = Object.create(Object.getPrototypeOf(this)) as this;
		const newNode: CommandNode = {
			...this._node,
			// Shallow copy collections so mutations don't affect the original
			localFlags: { ...this._node.localFlags },
			effectiveFlags: { ...this._node.effectiveFlags },
			subCommands: { ...this._node.subCommands },
			plugins: [...this._node.plugins],
			meta: { ...this._node.meta },
			args: this._node.args ? [...this._node.args] : undefined,
			...nodeOverrides,
		};
		(cloned as { _node: CommandNode })._node = newNode;
		(cloned as { _inheritedFlags: FlagsDef })._inheritedFlags =
			this._inheritedFlags;
		return cloned;
	}

	/**
	 * Set metadata (description, usage, visibility) for this command.
	 *
	 * The command name is already set by the builder source (constructor,
	 * `.sub()`, or the child builder passed into `.command(name, cb)`), so
	 * only `description`, `usage`, and `hidden` can be provided here.
	 *
	 * Returns a new builder with updated metadata. The original builder
	 * is not mutated.
	 *
	 * @param meta - Metadata fields to set (description, usage, hidden)
	 * @returns A new `Crust` instance with updated metadata
	 */
	meta(meta: Omit<CommandMeta, "name">): Crust<Inherited, Local, A, Eff> {
		return this._clone({
			meta: { ...this._node.meta, ...meta },
		}) as unknown as Crust<Inherited, Local, A, Eff>;
	}

	/**
	 * Define local flags for this command.
	 *
	 * Returns a new builder with updated local flag types. The original
	 * builder is not mutated.
	 *
	 * NOTE: Compile-time inherited/local cross-collision checks are intentionally
	 * omitted here to reduce TypeScript type-check cost in large projects.
	 * Runtime collision checks still run during parsing and command-tree validation.
	 *
	 * @param defs - Flag definitions record
	 * @returns A new `Crust` instance with the given flags
	 * @throws {CrustError} `DEFINITION` if flag names/aliases violate constraints
	 */
	flags<const F extends FlagsDef>(
		defs: F & ValidateNoPrefixedFlags<ValidateFlagAliases<F>>,
	): Crust<Inherited, F, A, EffectiveFlags<Inherited, F>> {
		// Runtime validation
		validateNoPrefixFlags(defs);

		// Deep copy flag defs to decouple from caller
		const copiedFlags: FlagsDef = {};
		for (const [key, def] of Object.entries(defs)) {
			copiedFlags[key] = { ...def };
		}

		return this._clone({
			localFlags: copiedFlags,
			effectiveFlags: computeEffectiveFlags(this._inheritedFlags, copiedFlags),
		}) as unknown as Crust<Inherited, F, A, EffectiveFlags<Inherited, F>>;
	}

	/**
	 * Define positional arguments for this command.
	 *
	 * Returns a new builder with updated args types. The original
	 * builder is not mutated.
	 *
	 * @param defs - Ordered tuple of positional argument definitions
	 * @returns A new `Crust` instance with the given args
	 */
	args<const NewA extends ArgsDef>(
		defs: NewA & ValidateVariadicArgs<NewA>,
	): Crust<Inherited, Local, NewA, Eff> {
		// Deep copy arg defs to decouple from caller
		const copiedArgs = defs.map((def) => ({ ...def })) as unknown as ArgsDef;

		return this._clone({
			args: copiedArgs,
		}) as unknown as Crust<Inherited, Local, NewA, Eff>;
	}

	/**
	 * Set the main command handler.
	 *
	 * The handler receives a {@link CrustCommandContext} with `args` typed from
	 * `.args()` and `flags` typed as `EffectiveFlags<Inherited, Local>` (inherited
	 * flags merged with local flags).
	 *
	 * Returns a new builder with the handler stored. The original builder is
	 * not mutated.
	 *
	 * @param handler - The main command handler function
	 * @returns A new `Crust` instance with the handler registered
	 */
	run(
		handler: (
			ctx: NoInfer<CrustCommandContext<A, Eff>>,
		) => void | Promise<void>,
	): Crust<Inherited, Local, A, Eff> {
		return this._clone({
			run: handler as (ctx: unknown) => void | Promise<void>,
		}) as unknown as Crust<Inherited, Local, A, Eff>;
	}

	/**
	 * Set the pre-run lifecycle hook.
	 *
	 * Called before `run()` — useful for initialization and setup.
	 * Receives the same {@link CrustCommandContext} as `run()`.
	 *
	 * @param handler - The pre-run handler function
	 * @returns A new `Crust` instance with the preRun handler registered
	 */
	preRun(
		handler: (
			ctx: NoInfer<CrustCommandContext<A, Eff>>,
		) => void | Promise<void>,
	): Crust<Inherited, Local, A, Eff> {
		return this._clone({
			preRun: handler as (ctx: unknown) => void | Promise<void>,
		}) as unknown as Crust<Inherited, Local, A, Eff>;
	}

	/**
	 * Set the post-run lifecycle hook.
	 *
	 * Called after `run()` (even if it throws) — useful for teardown and cleanup.
	 * Receives the same {@link CrustCommandContext} as `run()`.
	 *
	 * @param handler - The post-run handler function
	 * @returns A new `Crust` instance with the postRun handler registered
	 */
	postRun(
		handler: (
			ctx: NoInfer<CrustCommandContext<A, Eff>>,
		) => void | Promise<void>,
	): Crust<Inherited, Local, A, Eff> {
		return this._clone({
			postRun: handler as (ctx: unknown) => void | Promise<void>,
		}) as unknown as Crust<Inherited, Local, A, Eff>;
	}

	/**
	 * Register a plugin on this command.
	 *
	 * Plugins are collected during `.execute()` and their `setup()` hooks
	 * receive `SetupContext` and `SetupActions`. Middleware hooks run in
	 * registration order.
	 *
	 * Returns a new builder with the plugin appended. The original builder
	 * is not mutated.
	 *
	 * @param plugin - The plugin to register
	 * @returns A new `Crust` instance with the plugin registered
	 */
	use(plugin: CrustPlugin): Crust<Inherited, Local, A, Eff> {
		return this._clone({
			plugins: [...this._node.plugins, plugin],
		}) as unknown as Crust<Inherited, Local, A, Eff>;
	}

	/**
	 * Create a subcommand builder pre-typed with this command's inheritable flags.
	 *
	 * This is the factory method for the file-splitting pattern. The returned
	 * builder carries this command's effective flags (filtered for `inherit: true`)
	 * as its `Inherited` generic, enabling full type inference in split files
	 * without needing `Crust<any, any, any>`.
	 *
	 * Register the resulting builder with `.command(builder)` on the parent.
	 *
	 * @param name - Subcommand name (must be non-empty)
	 * @returns A new `Crust` builder pre-typed with inherited flags
	 * @throws {CrustError} `DEFINITION` if name is empty or whitespace-only
	 *
	 * @example
	 * ```ts
	 * // shared.ts
	 * export const app = new Crust("my-cli")
	 *   .flags({ verbose: { type: "boolean", inherit: true } });
	 *
	 * // commands/deploy.ts
	 * export const deployCmd = app.sub("deploy")
	 *   .flags({ env: { type: "string", required: true } })
	 *   .run(({ flags }) => {
	 *     flags.verbose; // boolean | undefined  — typed!
	 *     flags.env;     // string               — typed!
	 *   });
	 *
	 * // cli.ts
	 * app.command(deployCmd).execute();
	 * ```
	 */
	sub<N extends string>(
		name: N,
		// biome-ignore lint/complexity/noBannedTypes: empty initial state for child builder's Local generic
	): Crust<Eff, {}, [], EffectiveFlags<Eff, {}>> {
		if (!name.trim()) {
			throw new CrustError(
				"DEFINITION",
				"Subcommand name must be a non-empty string",
			);
		}

		const parentEffective = computeEffectiveFlags(
			this._inheritedFlags,
			this._node.localFlags,
		);

		return Crust._createChild<Eff>(name, parentEffective);
	}

	/**
	 * Register a named subcommand via inline callback.
	 *
	 * The callback receives a fresh `Crust` builder pre-typed with this
	 * command's effective inheritable flags, enabling TypeScript contextual
	 * typing to flow inherited flag types into subcommand definitions.
	 *
	 * @param name - Subcommand name (must be non-empty, unique among siblings)
	 * @param cb - Callback that receives a child builder and returns the configured builder
	 * @returns A new `Crust` instance with the subcommand registered
	 * @throws {CrustError} `DEFINITION` if name is empty or already registered
	 */
	command<N extends string>(
		name: N,
		cb: (
			// biome-ignore lint/complexity/noBannedTypes: empty initial state for child builder's Local generic
			cmd: Crust<Eff, {}, [], EffectiveFlags<Eff, {}>>,
		) => Crust<
			// biome-ignore lint/suspicious/noExplicitAny: needed for type-erased child builder return
			any,
			// biome-ignore lint/suspicious/noExplicitAny: needed for type-erased child builder return
			any,
			// biome-ignore lint/suspicious/noExplicitAny: needed for type-erased child builder return
			any
		>,
	): Crust<Inherited, Local, A, Eff>;

	/**
	 * Register a pre-built subcommand builder.
	 *
	 * The builder's name (from its constructor or `.sub()`) is used as the
	 * subcommand name. Builders created with `.sub()` inherit the parent's
	 * `inherit: true` flags; standalone `new Crust(name)` builders remain
	 * isolated. This is the complement to `.sub()` for the file-splitting
	 * pattern.
	 *
	 * @param builder - A pre-configured `Crust` builder instance
	 * @returns A new `Crust` instance with the subcommand registered
	 * @throws {CrustError} `DEFINITION` if builder name is empty or already registered
	 */
	command(
		// biome-ignore lint/suspicious/noExplicitAny: accepts any Crust builder instance
		builder: Crust<any, any, any>,
	): Crust<Inherited, Local, A, Eff>;

	// Implementation
	command(
		// biome-ignore lint/suspicious/noExplicitAny: union of overload parameter types
		nameOrBuilder: string | Crust<any, any, any>,
		// biome-ignore lint/suspicious/noExplicitAny: callback parameter from first overload
		cb?: (cmd: Crust<any, any, any>) => Crust<any, any, any>,
	): Crust<Inherited, Local, A, Eff> {
		if (typeof nameOrBuilder === "string") {
			// ── Inline callback path ──────────────────────────────────────────
			const name = nameOrBuilder;

			if (!cb) {
				throw new CrustError(
					"DEFINITION",
					"command(name, cb) requires a callback",
				);
			}

			// Validate name
			if (!name.trim()) {
				throw new CrustError(
					"DEFINITION",
					"Subcommand name must be a non-empty string",
				);
			}

			// Check for duplicate subcommand
			if (this._node.subCommands[name]) {
				throw new CrustError(
					"DEFINITION",
					`Subcommand "${name}" is already registered`,
				);
			}

			// Compute the effective flags for this node (inherited + local merged)
			const parentEffective = computeEffectiveFlags(
				this._inheritedFlags,
				this._node.localFlags,
			);

			// Create a child builder pre-typed with the parent's effective flags
			const childBuilder = Crust._createChild<Eff>(name, parentEffective);

			// Pass the child builder to the callback to let the user configure it
			const configuredChild = cb(childBuilder);

			// Extract the internal node from the configured child and register it
			// Clone the node to avoid mutating the original builder's _node
			const childNode = {
				...configuredChild._node,
				effectiveFlags: computeEffectiveFlags(
					configuredChild._inheritedFlags,
					configuredChild._node.localFlags,
				),
			};

			return this._clone({
				subCommands: {
					...this._node.subCommands,
					[name]: childNode,
				},
			}) as unknown as Crust<Inherited, Local, A, Eff>;
		}

		// ── Pre-built builder path ──────────────────────────────────────────
		const builder = nameOrBuilder;
		const name = builder._node.meta.name;

		if (!name.trim()) {
			throw new CrustError(
				"DEFINITION",
				"Subcommand name must be a non-empty string",
			);
		}

		if (this._node.subCommands[name]) {
			throw new CrustError(
				"DEFINITION",
				`Subcommand "${name}" is already registered`,
			);
		}

		// Clone the node to avoid mutating the original builder's _node
		const childNode = {
			...builder._node,
			effectiveFlags: computeEffectiveFlags(
				builder._inheritedFlags,
				builder._node.localFlags,
			),
		};

		return this._clone({
			subCommands: {
				...this._node.subCommands,
				[name]: childNode,
			},
		}) as unknown as Crust<Inherited, Local, A, Eff>;
	}

	/**
	 * Parse `process.argv`, resolve subcommands, run plugins and middleware,
	 * and execute the matched command handler.
	 *
	 * This is the entry point for CLI execution — call it on the root builder.
	 *
	 * @param options - Optional overrides (e.g. custom `argv` for testing)
	 * @returns A promise that resolves when execution completes
	 */
	async execute(options?: { argv?: string[] }): Promise<void> {
		const argv = options?.argv ?? process.argv.slice(2);
		const rootNode = this._node;

		// ── Step 1: Collect all plugins from the tree ──────────────────────
		const allPlugins = collectPlugins(rootNode);

		// ── Step 2: Run plugin setup() hooks ───────────────────────────────
		const warnings: string[] = [];
		const state = createPluginState();
		const setupContext: SetupContext = {
			argv: [...argv] as readonly string[],
			rootCommand: rootNode,
			state,
		};
		const actions = createSetupActions(warnings);

		try {
			await runSetupHooks(allPlugins, setupContext, actions);
		} catch (error) {
			if (isPromptCancelledError(error)) {
				process.exitCode = EXIT_CODE_CANCELLED;
				return;
			}
			if (error instanceof CrustError) {
				console.error(`Error: ${error.message}`);
				process.exitCode = 1;
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			console.error(`Error: ${message}`);
			process.exitCode = 1;
			return;
		}

		// ── Step 3: Freeze the command tree ────────────────────────────────
		freezeTree(rootNode);

		// ── Step 4: Build-time validation mode ─────────────────────────────
		if (process.env[VALIDATION_MODE_ENV] === "1") {
			const result = (async () => {
				try {
					const { validateCommandTree } = await import("./validation.ts");
					validateCommandTree(rootNode);
					for (const warning of warnings) {
						console.warn(`Warning: ${warning}`);
					}
					return { ok: true } as const;
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error(message);
					process.exitCode = 1;
					return { ok: false, error } as const;
				}
			})();

			// Store for in-process consumers (tests)
			(globalThis as Record<string, unknown>)[VALIDATION_RESULT_GLOBAL_KEY] =
				result;
			await result;

			// Force-exit the subprocess
			return process.exit(process.exitCode ?? 0);
		}

		// Surface plugin warnings
		for (const warning of warnings) {
			console.warn(`Warning: ${warning}`);
		}

		// ── Steps 5–8: Resolve, parse, middleware, execute ─────────────────
		const middlewareContext: MiddlewareContext = {
			argv: [...argv] as readonly string[],
			rootCommand: rootNode,
			state,
			route: null,
			input: null,
		};

		try {
			let resolvedNode: CommandNode;
			let parsed: ReturnType<typeof parseArgs>;

			try {
				// Step 5: Resolve subcommand
				const resolved = resolveCommand(rootNode, [...argv]);
				middlewareContext.route = resolved;

				// Step 6: Parse remaining argv
				// Safe cast: rootNode is always CommandNode, so all resolved descendants are too
				resolvedNode = resolved.command as CommandNode;
				parsed = parseArgs(resolvedNode, resolved.argv);
				middlewareContext.input = parsed;
			} catch (error) {
				// Route/parse errors pass through middleware before surfacing
				await runMiddlewareChain(allPlugins, middlewareContext, async () => {
					throw error;
				});
				return;
			}

			// Step 7: Run middleware chain → Step 8: lifecycle hooks
			await runMiddlewareChain(allPlugins, middlewareContext, async () => {
				validateParsed(resolvedNode, parsed);

				if (!resolvedNode.run) return;

				const context: CrustCommandContext = {
					args: parsed.args,
					flags: parsed.flags,
					rawArgs: parsed.rawArgs,
					command: resolvedNode,
				};

				let runError: unknown;
				try {
					// preRun
					if (resolvedNode.preRun) {
						await resolvedNode.preRun(context);
					}

					// run
					await resolvedNode.run(context);
				} catch (error) {
					runError = error;
				}

				// postRun always runs (even if run/preRun threw)
				if (resolvedNode.postRun) {
					try {
						await resolvedNode.postRun(context);
					} catch (postRunError) {
						// If run already threw, preserve the original error and log postRun error
						if (!runError) {
							runError = postRunError;
						} else {
							console.error(
								`Error in postRun: ${postRunError instanceof Error ? postRunError.message : String(postRunError)}`,
							);
						}
					}
				}

				// Re-throw the original error if any
				if (runError) {
					throw runError;
				}
			});
		} catch (error) {
			// Step 9: Error handling — wrap and surface
			if (isPromptCancelledError(error)) {
				process.exitCode = EXIT_CODE_CANCELLED;
				return;
			}
			if (error instanceof CrustError) {
				console.error(`Error: ${error.message}`);
				process.exitCode = 1;
				return;
			}
			if (error instanceof Error) {
				const wrapped = new CrustError("EXECUTION", error.message).withCause(
					error,
				);
				console.error(`Error: ${wrapped.message}`);
				process.exitCode = 1;
				return;
			}
			console.error(`Error: ${String(error)}`);
			process.exitCode = 1;
		}
	}
}
