import { parseArgs as nodeParseArgs, type ParseArgsOptionDescriptor } from "node:util";

import { coerceBooleanString, tryCoerceNumber } from "@crustjs/utils/primitive";

import type { CommandNode } from "../command/node.ts";
import { CrustError } from "../errors.ts";
import type {
	ArgDef,
	ArgsDef,
	FlagDef,
	FlagsDef,
	InferArgs,
	InferFlags,
	ParseResult,
	ValueType,
} from "../types.ts";
import { coerceJson, coercePath, coerceUrl } from "./coercers.ts";
import { flagSpellings, type FlagSpelling } from "./spellings.ts";

// ────────────────────────────────────────────────────────────────────────────
// Internal types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Union of all possible value shapes that `util.parseArgs` can produce for a
 * single option when the config is constructed dynamically at runtime.
 * Not exported by `@types/node`, so we define it here.
 */
type ParsedFlagValue = string | boolean | (string | boolean)[] | undefined;

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
function invokeParse(
	parse: (raw: string) => unknown,
	raw: string,
	label: string,
	index?: number,
): unknown {
	try {
		return parse(raw);
	} catch (err) {
		const location = index === undefined ? label : `${label} element [${index}]`;
		const reason = err instanceof Error ? err.message : String(err);
		throw new CrustError("PARSE", `Failed to parse ${location}: ${reason}`).withCause(err);
	}
}

/**
 * Resolve a flag/arg default to its runtime value, mirroring the argv-side
 * coercion pipeline so omitted-flag behavior matches user-supplied behavior:
 *
 *   raw default → choices validation → parse | coerce → result
 *
 * Without this, `{ choices: ["a","b"], default: "z" }` silently returns "z"
 * while `--flag z` throws, and `{ type: "path", default: "./dist" }` returns
 * the raw relative string while `--out ./dist` returns an absolute path.
 *
 * `parse` is preferred when present (matches the escape-hatch contract).
 * `type: "path"` defaults are coerced through `coercePath` because their
 * default field is a raw string per `PathFlagDef`/`PathArgDef`. `url` and
 * `json` defaults are already in their resolved form (`URL` / `unknown`)
 * per the variant interfaces, so they pass through unchanged.
 */
