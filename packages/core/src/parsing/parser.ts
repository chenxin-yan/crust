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
	ValueSource,
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

/**
 * Values bound from argv tokens, tagged before definition/value correlation erases.
 * `invalid` is an environment value already rejected; coercion rethrows it so it defers like the rest.
 */
type ArgvFlagValue =
	| { readonly kind: "boolean"; value: boolean | boolean[] }
	| { readonly kind: "string"; value: string | string[] }
	| { readonly kind: "invalid"; readonly error: CrustError };

/** Records a value error, keyed by its definition's label, instead of throwing it; see {@link parseArgs}. */
type DeferValueError = (error: CrustError, label: string) => void;

/** {@link ParseResult} plus the flag order, what the invocation supplied, and argv's value errors. */
export interface ArgvParseResult<
	A extends ArgsDef = ArgsDef,
	F extends FlagsDef = FlagsDef,
> extends ParseResult<A, F> {
	/**
	 * Canonical names of flags given a value, in the order the user gave them: argv by first
	 * occurrence, then environment values by name; structured input in key order.
	 * Extension flag handlers rank by it, so the first one on the command line wins.
	 */
	flagOrder: readonly string[];
	/** Positional arguments supplied by argv or typed `run()` input; later bound input cannot skip one. */
	suppliedArgs?: ReadonlySet<string>;
	/** `ExtensionContext.sources`; {@link bindStructuredInput} keeps the values argv gave. */
	sources: {
		readonly args: Readonly<Record<string, ValueSource>>;
		readonly flags: Readonly<Record<string, ValueSource>>;
		readonly raw: "argv" | "run" | "bound" | undefined;
	};
	/** Argv/env value errors by definition label, in binding order; {@link validateParsed} throws the first. */
	valueErrors?: ReadonlyMap<string, CrustError>;
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

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
	if (process.getBuiltinModule("node:util/types").isPromise(result)) {
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

/**
 * Run one definition's coercion. With `defer`, a `CrustError` is recorded and the
 * definition stays unset (not defaulted) so the invocation can still reach `preRun`.
 */
function coerceOrDefer<T>(
	coerce: () => T,
	defer: DeferValueError | undefined,
	label: string,
): T | undefined {
	if (!defer) return coerce();
	try {
		return coerce();
	} catch (error) {
		if (!(error instanceof CrustError)) throw error;
		defer(error, label);
		return undefined;
	}
}

/** Coerce a single flag's parsed value; multi-value flags coerce per element. */
function coerceFlagValue(name: string, def: FlagDef, parsed: ArgvFlagValue): ParsedFlagValue {
	if (parsed.kind === "invalid") throw parsed.error;
	if (parsed.kind === "boolean") return parsed.value;
	const label = `--${name}`;
	return Array.isArray(parsed.value)
		? parsed.value.map((value, i) => coerceToken(def, value, label, i))
		: coerceToken(def, parsed.value, label);
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
		return {
			kind: "invalid",
			error: new CrustError(
				"PARSE",
				`Flag "--${name}" does not support negation (from ${def.env?.name})`,
			),
		};
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
	defer?: DeferValueError,
	present?: Set<string>,
): RawParsedFlags<F> {
	const resolved: Record<string, ParsedFlagValue> = {};
	for (const [name, def] of Object.entries(flagsDef)) {
		const parsedValue = Object.hasOwn(values, name) ? values[name] : undefined;

		// An empty multiple array is zero occurrences, matching argv omission.
		const absent =
			parsedValue === undefined ||
			(def.multiple && Array.isArray(parsedValue) && parsedValue.length === 0);
		if (!absent) {
			present?.add(name);
			resolved[name] = coerceOrDefer(() => coerce(name, def, parsedValue), defer, `--${name}`);
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
	defer?: DeferValueError,
) {
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
					: coerceOrDefer(() => remaining.map((v, i) => coerce(def, v, label, i)), defer, label);
			index = positionals.length;
		} else if (index < positionals.length) {
			// SAFETY: the bounds check above proves this positional exists.
			resolved[name] = coerceOrDefer(
				() => coerce(def, positionals[index] as V, label),
				defer,
				label,
			);
			index++;
		} else {
			resolved[name] = resolveDefault(def, label);
		}
	}

	// SAFETY: the loop writes exactly every declared argument name; mapped generic keys cannot be correlated at runtime.
	return { args: resolved as RawParsedArgs<A>, consumed: index };
}

/** One flag occurrence read from an argv token. */
interface FlagOccurrence {
	readonly spelling: FlagSpelling;
	readonly value: string | boolean;
}

/**
 * A flag token resolved against a command's spelling table. `pending` is a
 * value-taking flag that ends the token, so it reads the next argv token.
 */
interface FlagToken {
	readonly occurrences: readonly FlagOccurrence[];
	readonly pending?: FlagSpelling;
}

function unknownFlag(token: string, flag: string): CrustError {
	return new CrustError("PARSE", `Unknown flag "${token}"`, { flag, reason: "unknown-flag" });
}

function unexpectedValue(flag: string): CrustError {
	return new CrustError("PARSE", `Flag "--${flag}" does not take a value`, {
		flag,
		reason: "unexpected-value",
	});
}

/**
 * Match one argv token against a command's spelling table: `--name`,
 * `--name=value`, `--no-<long spelling>` for negatable booleans, and short
 * clusters (`-fc 3`, `-ovalue`). Shared by the parser, which throws the
 * returned error, and the router, which stops at it.
 *
 * @returns `undefined` for a token that is not a flag (`-`, `--`, or no leading dash)
 */
export function matchFlagToken(
	spellings: ReadonlyMap<string, FlagSpelling>,
	token: string,
): FlagToken | CrustError | undefined {
	if (token.length < 2 || !token.startsWith("-") || token === "--") return undefined;

	if (token[1] !== "-") {
		const occurrences: FlagOccurrence[] = [];
		for (let index = 1; index < token.length;) {
			// A short is one code point; an astral one spans two UTF-16 units.
			// SAFETY: index < token.length.
			const short = String.fromCodePoint(token.codePointAt(index)!);
			index += short.length;
			const spelling = spellings.get(short);
			// A stray `-` would print as `--`, which reads as the separator; name the whole token instead.
			if (!spelling) return unknownFlag(short === "-" ? token : `-${short}`, short);
			if (spelling.def.type === "boolean") {
				occurrences.push({ spelling, value: true });
				continue;
			}
			// A value-taking short takes the rest of the cluster (`-ovalue`), else the next token.
			if (index === token.length) return { occurrences, pending: spelling };
			occurrences.push({ spelling, value: token.slice(index) });
			break;
		}
		return { occurrences };
	}

	// Spellings are non-empty and never contain "=", so `=` right after the dashes is part of the name.
	const eq = token.indexOf("=", 3);
	const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
	const value = eq === -1 ? undefined : token.slice(eq + 1);
	const spelling = spellings.get(name);
	if (spelling && spelling.kind !== "short") {
		if (spelling.def.type !== "boolean") {
			return value === undefined
				? { occurrences: [], pending: spelling }
				: { occurrences: [{ spelling, value }] };
		}
		if (value !== undefined) return unexpectedValue(spelling.canonicalName);
		return { occurrences: [{ spelling, value: true }] };
	}

	const base = name.startsWith("no-") ? spellings.get(name.slice(3)) : undefined;
	if (base && base.kind !== "short" && base.def.type === "boolean") {
		if (!base.negatable) {
			return new CrustError(
				"PARSE",
				`Flag "--${base.canonicalName}" does not support negation ("--${name}")`,
			);
		}
		if (value !== undefined) return unexpectedValue(base.canonicalName);
		return { occurrences: [{ spelling: base, value: false }] };
	}

	return unknownFlag(`--${name}`, name);
}

/** Record one occurrence under its canonical name; `multiple` keeps argv order across spellings. */
function addFlagValue(
	values: Record<string, ArgvFlagValue | undefined>,
	{ canonicalName, def }: FlagSpelling,
	value: string | boolean,
): void {
	const existing = values[canonicalName];
	if (typeof value === "boolean") {
		if (def.multiple && existing?.kind === "boolean" && Array.isArray(existing.value))
			existing.value.push(value);
		else values[canonicalName] = { kind: "boolean", value: def.multiple ? [value] : value };
	} else if (def.multiple && existing?.kind === "string" && Array.isArray(existing.value)) {
		existing.value.push(value);
	} else {
		values[canonicalName] = { kind: "string", value: def.multiple ? [value] : value };
	}
}

/**
 * Split argv into positionals and canonical flag values, in argv order.
 * Strict: the first malformed flag token throws.
 */
function tokenizeArgv(command: CommandNode, argv: readonly string[]) {
	const positionals: string[] = [];
	const flagValues: Record<string, ArgvFlagValue | undefined> = {};
	for (let index = 0; index < argv.length; index++) {
		// SAFETY: index < argv.length.
		const arg = argv[index]!;
		// POSIX guideline 10: every token after the first `--` is an operand.
		if (arg === "--") {
			const separatorIndex = positionals.length;
			positionals.push(...argv.slice(index + 1));
			return { positionals, separatorIndex, flagValues };
		}

		const token = matchFlagToken(command.flagSpellings, arg);
		if (token === undefined) {
			positionals.push(arg);
			continue;
		}
		if (token instanceof CrustError) throw token;
		for (const { spelling, value } of token.occurrences) addFlagValue(flagValues, spelling, value);
		if (!token.pending) continue;

		const flag = token.pending.canonicalName;
		const value = argv[index + 1];
		// A next token starting with "-" more likely means a forgotten value; a lone `-` (stdin) is a value.
		if (value === undefined || (value.length > 1 && value.startsWith("-"))) {
			const hint =
				value === undefined ? "" : `; to pass a value starting with "-", write --${flag}=<value>`;
			throw new CrustError("PARSE", `Missing value for flag "--${flag}"${hint}`, {
				flag,
				reason: "missing-value",
			});
		}
		addFlagValue(flagValues, token.pending, value);
		index++;
	}
	return { positionals, separatorIndex: positionals.length, flagValues };
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

/**
 * Frozen value sources for definitions: `source(name)` for a supplied one, else `default`
 * when it declares one; definitions without a value are left out.
 */
function valueSources(
	definitions: readonly (readonly [string, ArgDef | FlagDef])[],
	source: (name: string) => ValueSource | undefined,
): Readonly<Record<string, ValueSource>> {
	const entries: [string, ValueSource][] = [];
	for (const [name, def] of definitions) {
		const chosen = source(name) ?? (def.default === undefined ? undefined : "default");
		if (chosen) entries.push([name, chosen]);
	}
	// fromEntries defines own properties, so an argument named `__proto__` stays a key.
	return Object.freeze(Object.fromEntries(entries));
}

/** Both front doors share binding, defaults, and canonical flag validation. */
function bind<A extends ArgsDef, F extends FlagsDef, V, W>(
	command: CommandNode & { args: A; effectiveFlags: F },
	positionals: readonly V[],
	flagValues: Readonly<Record<string, W | undefined>>,
	coerceArg: (def: ArgDef, value: V, label: string, index?: number) => ParsedArgValue,
	coerceFlag: (name: string, def: FlagDef, value: W) => ParsedFlagValue,
	defer?: DeferValueError,
) {
	// Flags given a value, so an omission that resolves to a default never orders as supplied.
	const present = new Set<string>();
	const flags = resolveFlags(command.effectiveFlags, flagValues, coerceFlag, defer, present);
	return { ...resolveArgs(command.args, positionals, coerceArg, defer), flags, present };
}

// ────────────────────────────────────────────────────────────────────────────
// parseArgs — Main parsing function
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse argv against a command's arg/flag definitions.
 *
 * Tokenizes argv against the command's flag spellings (strict: unknown or
 * malformed flags throw), then applies positional arg mapping, type
 * coercion, alias expansion, default values, and variadic args.
 *
 * Never throws for missing required values or for invalid values (type
 * coercion, `choices`, `parse`, env fallbacks). The first value error is
 * recorded in `valueErrors`, its definition is left unset (not defaulted), and
 * {@link validateParsed} throws it after extensions have had a chance to
 * handle an invocation (e.g. `--help`, `--version`).
 *
 * @param command - The command whose arg/flag definitions drive the parsing
 * @param argv - The argv array to parse (typically `process.argv.slice(2)`)
 * @param env - Environment consulted for `FlagDef.env` fallbacks; pass `{}` to parse without one
 * @returns Parsed args, flags, excessArgs (positionals before `--` not consumed by a declared argument), rawArgs (tokens after `--` not consumed by a declared argument), each value's source, and any deferred valueErrors
 * @throws {CrustError} On malformed argv: unknown flags, a missing option value, or a negated `noNegate` flag
 */
export function parseArgs<A extends ArgsDef = ArgsDef, F extends FlagsDef = FlagsDef>(
	command: CommandNode & { args: A; effectiveFlags: F },
	argv: string[],
	env: FlagEnvironment = process.env,
): ArgvParseResult<A, F> {
	const { positionals, separatorIndex, flagValues } = tokenizeArgv(command, argv);
	const valueErrors = new Map<string, CrustError>();
	const flagInput = applyEnvAndDelimiter(command.effectiveFlags, flagValues, env);
	const { args, flags, consumed, present } = bind(
		command,
		positionals,
		flagInput,
		coerceToken,
		coerceFlagValue,
		(error, label) => valueErrors.set(label, error),
	);
	// Tokens after `--` are operands: declared positionals take them first, the rest pass through.
	const rawArgs = positionals.slice(Math.max(consumed, separatorIndex));
	// Declared arguments take one positional each (a variadic, last, takes the rest).
	const suppliedArgs = new Set(command.args.slice(0, positionals.length).map(({ name }) => name));
	const sources = Object.freeze({
		args: valueSources(
			command.args.map((def) => [def.name, def] as const),
			(name) => (suppliedArgs.has(name) ? "argv" : undefined),
		),
		// argv > env > default, as applyEnvAndDelimiter chose. Presence is read before
		// delimiter splitting, so `--tags ""` counts as argv.
		flags: valueSources(Object.entries(command.effectiveFlags), (name) => {
			if (Object.hasOwn(flagValues, name)) return "argv";
			return Object.hasOwn(flagInput, name) && flagInput[name] !== undefined ? "env" : undefined;
		}),
		raw: rawArgs.length > 0 ? ("argv" as const) : undefined,
	});
	return {
		args,
		flags,
		excessArgs: positionals.slice(consumed, separatorIndex),
		rawArgs,
		// `flagValues` keys follow first occurrence in argv. Environment values have no
		// position; sorting them keeps the order independent of declaration order.
		flagOrder: [
			...Object.keys(flagValues).filter((name) => present.has(name)),
			...[...present].filter((name) => !Object.hasOwn(flagValues, name)).sort(),
		],
		...(suppliedArgs.size > 0 && { suppliedArgs }),
		sources,
		...(valueErrors.size > 0 && { valueErrors }),
	};
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
export async function parseFlagValues<const F extends FlagsDef>(
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

/** Only named records can supply a later positional while omitting an earlier one. */
function positionalGap(argument: string, omitted: string): CrustError {
	return new CrustError(
		"PARSE",
		`Argument <${argument}> cannot be provided after omitted argument <${omitted}>`,
		{ argument, reason: "positional-gap" },
	);
}

/** Bind typed input without producing argv; the path alone selects the command. */
export function parseStructured<A extends ArgsDef = ArgsDef, F extends FlagsDef = FlagsDef>(
	command: CommandNode & { args: A; effectiveFlags: F },
	input: RunInputPayload,
): ArgvParseResult<A, F> {
	const { args: inputArgs, flags: inputFlags, raw } = input;
	const positionals: RunInputValue[] = [];
	const suppliedArgs = new Set<string>();
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
		if (omittedArgument !== undefined) throw positionalGap(definition.name, omittedArgument);
		if (definition.variadic) {
			if (!isOccurrenceArray(value)) {
				throw new CrustError("PARSE", `Expected an occurrence array for <${definition.name}>`);
			}
			positionals.push(...value);
			// An empty array is zero occurrences, so like argv omission it supplies nothing.
			if (value.length > 0) suppliedArgs.add(definition.name);
		} else {
			// A non-variadic JSON array is one positional value.
			positionals.push(value);
			suppliedArgs.add(definition.name);
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
	const { args, flags, present } = bind(
		command,
		positionals,
		inputFlags ?? {},
		coerceStructuredValue,
		coerceStructuredFlag,
	);
	// Key order stands in for command-line order; values are not re-read, so getters run once.
	const flagOrder = Object.keys(inputFlags ?? {}).filter((name) => present.has(name));
	return {
		args,
		flags,
		excessArgs: [],
		rawArgs: [...(raw ?? [])],
		flagOrder,
		...(suppliedArgs.size > 0 && { suppliedArgs }),
		sources: Object.freeze({
			args: valueSources(
				command.args.map((def) => [def.name, def] as const),
				(name) => (suppliedArgs.has(name) ? "run" : undefined),
			),
			flags: valueSources(Object.entries(command.effectiveFlags), (name) =>
				present.has(name) ? "run" : undefined,
			),
			// Like argv's leftover tokens, an empty `raw` is no passthrough.
			raw: raw === undefined || raw.length === 0 ? undefined : ("run" as const),
		}),
	};
}

/**
 * Bind structured input over a parse result, as `ExtensionContext.bindInput` does.
 * Values given on argv win; every other supplied key replaces the environment value,
 * default, or typed `run()` value, converted as {@link parseStructured} converts it.
 * Supplied keys that argv already gave are dropped first, so their values are never
 * converted and cannot fail; values not replaced are kept without re-resolving defaults.
 *
 * @param parsed - The invocation's original parse result; each call re-binds against it
 * @throws {CrustError} `PARSE` on an unknown key, a positional argument supplied after an
 *   omitted earlier one, or a value that fails conversion (including a non-array value for
 *   a variadic argument or `multiple` flag)
 */
export function bindStructuredInput(
	command: CommandNode,
	parsed: ArgvParseResult,
	input: RunInputPayload,
): ArgvParseResult {
	const { sources } = parsed;
	const supplied = (
		record: RunInputPayload["args"],
		given: Readonly<Record<string, ValueSource>>,
	) =>
		Object.fromEntries(
			Object.entries(record ?? {}).filter(
				([name, value]) => value !== undefined && given[name] !== "argv",
			),
		);
	const inputArgs = supplied(input.args, sources.args);
	const inputFlags = supplied(input.flags, sources.flags);
	const raw = sources.raw === "argv" ? undefined : input.raw;
	// Typed `run()` order over the merged positionals, kept ones included.
	let omitted: string | undefined;
	for (const { name } of command.args) {
		if (!parsed.suppliedArgs?.has(name) && !Object.hasOwn(inputArgs, name)) omitted = name;
		else if (omitted !== undefined) throw positionalGap(name, omitted);
	}
	// Bind only the supplied definitions; unknown keys still fail against the narrowed command.
	const structured = parseStructured(
		{
			...command,
			args: command.args.filter(({ name }) => Object.hasOwn(inputArgs, name)),
			effectiveFlags: Object.fromEntries(
				Object.entries(command.effectiveFlags).filter(([name]) => Object.hasOwn(inputFlags, name)),
			),
		},
		{ args: inputArgs, flags: inputFlags, raw },
	);
	const pick = (bound: Record<string, ParsedArgValue>, names: Record<string, unknown>) =>
		Object.fromEntries(Object.keys(names).map((name) => [name, bound[name]]));
	// Supplied keys take parseStructured's sources as bound, so an empty array reports its fallback.
	const rebound = (
		original: Readonly<Record<string, ValueSource>>,
		names: Record<string, unknown>,
		structuredSources: Readonly<Record<string, ValueSource>>,
	): Readonly<Record<string, ValueSource>> =>
		Object.freeze(
			Object.fromEntries([
				...Object.entries(original).filter(([name]) => !Object.hasOwn(names, name)),
				...Object.entries(structuredSources).map(([name, source]): [string, ValueSource] => [
					name,
					source === "run" ? "bound" : source,
				]),
			]),
		);
	// A replaced flag's environment value error no longer applies.
	const replaced = new Set(Object.keys(inputFlags).map((name) => `--${name}`));
	const valueErrors = new Map(
		[...(parsed.valueErrors ?? [])].filter(([label]) => !replaced.has(label)),
	);
	return {
		...parsed,
		// Spread, not assignment: an argument may be named `__proto__`.
		args: { ...parsed.args, ...pick(structured.args, inputArgs) },
		flags: { ...parsed.flags, ...pick(structured.flags, inputFlags) },
		rawArgs: raw === undefined ? parsed.rawArgs : structured.rawArgs,
		sources: Object.freeze({
			args: rebound(sources.args, inputArgs, structured.sources.args),
			flags: rebound(sources.flags, inputFlags, structured.sources.flags),
			raw: raw === undefined ? sources.raw : structured.sources.raw && ("bound" as const),
		}),
		valueErrors,
	};
}

/**
 * Validate a parse result: its deferred value error first, then the command's
 * positional and required-value constraints.
 *
 * Separated from {@link parseArgs} so that middleware (e.g. `--help`) can
 * inspect the parse result before validation errors are surfaced.
 *
 * @param command - The command whose definitions drive the validation
 * @param parsed - The parse result from {@link parseArgs}
 * @throws {CrustError} The first deferred value error (`PARSE`), or `VALIDATION` on
 *   unexpected positionals or missing required args or flags
 */
export function validateParsed<A extends ArgsDef = ArgsDef, F extends FlagsDef = FlagsDef>(
	command: CommandNode & { args: A; effectiveFlags: F },
	parsed: ArgvParseResult<A, F>,
): void {
	const [valueError] = parsed.valueErrors?.values() ?? [];
	if (valueError) throw valueError;
	if (parsed.excessArgs.length > 0) {
		throw new CrustError(
			"VALIDATION",
			`Unexpected positional argument${parsed.excessArgs.length === 1 ? "" : "s"}: ${parsed.excessArgs.map((arg) => JSON.stringify(arg)).join(", ")}`,
		);
	}

	validateRequiredArgs(command.args, parsed.args);
	validateRequiredFlags(command.effectiveFlags, parsed.flags);
}
