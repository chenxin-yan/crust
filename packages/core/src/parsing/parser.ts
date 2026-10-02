import { parseArgs as nodeParseArgs, type ParseArgsOptionDescriptor } from "node:util";
import { isPromise } from "node:util/types";

import { coerceBooleanString, tryCoerceNumber } from "@crustjs/utils/primitive";

import type { CommandNode } from "../command/node.ts";
import { CrustError } from "../errors.ts";
import type {
	ArgDef,
	ArgsDef,
	FlagDef,
	FlagsDef,
	InferFlags,
	ParseResult,
	ParsedArgValue,
	ParsedFlagValue,
	RawParsedArgs,
	RawParsedFlags,
	RunInputPayload,
	RunInputValue,
	ValueType,
} from "../types.ts";
import { coerceJson, coercePath, coerceUrl } from "./coercers.ts";
import { applySchemas } from "./schema.ts";
import { normalizeFlag, type FlagSpelling } from "./spellings.ts";

/** Environment variables consulted by `FlagDef.env`; `process.env` on the terminal path. */
export type FlagEnvironment = Readonly<Record<string, string | undefined>>;

// ────────────────────────────────────────────────────────────────────────────
// Internal types
// ────────────────────────────────────────────────────────────────────────────

/** Values bound from strict Node tokens, tagged before definition/value correlation erases. */
type ArgvFlagValue =
	| { readonly kind: "boolean"; value: boolean | boolean[] }
	| { readonly kind: "string"; value: string | string[] };

/** Element type of `parseArgs(...).tokens` — not exported by `@types/node`. */
type ParseArgsToken = NonNullable<ReturnType<typeof nodeParseArgs>["tokens"]>[number];

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the options config for `util.parseArgs` from the shared spelling table.
 */
function buildParseArgsOptionDescriptor(spellings: ReadonlyMap<string, FlagSpelling>) {
	const options: Record<string, ParseArgsOptionDescriptor> = {};

	for (const [spelling, entry] of spellings) {
		// The canonical descriptor already carries `short`; a short entry has no descriptor of its own.
		if (entry.kind === "short") continue;

		const descriptor: ParseArgsOptionDescriptor = {
			type: entry.def.type === "boolean" ? "boolean" : "string",
		};
		if (entry.def.multiple) descriptor.multiple = true;

		if (entry.kind === "canonical" && entry.def.short) descriptor.short = entry.def.short;
		options[spelling] = descriptor;
	}

	return options;
}

/**
 * Coerce a string value to the expected type based on the type literal.
 */
function coerceValue(value: string, type: ValueType, label: string) {
	if (type === "number") {
		const num = tryCoerceNumber(value);
		if (num === undefined) {
			throw new CrustError("PARSE", `Expected number for ${label}, got "${value}"`);
		}
		return num;
	}
	if (type === "boolean") {
		// Positional booleans arrive as text; option booleans are already native values.
		return coerceBooleanString(value);
	}
	if (type === "url") return coerceUrl(value, label);
	if (type === "path") return coercePath(value, label);
	if (type === "json") return coerceJson(value, label);
	return value;
}

/**
 * Validate a raw argv string against a flag/arg `choices` list. Throws
 * `CrustError("PARSE", …)` when the value is not in the allowed set.
 *
 * Runs *before* any `parse` transform so the user-facing comparison is on
 * the raw token, not the post-`parse` value.
 */
function validateChoice(raw: string, choices: readonly string[], label: string): void {
	if (!choices.includes(raw)) {
		throw new CrustError(
			"PARSE",
			`Invalid value "${raw}" for ${label}. Expected one of: ${choices.join(", ")}`,
		);
	}
}

