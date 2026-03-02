import { CrustError } from "./errors.ts";
import { type CommandNode, createCommandNode } from "./node.ts";
import type {
	ArgsDef,
	CommandMeta,
	FlagsDef,
	ValidateFlagAliases,
	ValidateNoPrefixedFlags,
	ValidateVariadicArgs,
} from "./types.ts";

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
		if (def.alias) {
			const aliases = Array.isArray(def.alias) ? def.alias : [def.alias];
			for (const alias of aliases) {
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
// Crust — Chainable builder class
// ────────────────────────────────────────────────────────────────────────────

/**
 * Chainable builder for defining CLI commands with full type inference.
 *
 * Generic parameters:
 * - `Inherited` — flags inherited from a parent command (populated by `.command()`)
 * - `Local` — flags defined on this command via `.flags()`
 * - `A` — positional argument definitions
 *
 * @example
 * ```ts
 * const app = new Crust("my-cli")
 *   .flags({
 *     verbose: { type: "boolean", alias: "v", inherit: true },
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
> {
	/** @internal — Phantom property exposing generic parameters for type-level testing */
	declare readonly _types: {
		inherited: Inherited;
		local: Local;
		args: A;
	};

	/** @internal */
	readonly _node: CommandNode;

	/** @internal — The inherited flags record (runtime counterpart of Inherited generic) */
	readonly _inheritedFlags: FlagsDef;

	/**
	 * Create a new root or standalone command builder.
	 *
	 * @param meta - Either a string (command name) or a full `CommandMeta` object.
	 * @throws {CrustError} `DEFINITION` if name is empty or whitespace-only
	 */
	constructor(meta: string | CommandMeta) {
		const name = typeof meta === "string" ? meta : meta.name;
		if (!name.trim()) {
			throw new CrustError(
				"DEFINITION",
				"meta.name must be a non-empty string",
			);
		}
		this._node = createCommandNode(meta);
		this._inheritedFlags = {};
	}

	/**
	 * @internal — Create a child builder with pre-populated inherited flags.
	 * Used by `.command()` to propagate parent flags to the child.
	 */
	static _createChild<I extends FlagsDef>(
		meta: string | CommandMeta,
		inheritedFlags: FlagsDef,
	): Crust<I, FlagsDef, ArgsDef> {
		const instance = new Crust<I, FlagsDef, ArgsDef>(meta);
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
			...nodeOverrides,
		};
		(cloned as { _node: CommandNode })._node = newNode;
		(cloned as { _inheritedFlags: FlagsDef })._inheritedFlags =
			this._inheritedFlags;
		return cloned;
	}

	/**
	 * Define local flags for this command.
	 *
	 * Returns a new builder with updated local flag types. The original
	 * builder is not mutated.
	 *
	 * @param defs - Flag definitions record
	 * @returns A new `Crust` instance with the given flags
	 * @throws {CrustError} `DEFINITION` if flag names/aliases violate constraints
	 */
	flags<const F extends FlagsDef>(
		defs: F & ValidateNoPrefixedFlags<ValidateFlagAliases<F>>,
	): Crust<Inherited, F, A> {
		// Runtime validation
		validateNoPrefixFlags(defs);

		// Deep copy flag defs to decouple from caller
		const copiedFlags: FlagsDef = {};
		for (const [key, def] of Object.entries(defs)) {
			copiedFlags[key] = { ...def };
		}

		return this._clone({
			localFlags: copiedFlags,
			effectiveFlags: copiedFlags,
		}) as unknown as Crust<Inherited, F, A>;
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
	): Crust<Inherited, Local, NewA> {
		// Deep copy arg defs to decouple from caller
		const copiedArgs = defs.map((def) => ({ ...def })) as unknown as ArgsDef;

		return this._clone({
			args: copiedArgs,
		}) as unknown as Crust<Inherited, Local, NewA>;
	}
}
