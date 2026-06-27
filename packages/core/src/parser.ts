import { coerceBooleanString, tryCoerceNumber } from "@crustjs/utils/primitive";

import { coerceJson, coercePath, coerceUrl } from "./coercers.ts";
import { CrustError } from "./errors.ts";
import type { CommandNode } from "./node.ts";
import type { ArgDef, ArgsDef, FlagDef, FlagsDef, ParseResult, ValueType } from "./types.ts";

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
	const options: Record<string, true> = {};
	const aliasToName: Record<string, string> = {};

	if (!flagsDef) return { options, aliasToName };

	// Runtime alias collision check — mirrors the compile-time
	// ValidateFlagAliases<F> type (which catches both alias→flag-name
	// and alias→alias collisions). Kept as defense-in-depth against type
	// erasure (dynamic construction, `as any` casts, widened generics).
	const aliasRegistry = new Map<string, string>();
	for (const name of Object.keys(flagsDef)) {
		aliasRegistry.set(name, name);
	}

	for (const [name, def] of Object.entries(flagsDef)) {
		// Defense-in-depth: reject "no-" prefixed names even when bypassing the builder
		if (name.startsWith("no-")) {
			const base = name.slice(3);
			throw new CrustError(
				"DEFINITION",
				`Flag "--${name}" must not use "no-" prefix; define "${base}" and negate with "--no-${base}"`,
			);
		}

		if (!ALLOWED_FLAG_TYPES.has(def.type)) {
			throw new CrustError(
				"DEFINITION",
				`Flag "--${name}" must declare a parser type ("string", "number", "boolean", "url", "path", or "json")`,
			);
		}

		// Handle short alias
		if (def.short) {
			// Defense-in-depth: reject "no-" prefixed short alias
			if (def.short.startsWith("no-")) {
				throw new CrustError(
					"DEFINITION",
					`Short alias "-${def.short}" on "--${name}" must not use "no-" prefix (reserved for negation)`,
				);
			}

			const existing = aliasRegistry.get(def.short);
			if (existing) {
				throw new CrustError(
					"DEFINITION",
					`Alias collision: "-${def.short}" is used by both "--${existing}" and "--${name}"`,
				);
			}
			aliasRegistry.set(def.short, name);
			aliasToName[def.short] = name;
			options[def.short] = true;
		}

		// Handle long aliases
		if (def.aliases) {
			for (const alias of def.aliases) {
				// Defense-in-depth: reject "no-" prefixed aliases
				if (alias.startsWith("no-")) {
					throw new CrustError(
						"DEFINITION",
						`Alias "--${alias}" on "--${name}" must not use "no-" prefix (reserved for negation)`,
					);
				}

				const existing = aliasRegistry.get(alias);
				if (existing) {
					throw new CrustError(
						"DEFINITION",
						`Alias collision: "${alias.length === 1 ? "-" : "--"}${alias}" is used by both "--${existing}" and "--${name}"`,
					);
				}
				aliasRegistry.set(alias, name);
				aliasToName[alias] = name;
				options[alias] = true;
			}
		}

		options[name] = true;
	}

	return { options, aliasToName };
}

function addParsedValue(
	values: Record<string, ParsedFlagValue>,
	key: string,
	value: string | boolean,
	flagsDef: FlagsDef,
	aliasToName: Record<string, string>,
): void {
	const canonicalName = aliasToName[key] ?? key;
	const def = flagsDef[canonicalName];
	if (!def) return;

	const existing = values[key];
	if (def.multiple) {
		if (Array.isArray(existing)) {
			existing.push(value);
		} else if (existing !== undefined) {
			values[key] = [existing, value];
		} else {
			values[key] = [value];
		}
		return;
	}

	values[key] = value;
}