/** Invoke a user `parse` function on a raw token, wrapping errors. */
function invokeParse<ParseOutput>(
	parse: (raw: string) => ParseOutput,
	raw: string,
	label: string,
	index?: number,
): ParseOutput {
	const location = index === undefined ? label : `${label} element [${index}]`;
	let result: ParseOutput;
	try {
		result = parse(raw);
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		throw new CrustError("PARSE", `Failed to parse ${location}: ${reason}`).withCause(err);
	}
	if (isPromise(result)) {
		result.catch(() => {});
		throw new CrustError("PARSE", `Failed to parse ${location}: parse must be synchronous`);
	}
	return result;
}

/**
 * Resolve a flag/arg default to its runtime value, mirroring the argv-side
 * coercion pipeline so omitted-flag behavior matches user-supplied behavior:
 *
 *   raw default → parse | coerce → result
 *
 * Without this, `{ type: "path", default: "./dist" }` returns the raw
 * relative string while `--out ./dist` returns an absolute path.
 *
 * `parse` is preferred when present (matches the escape-hatch contract).
 * `type: "path"` defaults are coerced through `coercePath` because their
 * default field is a raw string (`PathArgDef`, `type: "path"` flags). `url`
 * and `json` defaults are already in their resolved form (`URL` / `unknown`)
 * per the variant interfaces, so they pass through unchanged.
 */
function resolveDefault(def: ArgDef | FlagDef, label: string) {
	const { default: defaultValue, parse } = def;
	if (defaultValue === undefined) return undefined;

	if (parse) {
		if (Array.isArray(defaultValue)) {
			return defaultValue.map((v, i) => invokeParse(parse, String(v), label, i));
		}
		return invokeParse(parse, String(defaultValue), label);
	}

	if (def.type === "path") {
		if (Array.isArray(defaultValue)) {
			return defaultValue.map((v) => coercePath(String(v), label));
		}
		return coercePath(String(defaultValue), label);
	}

	// Occurrence output is mutable; retained defaults must not be rewritten by an action.
	return "multiple" in def && def.multiple && Array.isArray(defaultValue)
		? [...defaultValue]
		: defaultValue;
}

/**
 * Coerce one raw text token for an argument or flag:
 *   raw token → choices validation → parse transform (if set) → built-in coercion.
 * Schema-backed definitions receive the raw token unchanged.
 */
function coerceToken(
	def: ArgDef | FlagDef,
	raw: string,
	label: string,
	index?: number,
): ParsedArgValue {
	if (def.schema) return raw;
	if (def.choices) validateChoice(raw, def.choices, label);
	if (def.parse) return invokeParse(def.parse, raw, label, index);
	return coerceValue(raw, def.type, label);
}

/** Coerce a single flag's parsed value; multi-value flags coerce per element. */
function coerceFlagValue(name: string, def: FlagDef, parsed: ArgvFlagValue): ParsedFlagValue {
	if (parsed.kind === "boolean") return parsed.value;
	const label = `--${name}`;
	return Array.isArray(parsed.value)
		? parsed.value.map((value, i) => coerceToken(def, value, label, i))
		: coerceToken(def, parsed.value, label);
}

/**
 * Resolve parsed option tokens to canonical flag names, in argv order.
 *
 * Works from `parsed.tokens` rather than `parsed.values` because
 * `util.parseArgs` groups values by option key: with aliases, the last *key*
 * would win instead of the last *token* (`--verbose --no-loud --verbose`
 * must be `true`), and `multiple` flags spread across aliases would lose
 * their interleaved argv order.
 */
function resolveAliases(tokens: ParseArgsToken[], spellings: ReadonlyMap<string, FlagSpelling>) {
	const canonical: Record<string, ArgvFlagValue | undefined> = {};

	for (const token of tokens) {
		if (token.kind !== "option") continue;

		// Strict token names come from this command's descriptor, built from its retained spelling map.
		const { canonicalName, def } = spellings.get(token.name)!;
		const existing = canonical[canonicalName];
		if (def.type === "boolean") {
			const value = !token.rawName.startsWith("--no-");
			if (def.multiple && existing?.kind === "boolean" && Array.isArray(existing.value))
				existing.value.push(value);
			else canonical[canonicalName] = { kind: "boolean", value: def.multiple ? [value] : value };
		} else {
			// SAFETY: strict Node descriptors configure every non-boolean option as string-valued.
			const value = token.value as string;
			if (def.multiple && existing?.kind === "string" && Array.isArray(existing.value))
				existing.value.push(value);
			else canonical[canonicalName] = { kind: "string", value: def.multiple ? [value] : value };
		}
	}

	return canonical;
}

