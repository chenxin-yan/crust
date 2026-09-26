import {
	CrustError,
	defineContext,
	defineFlag,
	type ContextFactory,
	type EnvIssue,
	type FlagDef,
	type ValidatedInput,
} from "@crustjs/core";
import { formatDescription, parseFlagValues } from "@crustjs/core/tooling";

const FLAG_ONLY_KEYS = ["short", "aliases", "negatable", "noNegate", "hidden", "env"] as const;
type FlagOnlyKey = (typeof FLAG_ONLY_KEYS)[number];

// `?: never`, not just Omit: a generic `V extends EnvVarsDef` would admit them as excess keys.
type WithoutFlagOnlyKeys<D> = D extends unknown
	? Omit<D, FlagOnlyKey> & { readonly [K in FlagOnlyKey]?: never }
	: never;

/**
 * One environment variable: the {@link FlagDef} vocabulary without argv-only
 * keys. Omitted per variant, so `type`/`multiple`/`schema` constraints hold;
 * the argv-only keys are typed `never` and rejected at runtime.
 */
export type EnvVarDef = WithoutFlagOnlyKeys<FlagDef>;

/** Environment variable definitions keyed by literal variable name. */
export type EnvVarsDef = Record<string, EnvVarDef>;

export interface EnvOptions {
	/** Variables to read at first `ctx.<name>` access; defaults to `process.env`. Only own properties count. */
	readonly source?: Readonly<Record<string, string | undefined>>;
	/** Return declared variables as raw `string | undefined`: no coercion, defaults, requiredness, or schemas. */
	readonly skipValidation?: boolean;
	/** Treat `""` as unset (default `false`, which keeps `""` as a value). */
	readonly emptyStringAsUndefined?: boolean;
}

/** Validated values, inferred exactly as the equivalent flags would be (`InferFlags`). */
export type InferEnv<V extends EnvVarsDef> = ValidatedInput<[], V>["flags"];

/** `skipValidation` values: declared names only, raw text or unset. */
export type RawEnv<V extends EnvVarsDef> = { [K in keyof V]: string | undefined };

// Distributes, so `{ skipValidation: true } | undefined` admits both results.
type SkipValidation<O> = O extends unknown
	? "skipValidation" extends keyof O
		? O["skipValidation" & keyof O]
		: undefined
	: never;

/** Literal `skipValidation: true` is raw; a non-literal boolean or omittable options may be either. */
export type EnvValue<V extends EnvVarsDef, O extends EnvOptions | undefined> = [
	SkipValidation<O>,
] extends [true]
	? RawEnv<V>
	: true extends SkipValidation<O>
		? RawEnv<V> | InferEnv<V>
		: InferEnv<V>;

function readRaw(
	source: NonNullable<EnvOptions["source"]>,
	name: string,
	emptyStringAsUndefined: boolean,
): string | undefined {
	// hasOwn: a variable named `constructor` must not read Object.prototype.
	const raw = Object.hasOwn(source, name) ? source[name] : undefined;
	return emptyStringAsUndefined && raw === "" ? undefined : raw;
}

/** Reject what `defineFlag` rejects, plus flag-only keys that would change env parsing. */
function ownVar(name: string, def: EnvVarDef): EnvVarDef {
	for (const key of FLAG_ONLY_KEYS) {
		// An explicit `undefined` changes nothing, so only a value is rejected.
		if (def[key] !== undefined) {
			throw new CrustError(
				"DEFINITION",
				`Environment variable "${name}" cannot declare flag-only "${key}"`,
				{ name, reason: "flag-only-key" },
			);
		}
	}
	try {
		// A fixed flag name keeps variable names such as `__proto__` out of flag spelling rules.
		const { name: _flagName, ...owned } = defineFlag("value", def);
		return owned;
	} catch (error) {
		if (!(error instanceof CrustError && error.is("DEFINITION"))) throw error;
		throw new CrustError("DEFINITION", `Invalid environment variable "${name}"`, {
			name,
			...(error.details?.reason === undefined ? {} : { reason: error.details.reason }),
		}).withCause(error);
	}
}

/** Zero occurrences after delimiter splitting is omission, as for flags. */
function isAbsent(def: EnvVarDef, raw: string | undefined): boolean {
	if (raw === undefined) return true;
	return (
		def.multiple === true &&
		def.delimiter !== undefined &&
		raw.split(def.delimiter).every((segment) => segment === "")
	);
}