function parseArgv(
	argv: string[],
	flagsDef: FlagsDef | undefined,
	aliasToName: Record<string, string>,
): {
	values: Record<string, ParsedFlagValue>;
	positionals: string[];
	rawArgs: string[];
} {
	const values: Record<string, ParsedFlagValue> = {};
	const positionals: string[] = [];
	const rawArgs: string[] = [];
	const flags = flagsDef ?? {};

	const resolveFlag = (key: string): { canonical: string; def: FlagDef } | null => {
		const canonical = aliasToName[key] ?? key;
		const def = flags[canonical];
		return def ? { canonical, def } : null;
	};

	let i = 0;
	while (i < argv.length) {
		const token = argv[i] as string;

		if (token === "--") {
			rawArgs.push(...argv.slice(i + 1));
			break;
		}

		if (token.startsWith("--no-")) {
			const assignmentIndex = token.indexOf("=");
			const rawName =
				assignmentIndex === -1
					? token.slice("--no-".length)
					: token.slice("--no-".length, assignmentIndex);

			if (assignmentIndex !== -1) {
				throw new CrustError("PARSE", `Unknown flag "--no-${rawName}"`);
			}

			const resolved = resolveFlag(rawName);
			if (!resolved || resolved.def.type !== "boolean") {
				throw new CrustError("PARSE", `Unknown flag "--no-${rawName}"`);
			}
			addParsedValue(values, resolved.canonical, false, flags, aliasToName);
			i++;
			continue;
		}

		if (token.startsWith("--") && token.length > 2) {
			const assignmentIndex = token.indexOf("=");
			const rawName = assignmentIndex === -1 ? token.slice(2) : token.slice(2, assignmentIndex);
			const resolved = resolveFlag(rawName);
			if (!resolved) {
				throw new CrustError("PARSE", `Unknown flag "--${rawName}"`);
			}

			if (resolved.def.type === "boolean") {
				if (assignmentIndex !== -1) {
					throw new CrustError("PARSE", "Failed to parse command arguments").withCause(
						new Error(`Option '--${rawName}' does not take an argument`),
					);
				}
				addParsedValue(values, rawName, true, flags, aliasToName);
				i++;
				continue;
			}

			if (assignmentIndex !== -1) {
				addParsedValue(values, rawName, token.slice(assignmentIndex + 1), flags, aliasToName);
				i++;
				continue;
			}

			const next = argv[i + 1];
			if (next === undefined || next === "--") {
				throw new CrustError("PARSE", "Failed to parse command arguments").withCause(
					new Error(`Option '--${rawName}' expects an argument`),
				);
			}
			addParsedValue(values, rawName, next, flags, aliasToName);
			i += 2;
			continue;
		}

		if (token.startsWith("-") && token.length > 1 && !/^-\d/.test(token)) {
			const rawName = token.slice(1);
			const resolved = resolveFlag(rawName);
			if (!resolved) {
				throw new CrustError("PARSE", `Unknown flag "-${rawName}"`);
			}

			if (resolved.def.type === "boolean") {
				addParsedValue(values, rawName, true, flags, aliasToName);
				i++;
				continue;
			}

			const next = argv[i + 1];
			if (next === undefined || next === "--") {
				throw new CrustError("PARSE", "Failed to parse command arguments").withCause(
					new Error(`Option '-${rawName}' expects an argument`),
				);
			}
			addParsedValue(values, rawName, next, flags, aliasToName);
			i += 2;
			continue;
		}

		positionals.push(token);
		i++;
	}

	return { values, positionals, rawArgs };
}

const ALLOWED_FLAG_TYPES: ReadonlySet<ValueType> = new Set([
	"string",
	"number",
	"boolean",
	"url",
	"path",
	"json",
]);

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
 * `CrustError("CONFIG", …)` for each offender. Called at the top of
 * {@link parseArgs} so misconfigured commands fail fast.
 */
function validateAsyncParse(flagsDef: FlagsDef | undefined, argsDef: ArgsDef | undefined): void {
	if (flagsDef) {
		for (const [name, def] of Object.entries(flagsDef)) {
			const parse = (def as { parse?: (raw: string) => unknown }).parse;
			if (parse && parse.constructor.name === "AsyncFunction") {
				throw new CrustError(
					"CONFIG",
					`Async parse not supported for flag --${name}. Use a sync parser; do async work in run().`,
				);
			}
		}
	}
	if (argsDef) {
		for (const def of argsDef) {
			const parse = (def as { parse?: (raw: string) => unknown }).parse;
			if (parse && parse.constructor.name === "AsyncFunction") {
				throw new CrustError(
					"CONFIG",
					`Async parse not supported for argument <${(def as ArgDef).name}>. Use a sync parser; do async work in run().`,
				);
			}
		}
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
		if (existing !== undefined && Array.isArray(existing) && Array.isArray(value)) {
			existing.push(...value);
		} else {
			canonical[canonicalName] = value as ParsedFlagValue;
		}
	}

	return canonical;
}

/**
 * Resolve all flag definitions against the canonical parsed values.
 * Handles coercion and default values.
 */