/** Split repeatable occurrences on the declared delimiter, dropping empty segments. */
function splitOccurrences(values: readonly string[], delimiter: string | undefined): string[] {
	if (delimiter === undefined) return [...values];
	return values.flatMap((value) => value.split(delimiter)).filter((value) => value !== "");
}

/**
 * Convert an environment value into the shape argv tokens produce, so the
 * shared coercion path (`choices`, `parse`, type conversion, schemas) runs
 * identically. Booleans use the positional spelling rule (`true`/`1`);
 * a `noNegate` flag rejects a false value like it rejects `--no-<name>`.
 */
function envFlagValue(name: string, def: FlagDef, raw: string): ArgvFlagValue | undefined {
	const occurrences = def.multiple ? splitOccurrences([raw], def.env?.delimiter) : [raw];
	if (def.multiple && occurrences.length === 0) return undefined;
	if (def.type !== "boolean") {
		return { kind: "string", value: def.multiple ? occurrences : raw };
	}
	const values = occurrences.map(coerceBooleanString);
	if ("noNegate" in def && def.noNegate && values.includes(false)) {
		throw new CrustError(
			"PARSE",
			`Flag "--${name}" does not support negation (from ${def.env?.name})`,
		);
	}
	return { kind: "boolean", value: def.multiple ? values : coerceBooleanString(raw) };
}

/**
 * Select each flag's source: argv > `env` > `default`.
 *
 * Source selection looks at explicit argv presence *before* delimiter
 * splitting, so `--tags ""` stays an argv value (zero occurrences, then
 * default/required rules) instead of letting a stale environment variable
 * override an explicit request. Environment lookup is argv-only; structured
 * `run()` input never reaches this function.
 */
function applyEnvAndDelimiter(
	flagsDef: FlagsDef,
	argvValues: Readonly<Record<string, ArgvFlagValue | undefined>>,
	env: FlagEnvironment,
) {
	const values: Record<string, ArgvFlagValue | undefined> = {};
	for (const [name, def] of Object.entries(flagsDef)) {
		// hasOwn on both records: a flag or variable named `constructor` must not
		// read Object.prototype as a supplied value.
		const argvValue = Object.hasOwn(argvValues, name) ? argvValues[name] : undefined;
		if (argvValue !== undefined) {
			if (
				def.delimiter !== undefined &&
				argvValue.kind === "string" &&
				Array.isArray(argvValue.value)
			) {
				const occurrences = splitOccurrences(argvValue.value, def.delimiter);
				// Zero occurrences after splitting follow the omission rules (default, required).
				values[name] =
					occurrences.length === 0 ? undefined : { kind: "string", value: occurrences };
			} else {
				values[name] = argvValue;
			}
			continue;
		}
		if (def.env === undefined || !Object.hasOwn(env, def.env.name)) continue;
		const raw = env[def.env.name];
		if (raw !== undefined) values[name] = envFlagValue(name, def, raw);
	}
	return values;
}

/**
 * Resolve all flag definitions against the canonical parsed values.
 * Handles coercion and default values; unknown names are the caller's concern.
 */
