import { parseArgs as nodeParseArgs, type ParseArgsOptionDescriptor } from "node:util";

import { coerceBooleanString, tryCoerceNumber } from "@crustjs/utils/primitive";

import type { CommandNode } from "../command/node.ts";
import { CrustError } from "../errors.ts";
import type {
	ArgDef,
	ArgsDef,
	FlagDef,
	FlagsDef,
	ParseResult,
	ParsedArgValue,
	ParsedFlagValue,
	RawParsedArgs,
	RawParsedFlags,
	ValueType,
} from "../types.ts";
import { coerceJson, coercePath, coerceUrl } from "./coercers.ts";
import type { FlagSpelling } from "./spellings.ts";

// ────────────────────────────────────────────────────────────────────────────
// Internal types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Union of all possible value shapes that `util.parseArgs` can produce for a
 * single option when the config is constructed dynamically at runtime.
 * Not exported by `@types/node`, so we define it here.
 */
type OptionTokenValue = string | boolean | (string | boolean)[] | undefined;

/** Element type of `parseArgs(...).tokens` — not exported by `@types/node`. */
type ParseArgsToken = NonNullable<ReturnType<typeof nodeParseArgs>["tokens"]>[number];

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the options config for `util.parseArgs` from the shared spelling table.
 * Also returns a reverse alias→name mapping for resolving parsed results.
 */