/** Declared expectation only: parser and schema messages may quote the value. */
function expectation(def: EnvVarDef): string {
	const base = def.choices?.length
		? `one of: ${def.choices.join(", ")}`
		: def.schema
			? "value accepted by schema"
			: def.parse
				? "value accepted by parse"
				: def.type;
	return def.multiple ? `list of ${base}` : base;
}

type VarResult =
	| { readonly name: string; readonly value: unknown }
	| { readonly name: string; readonly issue: EnvIssue };

async function parseVar(name: string, def: EnvVarDef, raw: string | undefined): Promise<VarResult> {
	// Fixed flag and variable names keep names like `__proto__` off the core records.
	const env =
		def.delimiter === undefined ? { name: "value" } : { name: "value", delimiter: def.delimiter };
	// SAFETY: EnvVarDef is a FlagDef variant minus argv-only keys; `env` reuses its own delimiter.
	const flags = { value: { ...def, env } as FlagDef };
	try {
		const { value } = await parseFlagValues(flags, raw === undefined ? {} : { value: raw });
		return { name, value };
	} catch {
		// The core error is dropped whole: its message and cause may quote the raw value.
		const received = isAbsent(def, raw) ? "missing" : "invalid";
		return { name, issue: { name, expected: expectation(def), received } };
	}
}

type OwnedVars = readonly (readonly [name: string, def: EnvVarDef])[];

async function validate<V extends EnvVarsDef>(
	vars: OwnedVars,
	source: NonNullable<EnvOptions["source"]>,
	emptyStringAsUndefined: boolean,
): Promise<InferEnv<V>> {
	const results = await Promise.all(
		vars.map(([name, def]) => parseVar(name, def, readRaw(source, name, emptyStringAsUndefined))),
	);
	const issues = results.flatMap((result) => ("issue" in result ? [result.issue] : []));
	if (issues.length > 0) {
		const lines = issues.map(
			(issue) => `  - ${issue.name}: ${issue.received} (expected ${issue.expected})`,
		);
		throw new CrustError("ENV", `Invalid environment variables:\n${lines.join("\n")}`, { issues });
	}
	const values = results.map((result) => [
		result.name,
		"value" in result ? result.value : undefined,
	]);
	// SAFETY: each declared name maps to core's flag resolution, which InferEnv reuses.
	return Object.fromEntries(values) as InferEnv<V>;
}

/** Declared metadata only; source values never reach documentation. */
function environmentSection(vars: OwnedVars): { title: string; body: string }[] {
	if (vars.length === 0) return [];
	const width = Math.max(...vars.map(([name]) => name.length));
	const body = vars
		.map(([name, def]) =>
			`${name.padEnd(width)}  ${formatDescription(def.description, def.default, def.choices)}`.trimEnd(),
		)
		.join("\n");
	return [{ title: "Environment", body }];
}

/**
 * Define typed environment variables as a lazy Context named `name`.
 *
 * Definitions and option settings are copied here, rejecting with
 * `CrustError("DEFINITION")` what `defineFlag` rejects (such as a default
 * outside `choices`) and flag-only keys. Reading `ctx.<name>` reads the
 * `source` values then and validates every variable, throwing one
 * `CrustError("ENV")` listing each missing or invalid variable without its
 * value. `.provide()` also documents the variables in an "Environment" section
 * on the providing command.
 */
export function defineEnv<
	Name extends string,
	const V extends EnvVarsDef,
	const O extends EnvOptions | undefined = undefined,
>(
	name: Name,
	vars: V,
	// A required tuple member keeps `undefined` in O, so omittable options stay honest.
	...[options]: undefined extends O ? [] | [options: O] : [options: O]
): ContextFactory<Name, void, EnvValue<V, O>> {
	const owned: OwnedVars = Object.entries(vars).map(([key, def]) => [key, ownVar(key, def)]);
	const source = options?.source;
	const skipValidation = options?.skipValidation === true;
	const emptyStringAsUndefined = options?.emptyStringAsUndefined === true;
	return defineContext(
		name,
		{ sections: environmentSection(owned) },
		async (): Promise<EnvValue<V, O>> => {
			const values = source ?? process.env;
			if (skipValidation) {
				const raw = owned.map(([key]) => [key, readRaw(values, key, emptyStringAsUndefined)]);
				// SAFETY: exactly the declared names, each raw text or undefined.
				return Object.fromEntries(raw) as EnvValue<V, O>;
			}
			// SAFETY: skipValidation was not true, so O admits the validated branch.
			return (await validate<V>(owned, values, emptyStringAsUndefined)) as EnvValue<V, O>;
		},
	);
}