function resolveFlags<F extends FlagsDef, V>(
	flagsDef: F,
	values: Readonly<Record<string, V | undefined>>,
	coerce: (name: string, def: FlagDef, value: V) => ParsedFlagValue,
): RawParsedFlags<F> {
	const resolved: Record<string, ParsedFlagValue> = {};
	for (const [name, def] of Object.entries(flagsDef)) {
		const parsedValue = Object.hasOwn(values, name) ? values[name] : undefined;

		// An empty multiple array is zero occurrences, matching argv omission.
		const absent =
			parsedValue === undefined ||
			(def.multiple && Array.isArray(parsedValue) && parsedValue.length === 0);
		if (!absent) {
			resolved[name] = coerce(name, def, parsedValue);
			continue;
		}

		resolved[name] = resolveDefault(def, `--${name}`);
	}

	// SAFETY: the loop writes exactly every key from flagsDef; mapped generic keys cannot be correlated at runtime.
	return resolved as RawParsedFlags<F>;
}

/**
 * Validate required flags against already-resolved flag values.
 */
function validateRequiredFlags<F extends FlagsDef>(
	flagsDef: F,
	resolvedFlags: RawParsedFlags<F>,
): void {
	for (const [name, def] of Object.entries(flagsDef)) {
		if (def.required === true && def.default === undefined) {
			if (resolvedFlags[name] === undefined) {
				throw new CrustError("VALIDATION", `Missing required flag "--${name}"`);
			}
		}
	}
}

/**
 * Validate required args against already-resolved argument values.
 */
function validateRequiredArgs<A extends ArgsDef>(argsDef: A, resolvedArgs: RawParsedArgs<A>): void {
	for (const def of argsDef) {
		if (def.required !== true || def.default !== undefined) continue;
		// SAFETY: name comes from the same argument definitions that produced this mapped result.
		const value = resolvedArgs[def.name as keyof typeof resolvedArgs];
		const missing = def.variadic
			? !Array.isArray(value) || value.length === 0
			: value === undefined;
		if (missing) throw new CrustError("VALIDATION", `Missing required argument "<${def.name}>"`);
	}
}

/**
 * Resolve positional argument definitions against the parsed positional tokens.
 * Handles variadic args, coercion, and default values.
 *
 * Never throws for missing required values; {@link validateParsed} enforces
 * required constraints.
 */
function resolveArgs<A extends ArgsDef, V>(
	argsDef: A,
	positionals: readonly V[],
	coerce: (def: ArgDef, value: V, label: string, index?: number) => ParsedArgValue,
): { args: RawParsedArgs<A>; consumed: number } {
	const resolved: Record<string, ParsedArgValue> = {};
	let index = 0;

	for (const def of argsDef) {
		const { name } = def;
		const label = `<${name}>`;
		// Positional names include __proto__; always create an own data property.
		Object.defineProperty(resolved, name, {
			value: undefined,
			writable: true,
			enumerable: true,
			configurable: true,
		});

		if (def.variadic) {
			const remaining = positionals.slice(index);
			// Supplied values replace the scalar default; omission yields it as the only element.
			resolved[name] =
				remaining.length === 0 && def.default !== undefined
					? [resolveDefault(def, label)]
					: remaining.map((v, i) => coerce(def, v, label, i));
			index = positionals.length;
		} else if (index < positionals.length) {
			// SAFETY: the bounds check above proves this positional exists.
			resolved[name] = coerce(def, positionals[index] as V, label);
			index++;
		} else {
			resolved[name] = resolveDefault(def, label);
		}
	}

	// SAFETY: the loop writes exactly every declared argument name; mapped generic keys cannot be correlated at runtime.
	return { args: resolved as RawParsedArgs<A>, consumed: index };
}

/**
 * Enforce `noNegate` at parse time.
 *
 * `--no-<spelling>` works for the canonical name and every long alias
 * (an alias is a perfect synonym), but a boolean that
 * opted out via `noNegate` rejects every negated spelling. Without this
 * pre-scan, `util.parseArgs` (`allowNegative`) would silently accept it.
 */