function resolveDefault(
	def: {
		type: ValueType;
		default?: unknown;
		choices?: readonly string[];
		parse?: (raw: string) => unknown;
	},
	label: string,
): unknown {
	const { default: defaultValue, choices, parse } = def;
	if (defaultValue === undefined) return undefined;

	if (choices) {
		if (Array.isArray(defaultValue)) {
			for (const v of defaultValue) validateChoice(String(v), choices, label);
		} else {
			validateChoice(String(defaultValue), choices, label);
		}
	}

	if (parse) {
		if (Array.isArray(defaultValue)) {
			return defaultValue.map((v, i) => invokeParse(parse, String(v), label, i));
		}
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
 * Walk every flag/arg def with a `parse` field and reject async parsers
 * up-front. Async parse would return a Promise that the parser would treat
 * as the resolved value — almost certainly a bug. Throws
 * `CrustError("DEFINITION", …)` for each offender. Called at the top of
 * {@link parseArgs} so misconfigured commands fail fast.
 */
function assertSyncParse(
	parse: ((raw: string) => unknown) | undefined,
	subject: "flag" | "arg",
	name: string,
): void {
	if (parse?.constructor.name !== "AsyncFunction") return;

	const label = subject === "flag" ? `flag --${name}` : `argument <${name}>`;
	throw new CrustError(
		"DEFINITION",
		`Async parse not supported for ${label}. Use a sync parser; do async work in run().`,
		{ subject, name, reason: "async-parse" },
	);
}

function validateAsyncParse(flagsDef: FlagsDef | undefined, argsDef: ArgsDef | undefined): void {
	for (const [name, def] of Object.entries(flagsDef ?? {})) {
		assertSyncParse((def as { parse?: (raw: string) => unknown }).parse, "flag", name);
	}
	for (const def of argsDef ?? []) {
		assertSyncParse(def.parse, "arg", def.name);
	}
}

/**
 * Coerce a single flag's parsed value to its target type.
 *
 * Order on string-typed flags with `choices` and/or `parse`:
 *   raw token → choices validation → parse transform (if set) → result.
 * For multi-value flags both steps run per element.
 */
function coerceFlagValue(
	name: string,
	def: FlagDef,
	parsedValue: string | boolean | (string | boolean)[],
): unknown {
	const label = `--${name}`;
	const choices = (def as { choices?: readonly string[] }).choices;
	const parse = (def as { parse?: (raw: string) => unknown }).parse;

	if (def.multiple && Array.isArray(parsedValue)) {
		if (def.type === "boolean") {
			return parsedValue.filter((v): v is boolean => typeof v === "boolean");
		}
		return (parsedValue as string[]).map((v, i) => {
			if (choices) validateChoice(v, choices, label);
			if (parse) return invokeParse(parse, v, label, i);
			return coerceValue(v, def.type, label);
		});
	}

	if (def.type === "boolean") {
		// Strict: only accept actual boolean values from the parser.
		// --flag produces true, --no-flag produces false.
		if (typeof parsedValue === "boolean") {
			return parsedValue;
		}
		throw new CrustError(
			"PARSE",
			`Expected boolean value for flag "${label}", got ${typeof parsedValue}`,
		);
	}

	if (typeof parsedValue === "string") {
		if (choices) validateChoice(parsedValue, choices, label);
		if (parse) return invokeParse(parse, parsedValue, label);
		return coerceValue(parsedValue, def.type, label);
	}

	// Unreachable: `util.parseArgs` is configured with `type: "string"` for
	// every non-boolean flag (see buildParseArgsOptionDescriptor) and
	// `strict: true`, so a non-boolean flag can never see a boolean or
	// array `parsedValue` here. Fail loud rather than silently returning a
	// default value, which would mask a parser-configuration bug.
	throw new CrustError(
		"PARSE",
		`Internal: unexpected value shape for flag "${label}" (got ${typeof parsedValue})`,
	);
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
): Record<string, ParsedFlagValue> {
	const canonical: Record<string, ParsedFlagValue> = {};

	for (const token of tokens) {
		if (token.kind !== "option") continue;

		const canonicalName = aliasToName[token.name] ?? token.name;
		const def = flagsDef[canonicalName];
		if (!def) continue;

		// Booleans carry no token value; a `--no-` spelling means false
		// (allowNegative). Non-booleans always have a string value in strict mode.
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
	flagsDef: F | undefined,
	tokens: ParseArgsToken[],
	aliasToName: Record<string, string>,
): InferFlags<F> {
	const resolved: Partial<InferFlags<F>> = {};

	if (flagsDef) {
		const canonical = resolveAliases(tokens, aliasToName, flagsDef);

		for (const [name, def] of Object.entries(flagsDef)) {
			const parsedValue = canonical[name];

			if (parsedValue !== undefined) {
				Reflect.set(resolved, name, coerceFlagValue(name, def, parsedValue));
				continue;
			}

			Reflect.set(
				resolved,
				name,
				resolveDefault(def as Parameters<typeof resolveDefault>[0], `--${name}`),
			);
		}
	}

	// Definitions are runtime keys, so TypeScript cannot correlate each write with InferFlags<F>.
	return resolved as InferFlags<F>;
}

/**
 * Validate required flags against already-resolved flag values.
 */
function validateRequiredFlags<F extends FlagsDef>(
	flagsDef: F | undefined,
	resolvedFlags: InferFlags<F>,
): void {
	if (!flagsDef) return;

	for (const [name, def] of Object.entries(flagsDef)) {
		if (def.required === true && def.default === undefined) {
			if (resolvedFlags[name as keyof InferFlags<F>] === undefined) {
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
function resolveArgs<A extends ArgsDef>(
	argsDef: A | undefined,
	positionals: string[],
): InferArgs<A> {
	const resolved: Partial<InferArgs<A>> = {};
	let index = 0;

	for (const def of argsDef ?? []) {
		const { name } = def as ArgDef;
		const label = `<${name}>`;
		const choices = (def as { choices?: readonly string[] }).choices;
		const parse = (def as { parse?: (raw: string) => unknown }).parse;

		const coerceOne = (raw: string, i?: number) => {
			if (choices) validateChoice(raw, choices, label);
			if (parse) return invokeParse(parse, raw, label, i);
			return def.type === undefined ? raw : coerceValue(raw, def.type, label);
		};

		if (def.variadic) {
			const remaining = positionals.slice(index);
			Reflect.set(
				resolved,
				name,
				remaining.map((v, i) => coerceOne(v, i)),
			);
			index = positionals.length;
		} else if (index < positionals.length) {
			Reflect.set(resolved, name, coerceOne(positionals[index] as string));
			index++;
		} else {
			Reflect.set(
				resolved,
				name,
				resolveDefault(def as Parameters<typeof resolveDefault>[0], label),
			);
		}
	}

	// Definitions are runtime keys, so TypeScript cannot correlate each write with InferArgs<A>.
	return resolved as InferArgs<A>;
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
 * @returns Parsed args, flags, and rawArgs (everything after `--`)
 * @throws {CrustError} On unknown flags, type coercion failure, or alias collisions
 */
export function parseArgs<A extends ArgsDef = ArgsDef, F extends FlagsDef = FlagsDef>(
	command: CommandNode & { args: A | undefined; effectiveFlags: F },
	argv: string[],
): ParseResult<A, F> {
	const argsDef = command.args;
	const flagsDef = command.effectiveFlags;

	// CONFIG-class validation: reject async parse fns up-front so the parser
	// never sees a Promise where a value was expected.
	validateAsyncParse(flagsDef, argsDef);

	const spellings = flagSpellings(flagsDef);
	const { options: parseOptions, aliasToName } = buildParseArgsOptionDescriptor(spellings);

	validateNoNegateUsage(argv, spellings);

	let parsed: ReturnType<typeof nodeParseArgs>;

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
		}
		throw new CrustError("PARSE", "Failed to parse command arguments").withCause(error);
	}

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
				(afterSeparator ? rawArgs : preSeparatorPositionals).push(token.value ?? "");
			}
		}
	} else {
		preSeparatorPositionals.push(...parsed.positionals);
	}

	const resolvedFlags = resolveFlags(flagsDef, parsed.tokens ?? [], aliasToName);
	const resolvedArgs = resolveArgs(argsDef, preSeparatorPositionals);

	return {
		args: resolvedArgs,
		flags: resolvedFlags,
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
	command: CommandNode & { args: A | undefined; effectiveFlags: F },
	parsed: ParseResult<A, F>,
): void {
	const argsDef = command.args;
	const flagsDef = command.effectiveFlags;

	const args = parsed.args;
	const flags = parsed.flags;

	// Re-validate args: check for required args that are undefined
	if (argsDef) {
		for (const def of argsDef) {
			const { name } = def as ArgDef;
			const label = `argument "<${name}>"`;
			const value = args[name as keyof InferArgs<A>];

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
	}

	validateRequiredFlags(flagsDef, flags);
}