function buildParseArgsOptionDescriptor(spellings: ReadonlyMap<string, FlagSpelling>) {
	const options: Record<string, ParseArgsOptionDescriptor> = {};
	const aliasToName: Record<string, string> = {};

	for (const [spelling, entry] of spellings) {
		const descriptor: ParseArgsOptionDescriptor = {
			type: entry.def.type === "boolean" ? "boolean" : "string",
		};
		if (entry.def.multiple) descriptor.multiple = true;

		if (entry.kind === "canonical") {
			if (entry.def.short) descriptor.short = entry.def.short;
			options[spelling] = descriptor;
			continue;
		}

		aliasToName[spelling] = entry.canonicalName;
		if (entry.kind === "alias") options[spelling] = descriptor;
	}

	return { options, aliasToName };
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
		// util.parseArgs handles boolean flags natively, but in case we receive a string
		return coerceBooleanString(value);
	}
	if (type === "url") return coerceUrl(value);
	if (type === "path") return coercePath(value);
	if (type === "json") return coerceJson(value);
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
	// AsyncParseBrand owns literal async parsers; this owns the dynamic path.
	// Without it the pending Promise becomes the flag/arg value, and a rejecting
	// parser escapes the CrustError pipeline as an unhandled rejection.
	if (result instanceof Promise) {
		result.catch(() => {}); // the rejection is reported synchronously below
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
 * default field is a raw string per `PathFlagDef`/`PathArgDef`. `url` and
 * `json` defaults are already in their resolved form (`URL` / `unknown`)
 * per the variant interfaces, so they pass through unchanged.
 */
function resolveDefault(def: ArgDef | FlagDef, label: string) {
	const { default: defaultValue, choices, parse } = def;
	if (defaultValue === undefined) return undefined;

	// Runtime home for the dynamic path only: choices/defaults widened from
	// runtime data (config-driven definitions) are invisible to the
	// FIX_DEFAULT_CHOICE brand, and defaults bypass the argv choices check,
	// so an out-of-range default would silently reach the action.
	if (choices) {
		for (const v of Array.isArray(defaultValue) ? defaultValue : [defaultValue]) {
			// oxlint-disable-next-line typescript/no-unnecessary-type-conversion -- runtime-configured definitions can violate the static string-default contract
			validateChoice(String(v), choices, label);
		}
	}

	if (parse) {
		if (Array.isArray(defaultValue)) {
			// oxlint-disable-next-line typescript/no-unnecessary-type-conversion -- runtime-configured definitions can violate the static string-default contract
			return defaultValue.map((v, i) => invokeParse(parse, String(v), label, i));
		}
		// oxlint-disable-next-line typescript/no-unnecessary-type-conversion -- runtime-configured definitions can violate the static string-default contract
		return invokeParse(parse, String(defaultValue), label);
	}

	if (def.type === "path") {
		if (Array.isArray(defaultValue)) {
			return defaultValue.map((v) => coercePath(String(v)));
		}
		return coercePath(String(defaultValue));
	}

	return defaultValue;
}

/**
 * Coerce a single flag's parsed value to its target type.
 *
 * Order on string-typed flags with `choices` and/or `parse`:
 *   raw token → choices validation → parse transform (if set) → result.
 * For multi-value flags both steps run per element.
 */
function isBooleanToken(value: OptionTokenValue): value is boolean {
	return typeof value === "boolean";
}

function isStringToken(value: OptionTokenValue): value is string {
	return typeof value === "string";
}

function coerceFlagValue(
	name: string,
	def: FlagDef,
	parsedValue: string | boolean | (string | boolean)[],
) {
	const label = `--${name}`;
	const { choices, parse } = def;

	if (def.multiple && Array.isArray(parsedValue)) {
		if (def.type === "boolean") {
			return parsedValue.filter(isBooleanToken);
		}
		return parsedValue.map((value, i) => {
			if (!isStringToken(value)) {
				throw new CrustError("PARSE", `Internal: unexpected non-string value for flag "${label}"`);
			}
			if (choices) validateChoice(value, choices, label);
			if (parse) return invokeParse(parse, value, label, i);
			return coerceValue(value, def.type, label);
		});
	}

	if (def.type === "boolean") {
		// Strict: only accept actual boolean values from the parser.
		// --flag produces true, --no-flag produces false.
		if (isBooleanToken(parsedValue)) {
			return parsedValue;
		}
		throw new CrustError(
			"PARSE",
			`Expected boolean value for flag "${label}", got non-boolean token`,
		);
	}

	if (isStringToken(parsedValue)) {
		if (choices) validateChoice(parsedValue, choices, label);
		if (parse) return invokeParse(parse, parsedValue, label);
		return coerceValue(parsedValue, def.type, label);
	}

	// Unreachable: `util.parseArgs` is configured with `type: "string"` for
	// every non-boolean flag (see buildParseArgsOptionDescriptor) and
	// `strict: true`, so a non-boolean flag can never see a boolean or
	// array `parsedValue` here. Fail loud rather than silently returning a
	// default value, which would mask a parser-configuration bug.
	throw new CrustError("PARSE", `Internal: unexpected value shape for flag "${label}"`);
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
function resolveAliases(
	tokens: ParseArgsToken[],
	aliasToName: Record<string, string>,
	flagsDef: FlagsDef,
) {
	const canonical: Record<string, OptionTokenValue> = {};

	for (const token of tokens) {
		if (token.kind !== "option") continue;

		const canonicalName = aliasToName[token.name] ?? token.name;
		const def = flagsDef[canonicalName];
		if (!def) continue;

		// Booleans carry no token value; a `--no-` spelling means false
		// (allowNegative). Non-booleans always have a string value in strict mode.
		// SAFETY: strict-mode parseArgs guarantees string values on non-boolean option tokens.
		const value: string | boolean =
			def.type === "boolean" ? !token.rawName.startsWith("--no-") : (token.value as string);

		if (def.multiple) {
			const existing = canonical[canonicalName];
			if (Array.isArray(existing)) {
				existing.push(value);
			} else {
				canonical[canonicalName] = [value];
			}
		} else {
			canonical[canonicalName] = value;
		}
	}

	return canonical;
}

/**
 * Resolve all flag definitions against the canonical parsed values.
 * Handles coercion and default values.
 */
function resolveFlags<F extends FlagsDef>(
	flagsDef: F,
	tokens: ParseArgsToken[],
	aliasToName: Record<string, string>,
): RawParsedFlags<F> {
	const resolved: Record<string, ParsedFlagValue> = {};
	const canonical = resolveAliases(tokens, aliasToName, flagsDef);

	for (const [name, def] of Object.entries(flagsDef)) {
		const parsedValue = canonical[name];

		if (parsedValue !== undefined) {
			resolved[name] = coerceFlagValue(name, def, parsedValue);
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
 * Resolve positional argument definitions against the parsed positional tokens.
 * Handles variadic args, coercion, and default values.
 *
 * This is a pure parse+coerce function — it never throws for missing required
 * values. Use {@link validateParsed} to enforce required constraints.
 */
interface ResolvedArgs<A extends ArgsDef> {
	args: RawParsedArgs<A>;
	consumed: number;
}

function resolveArgs<A extends ArgsDef>(argsDef: A, positionals: string[]): ResolvedArgs<A> {
	const resolved: Record<string, ParsedArgValue> = {};
	let index = 0;

	for (const def of argsDef) {
		const { name, choices, parse } = def;
		const label = `<${name}>`;

		const coerceOne = (raw: string, i?: number) => {
			if (def.schema) return raw;
			if (choices) validateChoice(raw, choices, label);
			if (parse) return invokeParse(parse, raw, label, i);
			return coerceValue(raw, def.type, label);
		};

		if (def.variadic) {
			const remaining = positionals.slice(index);
			resolved[name] = remaining.map((v, i) => coerceOne(v, i));
			index = positionals.length;
		} else if (index < positionals.length) {
			// SAFETY: the bounds check above proves this positional exists.
			resolved[name] = coerceOne(positionals[index] as string);
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
 * This is a pure parse+coerce function — it never throws for missing required
 * values. Use {@link validateParsed} to enforce required constraints after
 * extensions have had a chance to finish an invocation (e.g. `--help`).
 *
 * @param command - The command whose arg/flag definitions drive the parsing
 * @param argv - The argv array to parse (typically `process.argv.slice(2)`)
 * @returns Parsed args, flags, excessArgs (positionals before `--` not consumed by a declared argument), and rawArgs (everything after `--`)
 * @throws {CrustError} On unknown flags or type coercion failure
 */
export function parseArgs<A extends ArgsDef = ArgsDef, F extends FlagsDef = FlagsDef>(
	command: CommandNode & { args: A; effectiveFlags: F },
	argv: string[],
): ParseResult<A, F> {
	const argsDef = command.args;
	const flagsDef = command.effectiveFlags;

	const spellings = command.flagSpellings;
	const { options: parseOptions, aliasToName } = buildParseArgsOptionDescriptor(spellings);

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
			const unknownMatch = error.message.match(/Unknown option '(.+?)'/);
			if (unknownMatch) {
				throw new CrustError("PARSE", `Unknown flag "${unknownMatch[1]}"`).withCause(error);
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
			(afterSeparator ? rawArgs : preSeparatorPositionals).push(token.value ?? "");
		}
	}

	const resolvedFlags = resolveFlags(flagsDef, parsed.tokens, aliasToName);
	const resolvedArgs = resolveArgs(argsDef, preSeparatorPositionals);

	return {
		args: resolvedArgs.args,
		flags: resolvedFlags,
		excessArgs: preSeparatorPositionals.slice(resolvedArgs.consumed),
		rawArgs,
	};
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
	const argsDef = command.args;
	const flagsDef = command.effectiveFlags;

	const args = parsed.args;
	const flags = parsed.flags;

	if (parsed.excessArgs.length > 0) {
		throw new CrustError(
			"VALIDATION",
			`Unexpected positional argument${parsed.excessArgs.length === 1 ? "" : "s"}: ${parsed.excessArgs.map((arg) => JSON.stringify(arg)).join(", ")}`,
		);
	}

	// Re-validate args: check for required args that are undefined
	for (const def of argsDef) {
		const { name } = def;
		const label = `argument "<${name}>"`;
		// SAFETY: name comes from the same argument definitions that produced this mapped result.
		const value = args[name as keyof typeof args];

		if (def.required === true && def.default === undefined) {
			if (def.variadic) {
				if (!Array.isArray(value) || value.length === 0) {
					throw new CrustError("VALIDATION", `Missing required ${label}`);
				}
			} else if (value === undefined) {
				throw new CrustError("VALIDATION", `Missing required ${label}`);
			}
		}
	}

	validateRequiredFlags(flagsDef, flags);
}