function validateNoNegateUsage(argv: string[], spellings: ReadonlyMap<string, FlagSpelling>): void {
	for (const arg of argv) {
		if (arg === "--") return;
		if (!arg.startsWith("--no-")) continue;

		const assignmentIndex = arg.indexOf("=");
		const rawName =
			assignmentIndex === -1
				? arg.slice("--no-".length)
				: arg.slice("--no-".length, assignmentIndex);
		const spelling = spellings.get(rawName);
		if (!spelling || spelling.def.type !== "boolean" || spelling.negatable) continue;

		throw new CrustError(
			"PARSE",
			`Flag "--${spelling.canonicalName}" does not support negation ("--no-${rawName}")`,
		);
	}
}

function tokenizeArgv(command: CommandNode, argv: string[]) {
	const spellings = command.flagSpellings;
	const parseOptions = buildParseArgsOptionDescriptor(spellings);

	validateNoNegateUsage(argv, spellings);

	let parsed: ReturnType<typeof nodeParseArgs> & { tokens: ParseArgsToken[] };

	try {
		parsed = nodeParseArgs({
			args: argv,
			options: parseOptions,
			strict: true,
			allowPositionals: true,
			allowNegative: true,
			tokens: true,
		});
	} catch (error) {
		if (error instanceof Error) {
			const token = error.message.match(/Unknown option '(.+?)'/)?.[1];
			if (token !== undefined) {
				throw new CrustError("PARSE", `Unknown flag "${token}"`, {
					flag: token.replace(/^-+|=.*$/g, ""),
					reason: "unknown-flag",
				}).withCause(error);
			}
			if (
				"code" in error &&
				error.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" &&
				error.message.length > 0
			) {
				throw new CrustError("PARSE", error.message).withCause(error);
			}
		}
		throw new CrustError("PARSE", "Failed to parse command arguments").withCause(error);
	}

	const rawArgs: string[] = [];
	const preSeparatorPositionals: string[] = [];
	let afterSeparator = false;
	for (const token of parsed.tokens) {
		if (token.kind === "option-terminator") {
			afterSeparator = true;
			continue;
		}
		if (token.kind === "positional") {
			(afterSeparator ? rawArgs : preSeparatorPositionals).push(token.value);
		}
	}

	return {
		positionals: preSeparatorPositionals,
		flagValues: resolveAliases(parsed.tokens, spellings),
		rawArgs,
	};
}

// `Array.isArray` alone narrows a structured value to `any[]`.
function isOccurrenceArray(value: RunInputValue | undefined): value is readonly RunInputValue[] {
	return Array.isArray(value);
}

function validateStructuredValue(def: ArgDef | FlagDef, value: RunInputValue, label: string): void {
	const type = def.schema ? (def.type === "boolean" ? "boolean" : "string") : def.type;
	let valid: boolean;
	if (type === "url") {
		valid = value instanceof URL;
	} else if (type === "json") {
		// The dynamic payload permits URLs nested in occurrence arrays; JSON records stay typed.
		const pending: RunInputValue[] = [value];
		const seen = new Set<object>();
		valid = true;
		while (pending.length > 0) {
			const item = pending.pop();
			if (item instanceof URL) {
				valid = false;
				break;
			}
			if (isOccurrenceArray(item) && !seen.has(item)) {
				seen.add(item);
				pending.push(...item);
			}
		}
	} else {
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- structured binding checks the declared primitive kind at the invocation boundary.
		valid = typeof value === (type === "path" ? "string" : type);
	}
	if (!valid) throw new CrustError("PARSE", `Expected ${type} for ${label}`);
	if (value === false && "noNegate" in def && def.noNegate) {
		throw new CrustError("PARSE", `Flag "${label}" does not support negation`);
	}
}

/** Validate supplied structured values before applying transforms. */
function coerceStructuredValue(
	def: ArgDef | FlagDef,
	value: RunInputValue,
	label: string,
	index?: number,
): ParsedArgValue {
	validateStructuredValue(def, value, label);
	// Validated string and path values are text tokens; every other type arrives native.
	if (def.type !== "string" && def.type !== "path") return value;
	return coerceToken(def, String(value), label, index);
}

