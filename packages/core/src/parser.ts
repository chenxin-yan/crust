import {
	parseArgs as nodeParseArgs,
	type ParseArgsOptionDescriptor,
} from "node:util";
import { CrustError } from "./errors.ts";
import type {
	ArgDef,
	ArgsDef,
	Command,
	FlagDef,
	FlagsDef,
	InferFlags,
	ParsedResult,
	TypeConstructor,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Internal types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Union of all possible value shapes that `util.parseArgs` can produce for a
 * single option when the config is constructed dynamically at runtime.
 * Not exported by `@types/node`, so we define it here.
 */
type ParsedFlagValue = string | boolean | (string | boolean)[] | undefined;

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the options config for `util.parseArgs` from Crust's flag definitions.
 * Also returns a reverse alias→name mapping for resolving parsed results.
 */
function buildParseArgsOptionDescriptor(flagsDef: FlagsDef | undefined) {
	const options: Record<string, ParseArgsOptionDescriptor> = {};
	const aliasToName: Record<string, string> = {};

	if (!flagsDef) return { options, aliasToName };

	// Runtime alias collision check — mirrors the compile-time
	// CheckFlagAliasCollisions<F> type (which catches both alias→flag-name
	// and alias→alias collisions). Kept as defense-in-depth against type
	// erasure (dynamic construction, `as any` casts, widened generics).
	const aliasRegistry = new Map<string, string>();
	for (const name of Object.keys(flagsDef)) {
		aliasRegistry.set(name, name);
	}

	for (const [name, def] of Object.entries(flagsDef)) {
		// Map Crust types to util.parseArgs types
		// util.parseArgs only supports "string" and "boolean"
		// Number types are parsed as "string" then coerced
		const parseType = def.type === Boolean ? "boolean" : "string";

		const opt: ParseArgsOptionDescriptor = { type: parseType };

		// Handle multiple flag
		if (def.multiple) {
			opt.multiple = true;
		}

		// Handle aliases
		if (def.alias) {
			const aliases = Array.isArray(def.alias) ? def.alias : [def.alias];
			for (const alias of aliases) {
				// Check for collision
				const existing = aliasRegistry.get(alias);
				if (existing) {
					throw new CrustError(
						"DEFINITION",
						`Alias collision: "-${alias}" is used by both "--${existing}" and "--${name}"`,
					);
				}
				aliasRegistry.set(alias, name);
				aliasToName[alias] = name;

				// util.parseArgs only supports a single short alias (1 char)
				if (alias.length === 1 && !opt.short) {
					opt.short = alias;
				} else {
					// Long aliases and additional short aliases: register as separate option entries
					const aliasOpt: ParseArgsOptionDescriptor = { type: parseType };
					if (def.multiple) {
						aliasOpt.multiple = true;
					}
					options[alias] = aliasOpt;
				}
			}
		}

		options[name] = opt;
	}

	return { options, aliasToName };
}

/**
 * Coerce a string value to the expected type based on the constructor.
 */
function coerceValue(value: string, type: TypeConstructor, label: string) {
	if (type === Number) {
		const num = Number(value);
		if (Number.isNaN(num)) {
			throw new CrustError(
				"PARSE",
				`Expected number for ${label}, got "${value}"`,
			);
		}
		return num;
	}
	if (type === Boolean) {
		// util.parseArgs handles boolean flags natively, but in case we receive a string
		return value === "true" || value === "1";
	}
	return value;
}

/**
 * Apply default value or throw if a required definition has no value.
 * Shared fallback logic for both flags and positional args.
 */
function applyDefaultOrThrow(
	def: { default?: unknown; required?: boolean },
	label: string,
) {
	if (def.default !== undefined) return def.default;
	if (def.required === true) {
		throw new CrustError("VALIDATION", `Missing required ${label}`);
	}
	return undefined;
}

/**
 * Coerce a single flag's parsed value to its target type.
 */
function coerceFlagValue(
	name: string,
	def: FlagDef,
	parsedValue: string | boolean | (string | boolean)[],
): unknown {
	const label = `--${name}`;

	if (def.multiple && Array.isArray(parsedValue)) {
		return def.type === Boolean
			? parsedValue.map((v) => (typeof v === "boolean" ? v : Boolean(v)))
			: (parsedValue as string[]).map((v) => coerceValue(v, def.type, label));
	}

	if (def.type === Boolean) {
		return typeof parsedValue === "boolean"
			? parsedValue
			: Boolean(parsedValue);
	}

	if (typeof parsedValue === "string") {
		return coerceValue(parsedValue, def.type, label);
	}

	// Boolean `true` for a non-boolean flag shouldn't normally happen with
	// strict parsing, but handle gracefully by falling back to the default.
	if (parsedValue === true) {
		return def.default ?? undefined;
	}

	return parsedValue;
}

/**
 * Resolve aliases in raw parsed values to their canonical flag names,
 * merging arrays for `multiple` flags that are provided via mixed aliases.
 */
function resolveAliases(
	parsedValues: Record<string, unknown>,
	aliasToName: Record<string, string>,
	flagsDef: FlagsDef,
): Record<string, ParsedFlagValue> {
	const canonical: Record<string, ParsedFlagValue> = {};

	for (const key in parsedValues) {
		const canonicalName = aliasToName[key] ?? key;
		if (!(canonicalName in flagsDef)) continue;

		const value = parsedValues[key];
		const existing = canonical[canonicalName];
		if (
			existing !== undefined &&
			Array.isArray(existing) &&
			Array.isArray(value)
		) {
			existing.push(...value);
		} else {
			canonical[canonicalName] = value as ParsedFlagValue;
		}
	}

	return canonical;
}

/**
 * Resolve all flag definitions against the canonical parsed values.
 * Handles coercion, defaults, and required validation.
 */
function resolveFlags(
	flagsDef: FlagsDef | undefined,
	parsedValues: Record<string, unknown>,
	aliasToName: Record<string, string>,
): Record<string, unknown> {
	if (!flagsDef) return {};

	const canonical = resolveAliases(parsedValues, aliasToName, flagsDef);
	const resolved: Record<string, unknown> = {};

	for (const [name, def] of Object.entries(flagsDef)) {
		const parsedValue = canonical[name];

		if (parsedValue !== undefined) {
			resolved[name] = coerceFlagValue(name, def, parsedValue);
			continue;
		}

		resolved[name] = def.default ?? undefined;
	}

	return resolved;
}

/**
 * Validate required flags against already-resolved flag values.
 */
export function validateRequiredFlags(
	flagsDef: FlagsDef | undefined,
	resolvedFlags: Record<string, unknown>,
): void {
	if (!flagsDef) return;

	for (const [name, def] of Object.entries(flagsDef)) {
		if (def.required === true && def.default === undefined) {
			if (resolvedFlags[name] === undefined) {
				throw new CrustError("VALIDATION", `Missing required flag "--${name}"`);
			}
		}
	}
}

/**
 * Resolve positional argument definitions against the parsed positional tokens.
 * Handles variadic args, coercion, defaults, and required validation.
 */
function resolveArgs(
	argsDef: ArgsDef | undefined,
	positionals: string[],
): Record<string, unknown> {
	if (!argsDef) return {};

	const resolved: Record<string, unknown> = {};
	let index = 0;

	for (const def of argsDef) {
		const { name } = def as ArgDef;
		const label = `argument "<${name}>"`;

		if (def.variadic) {
			const remaining = positionals.slice(index);
			if (def.required === true && remaining.length === 0) {
				throw new CrustError("VALIDATION", `Missing required ${label}`);
			}
			resolved[name] =
				def.type === Number
					? remaining.map((v) => coerceValue(v, Number, `<${name}>`))
					: remaining;
			index = positionals.length;
		} else if (index < positionals.length) {
			resolved[name] = coerceValue(
				positionals[index] as string,
				def.type,
				`<${name}>`,
			);
			index++;
		} else {
			resolved[name] = applyDefaultOrThrow(def, label);
		}
	}

	return resolved;
}

// ────────────────────────────────────────────────────────────────────────────
// parseArgs — Main parsing function
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse argv against a command's arg and flag definitions.
 *
 * Wraps Node's `util.parseArgs` with Crust's enhanced semantics:
 * positional arg mapping, type coercion, alias expansion, default values,
 * required validation, variadic args, and strict mode.
 *
 * @param command - The command whose arg/flag definitions drive the parsing
 * @param argv - The argv array to parse (typically `process.argv.slice(2)`)
 * @returns Parsed args, flags, and rawArgs (everything after `--`)
 * @throws {CrustError} On unknown flags, missing required args/flags, type coercion failure, or alias collisions
 */
export function parseArgs<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
>(command: Command<A, F>, argv: string[]) {
	const argsDef = command.args as ArgsDef | undefined;
	const flagsDef = command.flags as FlagsDef | undefined;

	// Build util.parseArgs config from flag definitions
	const { options, aliasToName } = buildParseArgsOptionDescriptor(flagsDef);

	// Call util.parseArgs with strict: true to catch unknown flags
	let parsed: ReturnType<typeof nodeParseArgs>;

	try {
		parsed = nodeParseArgs({
			args: argv,
			options,
			strict: true,
			allowPositionals: true,
			allowNegative: true,
			tokens: true,
		});
	} catch (error) {
		if (error instanceof Error) {
			// Rewrite util.parseArgs error messages to be more user-friendly
			const unknownMatch = error.message.match(/Unknown option '(.+?)'/);
			if (unknownMatch) {
				throw new CrustError("PARSE", `Unknown flag "${unknownMatch[1]}"`);
			}
		}
		throw error;
	}

	// ── Extract positionals and rawArgs ───
	const rawArgs: string[] = [];
	const preSeparatorPositionals: string[] = [];

	if (parsed.tokens) {
		let afterSeparator = false;
		for (const token of parsed.tokens) {
			if (token.kind === "option-terminator") {
				afterSeparator = true;
				continue;
			}
			if (token.kind === "positional") {
				(afterSeparator ? rawArgs : preSeparatorPositionals).push(
					token.value ?? "",
				);
			}
		}
	} else {
		preSeparatorPositionals.push(...parsed.positionals);
	}

	// ── Resolve flags and args ─────────────────────────────────────────
	const resolvedFlags = resolveFlags(flagsDef, parsed.values, aliasToName);
	validateRequiredFlags(flagsDef, resolvedFlags);
	const resolvedArgs = resolveArgs(argsDef, preSeparatorPositionals);

	// The runtime logic correctly builds args/flags matching InferArgs<A> and
	// InferFlags<F>, but TypeScript can't verify this statically since values
	// are assembled dynamically from definitions. The assertion is safe here.
	return {
		args: resolvedArgs,
		flags: resolvedFlags,
		rawArgs,
	} as ParsedResult<A, F>;
}

/**
 * Parse and remove known global flags from argv.
 *
 * Unknown flags are preserved for command-level parsing.
 *
 * This function intentionally does NOT enforce required global flags.
 * Use {@link validateRequiredFlags} later on the execution path.
 */
export function parseGlobalFlags<F extends FlagsDef = FlagsDef>(
	flagsDef: F | undefined,
	argv: string[],
): { flags: InferFlags<F>; argv: string[] } {
	if (!flagsDef || Object.keys(flagsDef).length === 0) {
		return {
			flags: {} as InferFlags<F>,
			argv: [...argv],
		};
	}

	const { options, aliasToName } = buildParseArgsOptionDescriptor(flagsDef);
	const parsed = nodeParseArgs({
		args: argv,
		options,
		strict: false,
		allowPositionals: true,
		allowNegative: true,
		tokens: true,
	});

	const stripIndexes = new Set<number>();
	if (parsed.tokens) {
		for (const token of parsed.tokens) {
			if (token.kind !== "option") continue;

			const option = token;
			const canonicalName = aliasToName[option.name] ?? option.name;
			if (!(canonicalName in flagsDef)) continue;

			stripIndexes.add(option.index);

			if (option.value !== undefined && option.inlineValue === false) {
				stripIndexes.add(option.index + 1);
			}
		}
	}

	const remainingArgv = argv.filter((_, index) => !stripIndexes.has(index));
	const resolvedFlags = resolveFlags(flagsDef, parsed.values, aliasToName);

	return {
		flags: resolvedFlags as InferFlags<F>,
		argv: remainingArgv,
	};
}