function resolveFlags(
	flagsDef: FlagsDef | undefined,
	parsedValues: Record<string, unknown>,
	aliasToName: Record<string, string>,
) {
	if (!flagsDef) return {};

	const canonical = resolveAliases(parsedValues, aliasToName, flagsDef);
	const resolved: Record<string, unknown> = {};

	for (const [name, def] of Object.entries(flagsDef)) {
		const parsedValue = canonical[name];

		if (parsedValue !== undefined) {
			resolved[name] = coerceFlagValue(name, def, parsedValue);
			continue;
		}

		resolved[name] = resolveDefault(def as Parameters<typeof resolveDefault>[0], `--${name}`);
	}

	return resolved;
}

/**
 * Validate required flags against already-resolved flag values.
 */
function validateRequiredFlags(
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
 * Handles variadic args, coercion, and default values.
 *
 * This is a pure parse+coerce function — it never throws for missing required
 * values. Use {@link validateParsed} to enforce required constraints.
 */
function resolveArgs(argsDef: ArgsDef | undefined, positionals: string[]): Record<string, unknown> {
	if (!argsDef) return {};

	const resolved: Record<string, unknown> = {};
	let index = 0;

	for (const def of argsDef) {
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
			resolved[name] = remaining.map((v, i) => coerceOne(v, i));
			index = positionals.length;
		} else if (index < positionals.length) {
			resolved[name] = coerceOne(positionals[index] as string);
			index++;
		} else {
			resolved[name] = resolveDefault(def as Parameters<typeof resolveDefault>[0], label);
		}
	}

	return resolved;
}

/**
 * Enforce canonical-only boolean negation.
 *
 * `--no-<name>` is accepted only for the canonical boolean flag name.
 * Negating long aliases (for example `--no-loud` where `loud` aliases
 * `verbose`) is rejected with a targeted CrustError.
 */
function validateCanonicalNegationUsage(
	argv: string[],
	flagsDef: FlagsDef | undefined,
	aliasToName: Record<string, string>,
): void {
	if (!flagsDef) return;

	for (const arg of argv) {
		if (arg === "--") return;
		if (!arg.startsWith("--no-")) continue;

		const assignmentIndex = arg.indexOf("=");
		const rawName =
			assignmentIndex === -1
				? arg.slice("--no-".length)
				: arg.slice("--no-".length, assignmentIndex);

		if (!rawName) continue;

		const canonical = aliasToName[rawName];
		if (!canonical) continue;
		if (canonical === rawName) continue;

		const def = flagsDef[canonical];
		if (def?.type !== "boolean") continue;

		throw new CrustError(
			"PARSE",
			`Cannot negate alias "--no-${rawName}"; use "--no-${canonical}" instead`,
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
 * middleware has had a chance to intercept (e.g. `--help`).
 *
 * @param command - The command whose arg/flag definitions drive the parsing
 * @param argv - The argv array to parse (typically `process.argv.slice(2)`)
 * @returns Parsed args, flags, and rawArgs (everything after `--`)
 * @throws {CrustError} On unknown flags, type coercion failure, or alias collisions
 */
export function parseArgs<A extends ArgsDef = ArgsDef, F extends FlagsDef = FlagsDef>(
	command: CommandNode,
	argv: string[],
) {
	const argsDef = command.args as ArgsDef | undefined;
	const flagsDef = command.effectiveFlags as FlagsDef | undefined;

	// CONFIG-class validation: reject async parse fns up-front so the parser
	// never sees a Promise where a value was expected.
	validateAsyncParse(flagsDef, argsDef);

	const { aliasToName } = buildParseArgsOptionDescriptor(flagsDef);

	validateCanonicalNegationUsage(argv, flagsDef, aliasToName);

	const parsed = parseArgv(argv, flagsDef, aliasToName);

	const resolvedFlags = resolveFlags(flagsDef, parsed.values, aliasToName);
	const resolvedArgs = resolveArgs(argsDef, parsed.positionals);

	// The runtime logic correctly builds args/flags matching InferArgs<A> and
	// InferFlags<F>, but TypeScript can't verify this statically since values
	// are assembled dynamically from definitions. The assertion is safe here.
	return {
		args: resolvedArgs,
		flags: resolvedFlags,
		rawArgs: parsed.rawArgs,
	} as ParseResult<A, F>;
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
export function validateParsed(command: CommandNode, parsed: ParseResult): void {
	const argsDef = command.args as ArgsDef | undefined;
	const flagsDef = command.effectiveFlags as FlagsDef | undefined;

	const args = parsed.args as Record<string, unknown>;
	const flags = parsed.flags as Record<string, unknown>;

	// Re-validate args: check for required args that are undefined
	if (argsDef) {
		for (const def of argsDef) {
			const { name } = def as ArgDef;
			const label = `argument "<${name}>"`;
			const value = args[name];

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