function coerceStructuredFlag(name: string, def: FlagDef, value: RunInputValue): ParsedFlagValue {
	const label = `--${name}`;
	// Only multiple flags interpret arrays as occurrences; scalar JSON can itself be an array.
	if (def.multiple) {
		if (!isOccurrenceArray(value)) {
			throw new CrustError("PARSE", `Expected an occurrence array for ${label}`);
		}
		return value.map((item, i) => coerceStructuredValue(def, item, label, i));
	}
	return coerceStructuredValue(def, value, label);
}

/** Both front doors share binding, defaults, and canonical flag validation. */
function bind<A extends ArgsDef, F extends FlagsDef, V, W>(
	command: CommandNode & { args: A; effectiveFlags: F },
	positionals: readonly V[],
	flagValues: Readonly<Record<string, W | undefined>>,
	coerceArg: (def: ArgDef, value: V, label: string, index?: number) => ParsedArgValue,
	coerceFlag: (name: string, def: FlagDef, value: W) => ParsedFlagValue,
) {
	const flags = resolveFlags(command.effectiveFlags, flagValues, coerceFlag);
	return { ...resolveArgs(command.args, positionals, coerceArg), flags };
}

// ────────────────────────────────────────────────────────────────────────────
// parseArgs — Main parsing function
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse argv against a command's arg/flag definitions.
 *
 * Wraps Node's `util.parseArgs` with Crust's enhanced semantics:
 * positional arg mapping, type coercion, alias expansion, default values,
 * variadic args, and strict mode.
 *
 * Never throws for missing required values. Use {@link validateParsed} to
 * enforce required constraints after extensions have had a chance to handle
 * an invocation (e.g. `--help`).
 *
 * @param command - The command whose arg/flag definitions drive the parsing
 * @param argv - The argv array to parse (typically `process.argv.slice(2)`)
 * @param env - Environment consulted for `FlagDef.env` fallbacks; pass `{}` to parse without one
 * @returns Parsed args, flags, excessArgs (positionals before `--` not consumed by a declared argument), and rawArgs (everything after `--`)
 * @throws {CrustError} On unknown flags or type coercion failure
 */
export function parseArgs<A extends ArgsDef = ArgsDef, F extends FlagsDef = FlagsDef>(
	command: CommandNode & { args: A; effectiveFlags: F },
	argv: string[],
	env: FlagEnvironment = process.env,
): ParseResult<A, F> {
	const { positionals, flagValues, rawArgs } = tokenizeArgv(command, argv);
	const { args, flags, consumed } = bind(
		command,
		positionals,
		applyEnvAndDelimiter(command.effectiveFlags, flagValues, env),
		coerceToken,
		coerceFlagValue,
	);
	return { args, flags, excessArgs: positionals.slice(consumed), rawArgs };
}

/**
 * Resolve flags from their `env` bindings alone, as {@link parseArgs} does for an
 * empty argv: `env.delimiter` splitting, `choices`, `parse`, built-in coercion,
 * defaults, requiredness, then Standard Schemas. Flags without `env` resolve
 * to their defaults.
 *
 * @param flags - Flag definitions keyed by result name; each `env.name` selects its variable
 * @param env - Raw variable text; only own properties are read
 * @throws {CrustError} `DEFINITION` for a definition `defineFlag` rejects (e.g. a
 *   `__proto__` key or a default outside `choices`); `PARSE` or `VALIDATION` on the first
 *   coercion or requiredness failure, or `VALIDATION` aggregating schema issues. Messages
 *   may quote raw values.
 */
