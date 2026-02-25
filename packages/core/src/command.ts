import { CrustError } from "./errors.ts";
import type {
	ArgsDef,
	Command,
	CommandDef,
	FlagsDef,
	ValidateFlagAliases,
	ValidateNoPrefixedFlags,
	ValidateVariadicArgs,
} from "./types.ts";

/**
 * Define a CLI command with full type inference.
 *
 * The returned command object is frozen (immutable) and typed so that
 * `run()`, `preRun()`, and `postRun()` callbacks receive correctly-typed
 * `args` and `flags` based on the definitions provided.
 *
 * @param config - The command definition config object
 * @returns A frozen, readonly Command object
 * @throws {CrustError} `DEFINITION` if `meta.name` is missing or empty
 *
 * @example
 * ```ts
 * const cmd = defineCommand({
 *   meta: { name: "serve", description: "Start dev server" },
 *   args: [
 *     { name: "port", type: "number", description: "Port number", default: 3000 },
 *   ],
 *   flags: {
 *     verbose: { type: "boolean", description: "Enable verbose logging", alias: "v" },
 *   },
 *   run({ args, flags }) {
 *     // args.port is typed as number, flags.verbose is typed as boolean | undefined
 *     console.log(`Starting server on port ${args.port}`);
 *   },
 * });
 * ```
 */
export function defineCommand<
	const A extends ArgsDef = ArgsDef,
	const F extends FlagsDef = FlagsDef,
>(
	config: CommandDef<A, F> & {
		args?: ValidateVariadicArgs<A>;
		flags?: ValidateNoPrefixedFlags<ValidateFlagAliases<F>>;
	},
): Command<A, F> {
	// Validate required meta.name
	if (!config.meta.name.trim()) {
		throw new CrustError(
			"DEFINITION",
			"defineCommand: meta.name is required and must be a non-empty string",
		);
	}

	// Runtime guard: reject flag names and aliases starting with "no-"
	if (config.flags) {
		for (const [name, def] of Object.entries(config.flags)) {
			if (name.startsWith("no-")) {
				const base = name.slice(3);
				throw new CrustError(
					"DEFINITION",
					`Flag name "--${name}" must not start with "no-"; define "${base}" instead and use "--no-${base}" at runtime`,
				);
			}
			if (def.alias) {
				const aliases = Array.isArray(def.alias) ? def.alias : [def.alias];
				for (const alias of aliases) {
					if (alias.startsWith("no-")) {
						throw new CrustError(
							"DEFINITION",
							`Alias "--${alias}" on flag "--${name}" must not start with "no-"; the "no-" prefix is reserved for boolean negation`,
						);
					}
				}
			}
		}
	}

	// Deep copy data objects to decouple from the original config.
	// Functions (preRun, run, postRun) are kept as-is since they can't be cloned.
	// subCommands values are already frozen Command objects, so shallow copy is sufficient.
	const copy: Command<A, F> = {
		...config,
		meta: { ...config.meta },
		...(config.args && {
			args: config.args.map((def) => ({ ...def })) as unknown as A,
		}),
		flags: config.flags
			? (Object.fromEntries(
					Object.entries(config.flags).map(([k, v]) => [k, { ...v }]),
				) as unknown as F)
			: ({} as F),
		...(config.subCommands && {
			subCommands: { ...config.subCommands },
		}),
	};

	// Freeze and return as immutable Command
	return Object.freeze(copy) as Command<A, F>;
}
