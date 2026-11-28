import {
	CrustError,
	defineContext,
	defineFlag,
	type ContextFactory,
	type EnvIssue,
	type FlagDef,
	type ValidatedInput,
} from "@crustjs/core";
import {
	formatDescription,
	type LocalValueBrand,
	parseFlagValues,
	type UnknownKeysBrand,
} from "@crustjs/core/tooling";

type FlagOnlyKey = "short" | "aliases" | "negatable" | "hidden" | "deprecated" | "requires" | "env";

// `?: never`, not just Omit: a generic `V extends EnvVarsDef` would admit them as excess keys.
type WithoutFlagOnlyKeys<D> = D extends unknown
	? Omit<D, FlagOnlyKey> & { readonly [K in FlagOnlyKey]?: never }
	: never;

/**
 * One environment variable: the {@link FlagDef} vocabulary without argv-only
 * keys or the argv-only `count` and `exclusive` types. Omitted per variant, so
 * `type`/`multiple`/`schema` constraints hold; the argv-only keys are typed `never`.
 */
export type EnvVarDef = WithoutFlagOnlyKeys<Exclude<FlagDef, { type: "count" | "exclusive" }>>;

/** Environment variable definitions keyed by literal variable name. */
export type EnvVarsDef = Record<string, EnvVarDef>;

export interface EnvOptions {
	/** Variables to read at first `ctx.<name>` access; defaults to `process.env`. Only own properties count. */
	readonly source?: Readonly<Record<string, string | undefined>> | undefined;
	/** Return declared variables as raw `string | undefined`: no coercion, defaults, requiredness, or schemas. */
	readonly skipValidation?: boolean | undefined;
	/** Treat `""` as unset (default `false`, which keeps `""` as a value). */
	readonly emptyStringAsUndefined?: boolean | undefined;
}

/** Validated values, inferred exactly as the equivalent flags would be (`InferFlags`), read-only. */
export type InferEnv<V extends EnvVarsDef> = Readonly<ValidatedInput<[], V>["flags"]>;

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

/** Reject what `defineFlag` rejects, naming the variable. */
function ownVar(name: string, def: EnvVarDef): EnvVarDef {
	try {
		// A name-less definition keeps variable names such as `__proto__` out of flag spelling rules.
		return defineFlag(def);
	} catch (error) {
		if (!(error instanceof CrustError && error.is("DEFINITION"))) throw error;
		throw new CrustError("DEFINITION", `Invalid environment variable "${name}"`, {
			name,
			...(error.details?.reason === undefined ? {} : { reason: error.details.reason }),
		}).withCause(error);
	}
}

/** Zero occurrences after delimiter splitting, or an empty boolean, is omission, as for flags. */
function isAbsent(def: EnvVarDef, raw: string | undefined): boolean {
	if (raw === undefined || (raw === "" && def.type === "boolean")) return true;
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
	// SAFETY: EnvVarDef is a FlagDef variant minus argv-only keys; its `delimiter` splits the text.
	const flags = { value: { ...def, env: "value" } as FlagDef };
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
 * `CrustError("DEFINITION")` what `defineFlag` rejects (such as an empty
 * delimiter) when the CLI runs from source and in `crust build`. Reading `ctx.<name>` reads the
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
	// Same value and unknown-key brands as defineFlag (default within choices, synchronous parse), per variable.
	vars: V & {
		readonly [K in keyof V]: LocalValueBrand<V[K]> & UnknownKeysBrand<V[K], EnvVarDef>;
	},
	// A required tuple member keeps `undefined` in O, so omittable options stay honest.
	...[options]: undefined extends O ? [] | [options: O] : [options: O]
): ContextFactory<Name, void, EnvValue<V, O>> {
	const owned: OwnedVars = Object.entries(vars).map(([key, def]) => [key, ownVar(key, def)]);
	const source = options?.source;
	const skipValidation = options?.skipValidation === true;
	const emptyStringAsUndefined = options?.emptyStringAsUndefined === true;
	return defineContext(name)
		.sections(...environmentSection(owned))
		.setup(async (): Promise<EnvValue<V, O>> => {
			const values = source ?? process.env;
			if (skipValidation) {
				const raw = owned.map(([key]) => [key, readRaw(values, key, emptyStringAsUndefined)]);
				// SAFETY: exactly the declared names, each raw text or undefined.
				return Object.fromEntries(raw) as EnvValue<V, O>;
			}
			// SAFETY: skipValidation was not true, so O admits the validated branch.
			return (await validate<V>(owned, values, emptyStringAsUndefined)) as EnvValue<V, O>;
		});
}