export async function parseFlagValues<F extends FlagsDef>(
	flags: F,
	env: FlagEnvironment,
): Promise<InferFlags<F>> {
	// defineFlag's checks, run for the throw: a `__proto__` key would swap the result record's prototype.
	for (const [name, def] of Object.entries(flags)) normalizeFlag(name, def);
	const resolved = resolveFlags(flags, applyEnvAndDelimiter(flags, {}, env), coerceFlagValue);
	validateRequiredFlags(flags, resolved);
	const validated = await applySchemas(
		{ args: [], effectiveFlags: flags },
		{ args: {}, flags: resolved },
	);
	return validated.flags;
}

/** Bind typed input without producing argv; the path alone selects the command. */
export function parseStructured<A extends ArgsDef = ArgsDef, F extends FlagsDef = FlagsDef>(
	command: CommandNode & { args: A; effectiveFlags: F },
	input: RunInputPayload,
): ParseResult<A, F> {
	const { args: inputArgs, flags: inputFlags, raw } = input;
	const positionals: RunInputValue[] = [];
	let omittedArgument: string | undefined;
	for (const definition of command.args) {
		const value =
			inputArgs && Object.hasOwn(inputArgs, definition.name)
				? inputArgs[definition.name]
				: undefined;
		if (value === undefined) {
			omittedArgument = definition.name;
			continue;
		}
		// Only named records can supply a later positional while omitting an earlier one.
		if (omittedArgument !== undefined) {
			throw new CrustError(
				"PARSE",
				`Argument <${definition.name}> cannot be provided after omitted argument <${omittedArgument}>`,
				{
					argument: definition.name,
					reason: "positional-gap",
				},
			);
		}
		if (definition.variadic) {
			if (!isOccurrenceArray(value)) {
				throw new CrustError("PARSE", `Expected an occurrence array for <${definition.name}>`);
			}
			positionals.push(...value);
		} else {
			// A non-variadic JSON array is one positional value.
			positionals.push(value);
		}
	}
	// Only named records carry argument names to validate; argv has positional tokens.
	for (const name of Object.keys(inputArgs ?? {})) {
		if (
			!command.args.some((definition) => definition.name === name) &&
			inputArgs?.[name] !== undefined
		) {
			throw new CrustError("PARSE", `Unknown argument "${name}"`, {
				argument: name,
				reason: "unknown-argument",
			});
		}
	}
	// Validate supplied canonical names, including keys retired by same-ID replacement.
	for (const name of Object.keys(inputFlags ?? {})) {
		// Read known values only during binding, so own getters run once.
		// hasOwn prevents inherited Object.prototype keys becoming ghost flags.
		if (!Object.hasOwn(command.effectiveFlags, name) && inputFlags?.[name] !== undefined) {
			throw new CrustError("PARSE", `Unknown flag "--${name}"`, {
				flag: name,
				reason: "unknown-flag",
			});
		}
	}
	const { args, flags } = bind(
		command,
		positionals,
		inputFlags ?? {},
		coerceStructuredValue,
		coerceStructuredFlag,
	);
	return { args, flags, excessArgs: [], rawArgs: [...(raw ?? [])] };
}

/**
 * Validate a parse result against its command's required-value constraints.
 *
 * Separated from {@link parseArgs} so that middleware (e.g. `--help`) can
 * inspect the parse result before validation errors are surfaced.
 *
 * @param command - The command whose definitions drive the validation
 * @param parsed - The parse result from {@link parseArgs}
 * @throws {CrustError} On missing required args or flags
 */
export function validateParsed<A extends ArgsDef = ArgsDef, F extends FlagsDef = FlagsDef>(
	command: CommandNode & { args: A; effectiveFlags: F },
	parsed: ParseResult<A, F>,
): void {
	if (parsed.excessArgs.length > 0) {
		throw new CrustError(
			"VALIDATION",
			`Unexpected positional argument${parsed.excessArgs.length === 1 ? "" : "s"}: ${parsed.excessArgs.map((arg) => JSON.stringify(arg)).join(", ")}`,
		);
	}

	validateRequiredArgs(command.args, parsed.args);
	validateRequiredFlags(command.effectiveFlags, parsed.flags);
}
